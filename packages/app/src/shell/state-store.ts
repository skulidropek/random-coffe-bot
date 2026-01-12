import * as S from "@effect/schema/Schema"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Context, Data, Effect, pipe, Ref } from "effect"

import { ChatId, LocalDateString, MessageId, PairKey, PollId, RngSeed, UserId } from "../core/brand.js"
import type {
  BotState,
  ChatState,
  ChatStates,
  PairHistory,
  Participant,
  ParticipantsById,
  PollIndex,
  PollState
} from "../core/domain.js"
import { emptyState } from "../core/domain.js"
import { listParticipants, upsertParticipant } from "../core/participants.js"
import { DrizzleService, type DrizzleServiceShape } from "./drizzle.js"
import { makeDbRunner, makeStateDb } from "./state-store-db.js"

export class StateStoreError extends Data.TaggedError("StateStoreError")<{
  readonly message: string
}> {}

const formatCause = (cause: Error["cause"]): string | null => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === "string") {
    return cause
  }
  if (typeof cause === "number" || typeof cause === "boolean" || typeof cause === "bigint") {
    return `${cause}`
  }
  if (cause === null) {
    return "null"
  }
  if (cause === undefined) {
    return null
  }
  return "unknown"
}

const formatErrorMessage = (error: Error | string): string => {
  if (typeof error === "string") {
    return error
  }
  const base = error.message
  const causeMessage = formatCause(error.cause)
  return causeMessage ? `${base}; cause: ${causeMessage}` : base
}

const participantSchema = S.Struct({
  id: S.Number,
  firstName: S.String,
  lastName: S.optional(S.String),
  username: S.optional(S.String)
})

type ParticipantWire = S.Schema.Type<typeof participantSchema>

const historyEntrySchema = S.Struct({
  key: S.String,
  count: S.Number
})

type HistoryEntryWire = S.Schema.Type<typeof historyEntrySchema>

const pollSchema = S.Struct({
  pollId: S.String,
  messageId: S.Number,
  chatId: S.String,
  summaryDate: S.String,
  threadId: S.optional(S.Number)
})

type PollWire = S.Schema.Type<typeof pollSchema>

const chatStateSchema = S.Struct({
  chatId: S.String,
  poll: S.optional(S.NullOr(pollSchema)),
  participants: S.Array(participantSchema),
  history: S.Array(historyEntrySchema),
  seed: S.Number,
  threadId: S.optional(S.Number),
  title: S.optional(S.String),
  lastSummaryAt: S.optional(S.String)
})

type ChatStateWire = S.Schema.Type<typeof chatStateSchema>

const pollIndexEntrySchema = S.Struct({
  pollId: S.String,
  chatId: S.String
})

const stateSchema = S.Struct({
  chats: S.Array(chatStateSchema),
  pollIndex: S.Array(pollIndexEntrySchema),
  updateOffset: S.Number,
  seed: S.Number
})

type StateWire = S.Schema.Type<typeof stateSchema>

const legacyStateSchema = S.Struct({
  chatId: S.optional(S.String),
  poll: S.optional(S.NullOr(pollSchema)),
  participants: S.Array(participantSchema),
  history: S.Array(historyEntrySchema),
  updateOffset: S.Number,
  seed: S.Number
})

type LegacyStateWire = S.Schema.Type<typeof legacyStateSchema>

export type StateStoreShape = {
  readonly get: Effect.Effect<BotState, StateStoreError>
  readonly set: (state: BotState) => Effect.Effect<void, StateStoreError>
}

export class StateStore extends Context.Tag("StateStore")<
  StateStore,
  StateStoreShape
>() {}

const toStoreError = (
  error: StateStoreError | Error | string
): StateStoreError =>
  error instanceof StateStoreError
    ? error
    : new StateStoreError({
      message: formatErrorMessage(error)
    })

const toParticipant = (wire: ParticipantWire): Participant => ({
  id: UserId(wire.id),
  firstName: wire.firstName,
  lastName: wire.lastName,
  username: wire.username
})

const toPollState = (wire: PollWire): PollState => ({
  pollId: PollId(wire.pollId),
  messageId: MessageId(wire.messageId),
  chatId: ChatId(wire.chatId),
  summaryDate: LocalDateString(wire.summaryDate),
  threadId: wire.threadId ?? null
})

const toHistory = (entries: ReadonlyArray<HistoryEntryWire>): PairHistory => {
  let history: PairHistory = {}
  for (const entry of entries) {
    history = { ...history, [PairKey(entry.key)]: entry.count }
  }
  return history
}

const toParticipants = (
  entries: ReadonlyArray<ParticipantWire>
): ParticipantsById => {
  let participants: ParticipantsById = {}
  for (const value of entries) {
    const participant = toParticipant(value)
    participants = upsertParticipant(participants, participant)
  }
  return participants
}

const toChatState = (wire: ChatStateWire): ChatState => ({
  poll: wire.poll ? toPollState(wire.poll) : null,
  participants: toParticipants(wire.participants),
  history: toHistory(wire.history),
  seed: RngSeed(wire.seed),
  threadId: wire.threadId ?? null,
  title: wire.title ?? null,
  lastSummaryAt: wire.lastSummaryAt ? LocalDateString(wire.lastSummaryAt) : null
})

const buildBotState = (
  chats: ChatStates,
  pollIndex: PollIndex,
  updateOffset: number,
  seed: number
): BotState => ({
  chats,
  pollIndex,
  updateOffset: Math.max(0, updateOffset),
  seed: RngSeed(seed)
})

