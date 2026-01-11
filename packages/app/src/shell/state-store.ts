import * as S from "@effect/schema/Schema"
import { Context, Data, Effect, pipe, Ref } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

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

export class StateStoreError extends Data.TaggedError("StateStoreError")<{
  readonly message: string
}> {}

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
      message: error instanceof Error ? error.message : error
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
    Effect.catchAll(() =>
      pipe(
        decodeLegacy(payload),
        Effect.map((wire) => toStateFromLegacy(wire))
      )
    ),
    Effect.mapError((error) => toStoreError(error instanceof Error ? error : String(error)))
  )

const readStateFile = (filePath: string): Effect.Effect<BotState, StateStoreError> =>
  pipe(
    Effect.tryPromise({
      try: () => readFile(filePath, "utf8"),
      catch: (error) => toStoreError(error instanceof Error ? error : String(error))
    }),
    Effect.flatMap((payload) => decodeState(payload))
  )

const ensureDirectory = (filePath: string): Effect.Effect<void, StateStoreError> =>
  pipe(
    Effect.tryPromise({
      try: () => mkdir(path.dirname(filePath), { recursive: true }),
      catch: (error) => toStoreError(error instanceof Error ? error : String(error))
    }),
    Effect.asVoid
  )

const writeStateFile = (
  filePath: string,
  state: BotState
): Effect.Effect<void, StateStoreError> =>
  pipe(
    Effect.tryPromise({
      try: () =>
        writeFile(
          filePath,
          JSON.stringify(toWireState(state), null, 2),
          "utf8"
        ),
      catch: (error) => toStoreError(error instanceof Error ? error : String(error))
    }),
    Effect.asVoid
  )

const isMissingFile = (error: StateStoreError): boolean => error.message.includes("ENOENT")

// CHANGE: load and persist bot state to the filesystem
// WHY: keep weekly pairing history stable across restarts
// QUOTE(TZ): "Что бы меньше попадались те кто уже был"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s: save(load(s)) = s
// PURITY: SHELL
// EFFECT: Effect<StateStoreShape, StateStoreError, never>
// INVARIANT: state is schema-validated before use
// COMPLEXITY: O(n)/O(n)
export const makeStateStore = (
  statePath: string,
  initialSeed: RngSeed
): Effect.Effect<StateStoreShape, StateStoreError> =>
  pipe(
    Effect.catchAll(readStateFile(statePath), (error) =>
      isMissingFile(error)
        ? Effect.succeed(emptyState(initialSeed))
        : Effect.fail(error)),
    Effect.flatMap((state) =>
      Ref.make(state).pipe(
        Effect.map((ref) => ({
          get: Ref.get(ref),
          set: (next: BotState) =>
            pipe(
              Ref.set(ref, next),
              Effect.zipRight(ensureDirectory(statePath)),
              Effect.zipRight(writeStateFile(statePath, next))
            )
        }))
      )
    )
  )