const toState = (wire: StateWire): BotState => {
  let chats: ChatStates = {}
  for (const chatWire of wire.chats) {
    const chatId = ChatId(chatWire.chatId)
    chats = { ...chats, [chatId]: toChatState(chatWire) }
  }

  let pollIndex: PollIndex = {}
  for (const entry of wire.pollIndex) {
    pollIndex = {
      ...pollIndex,
      [PollId(entry.pollId)]: ChatId(entry.chatId)
    }
  }

  return buildBotState(chats, pollIndex, wire.updateOffset, wire.seed)
}

const toStateFromLegacy = (wire: LegacyStateWire): BotState => {
  const poll = wire.poll ? toPollState(wire.poll) : null
  let chatId: ChatId | null = null
  if (wire.chatId) {
    chatId = ChatId(wire.chatId)
  } else if (poll) {
    chatId = poll.chatId
  }

  let chats: ChatStates = {}
  let pollIndex: PollIndex = {}
  if (chatId) {
    chats = {
      ...chats,
      [chatId]: {
        poll,
        participants: toParticipants(wire.participants),
        history: toHistory(wire.history),
        seed: RngSeed(wire.seed),
        threadId: null,
        title: null,
        lastSummaryAt: null
      }
    }
    if (poll) {
      pollIndex = {
        ...pollIndex,
        [poll.pollId]: chatId
      }
    }
  }

  return buildBotState(chats, pollIndex, wire.updateOffset, wire.seed)
}

const toWirePoll = (poll: PollState): PollWire => ({
  pollId: poll.pollId,
  messageId: poll.messageId,
  chatId: poll.chatId,
  summaryDate: poll.summaryDate,
  threadId: poll.threadId ?? undefined
})

const toWireChatState = (
  chatId: string,
  chat: ChatState
): ChatStateWire => ({
  chatId,
  poll: chat.poll ? toWirePoll(chat.poll) : null,
  participants: listParticipants(chat.participants).map((participant) => ({
    id: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    username: participant.username
  })),
  history: Object.entries(chat.history).map(([key, count]) => ({
    key,
    count
  })),
  seed: chat.seed,
  threadId: chat.threadId ?? undefined,
  title: chat.title ?? undefined,
  lastSummaryAt: chat.lastSummaryAt ?? undefined
})

const toWireState = (state: BotState): StateWire => ({
  chats: Object.entries(state.chats).map(([chatId, chat]) => toWireChatState(chatId, chat)),
  pollIndex: Object.entries(state.pollIndex).map(([pollId, chatId]) => ({
    pollId,
    chatId
  })),
  updateOffset: state.updateOffset,
  seed: state.seed
})

const decodeCurrent = S.decodeUnknown(S.parseJson(stateSchema))
const decodeLegacy = S.decodeUnknown(S.parseJson(legacyStateSchema))

const decodeState = (payload: string): Effect.Effect<BotState, StateStoreError> =>
  pipe(
    decodeCurrent(payload),
    Effect.map((wire) => toState(wire)),
    Effect.matchEffect({
      onFailure: () =>
        pipe(
          decodeLegacy(payload),
          Effect.map((wire) => toStateFromLegacy(wire))
        ),
      onSuccess: (state) => Effect.succeed(state)
    }),
    Effect.mapError((error) => toStoreError(error instanceof Error ? error : String(error)))
  )

const runDb = makeDbRunner((error) => toStoreError(error))

const { loadStatePayload, persistStatePayload, runMigrations } = makeStateDb(
  runDb,
  (error) => toStoreError(error)
)

const persistState = (
  db: DrizzleServiceShape["db"],
  state: BotState
): Effect.Effect<void, StateStoreError> => persistStatePayload(db, JSON.stringify(toWireState(state)))

const loadOrInitState = (
  db: DrizzleServiceShape["db"],
  initialSeed: RngSeed
): Effect.Effect<BotState, StateStoreError> =>
  pipe(
    loadStatePayload(db),
    Effect.flatMap((payload) =>
      payload
        ? decodeState(payload)
        : pipe(
          Effect.succeed(emptyState(initialSeed)),
          Effect.tap((state) => persistState(db, state))
        )
    )
  )

// CHANGE: load and persist bot state via ORM-backed Postgres storage
// WHY: keep weekly pairing history stable across restarts without filesystem state
// QUOTE(TZ): "А ты можешь не писать SQL код а использовать ORM?"
// REF: user-2026-01-12-orm
// SOURCE: n/a
// FORMAT THEOREM: forall s: save(load(s)) = s
// PURITY: SHELL
// EFFECT: Effect<StateStoreShape, StateStoreError, DrizzleService | FileSystem | Path>
// INVARIANT: state is schema-validated before use
// COMPLEXITY: O(n)/O(n)
export const makeStateStore = (
  initialSeed: RngSeed
): Effect.Effect<
  StateStoreShape,
  StateStoreError,
  DrizzleService | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const dbService = yield* _(DrizzleService)
    const db = dbService.db
    yield* _(runMigrations(db))
    const state = yield* _(loadOrInitState(db, initialSeed))
    const ref = yield* _(Ref.make(state))
    return {
      get: Ref.get(ref),
      set: (next: BotState) =>
        pipe(
          Ref.set(ref, next),
          Effect.zipRight(persistState(db, next))
        )
    }
  })
