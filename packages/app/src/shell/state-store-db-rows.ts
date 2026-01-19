import { Effect, pipe as effectPipe } from "effect"

import { ChatId, LocalDateString, MessageId, PairKey, PollId, RngSeed, UserId } from "../core/brand.js"
import type {
  BotState,
  ChatState,
  PairHistory,
  Participant,
  ParticipantsById,
  PollIndex,
  PollState
} from "../core/domain.js"
import { upsertParticipant } from "../core/participants.js"
import type { ChatRow, PairHistoryRow, ParticipantRow, PollRow } from "./db/schema.js"

type ErrorHandler<E> = (error: Error | string) => E

const localDateRegex = /^\d{4}-\d{2}-\d{2}$/

const parseLocalDate = <E>(
  value: string,
  onError: ErrorHandler<E>
): Effect.Effect<LocalDateString, E> =>
  localDateRegex.test(value)
    ? Effect.succeed(LocalDateString(value))
    : Effect.fail(onError(`Invalid LocalDateString: ${value}`))

const toParticipant = (row: ParticipantRow): Participant => ({
  id: UserId(row.userId),
  firstName: row.firstName,
  lastName: row.lastName ?? undefined,
  username: row.username ?? undefined
})

const toPollState = <E>(args: {
  readonly row: PollRow
  readonly onError: ErrorHandler<E>
}): Effect.Effect<PollState, E> =>
  effectPipe(
    parseLocalDate(args.row.summaryDate, args.onError),
    Effect.map((summaryDate) => ({
      pollId: PollId(args.row.pollId),
      messageId: MessageId(args.row.messageId),
      chatId: ChatId(args.row.chatId),
      summaryDate,
      threadId: args.row.threadId ?? null
    }))
  )

const toChatState = <E>(args: {
  readonly row: ChatRow
  readonly poll: PollState | null
  readonly participants: ParticipantsById
  readonly history: PairHistory
  readonly onError: ErrorHandler<E>
}): Effect.Effect<ChatState, E> =>
  Effect.gen(function*(_) {
    const lastSummaryAt = args.row.lastSummaryAt
      ? yield* _(parseLocalDate(args.row.lastSummaryAt, args.onError))
      : null
    return {
      poll: args.poll,
      participants: args.participants,
      history: args.history,
      seed: RngSeed(args.row.seed),
      threadId: args.row.threadId ?? null,
      title: args.row.title ?? null,
      inviteLink: args.row.inviteLink ?? null,
      lastSummaryAt
    }
  })

const buildParticipantsByChat = <E>(args: {
  readonly rows: ReadonlyArray<ParticipantRow>
  readonly chatIds: ReadonlySet<string>
  readonly onError: ErrorHandler<E>
}): Effect.Effect<Record<string, ParticipantsById>, E> =>
  Effect.gen(function*(_) {
    let participantsByChat: Record<string, ParticipantsById> = {}
    for (const row of args.rows) {
      if (!args.chatIds.has(row.chatId)) {
        yield* _(Effect.fail(args.onError(`Participant without chat: ${row.chatId}`)))
      }
      const current = participantsByChat[row.chatId] ?? {}
      participantsByChat = {
        ...participantsByChat,
        [row.chatId]: upsertParticipant(current, toParticipant(row))
      }
    }
    return participantsByChat
  })

const buildHistoryByChat = <E>(args: {
  readonly rows: ReadonlyArray<PairHistoryRow>
  readonly chatIds: ReadonlySet<string>
  readonly onError: ErrorHandler<E>
}): Effect.Effect<Record<string, PairHistory>, E> =>
  Effect.gen(function*(_) {
    let historyByChat: Record<string, PairHistory> = {}
    for (const row of args.rows) {
      if (!args.chatIds.has(row.chatId)) {
        yield* _(Effect.fail(args.onError(`Pair history without chat: ${row.chatId}`)))
      }
      const current = historyByChat[row.chatId] ?? {}
      historyByChat = {
        ...historyByChat,
        [row.chatId]: {
          ...current,
          [PairKey(row.pairKey)]: row.count
        }
      }
    }
    return historyByChat
  })

const buildPolls = <E>(args: {
  readonly rows: ReadonlyArray<PollRow>
  readonly chatIds: ReadonlySet<string>
  readonly onError: ErrorHandler<E>
}): Effect.Effect<{
  readonly pollIndex: PollIndex
  readonly pollsByChat: Record<string, PollState>
}, E> =>
  Effect.gen(function*(_) {
    let pollIndex: PollIndex = {}
    let pollsByChat: Record<string, PollState> = {}
    for (const row of args.rows) {
      if (!args.chatIds.has(row.chatId)) {
        yield* _(Effect.fail(args.onError(`Poll without chat: ${row.chatId}`)))
      }
      const poll = yield* _(toPollState({ row, onError: args.onError }))
      pollIndex = { ...pollIndex, [poll.pollId]: poll.chatId }
      pollsByChat = { ...pollsByChat, [row.chatId]: poll }
    }
    return { pollIndex, pollsByChat }
  })

const buildChatStates = <E>(args: {
  readonly chats: ReadonlyArray<ChatRow>
  readonly pollsByChat: Record<string, PollState>
  readonly participantsByChat: Record<string, ParticipantsById>
  readonly historyByChat: Record<string, PairHistory>
  readonly onError: ErrorHandler<E>
}): Effect.Effect<Record<string, ChatState>, E> =>
  Effect.gen(function*(_) {
    let chatStates: Record<string, ChatState> = {}
    for (const row of args.chats) {
      const chatState = yield* _(
        toChatState({
          row,
          poll: args.pollsByChat[row.chatId] ?? null,
          participants: args.participantsByChat[row.chatId] ?? {},
          history: args.historyByChat[row.chatId] ?? {},
          onError: args.onError
        })
      )
      chatStates = {
        ...chatStates,
        [ChatId(row.chatId)]: chatState
      }
    }
    return chatStates
  })

export type StateRowsInput<E> = {
  readonly meta: { readonly updateOffset: number; readonly seed: number }
  readonly chats: ReadonlyArray<ChatRow>
  readonly polls: ReadonlyArray<PollRow>
  readonly participants: ReadonlyArray<ParticipantRow>
  readonly histories: ReadonlyArray<PairHistoryRow>
  readonly onError: ErrorHandler<E>
}

// CHANGE: build a normalized BotState from relational rows
// WHY: restore in-memory state from typed SQL tables with validation
// QUOTE(TZ): "Да реализуй нормальные схемы. Всё типизируй"
// REF: user-2026-01-16-normalized-db
// SOURCE: n/a
// FORMAT THEOREM: ∀rows: valid(rows) → build(rows) = BotState(rows)
// PURITY: SHELL
// EFFECT: Effect<BotState, E>
// INVARIANT: all rows reference existing chats and valid LocalDateString values
// COMPLEXITY: O(n)/O(n)
export const buildStateFromRows = <E>(
  input: StateRowsInput<E>
): Effect.Effect<BotState, E> =>
  Effect.gen(function*(_) {
    const chatIds = new Set(input.chats.map((row) => row.chatId))
    const { pollIndex, pollsByChat } = yield* _(
      buildPolls({ rows: input.polls, chatIds, onError: input.onError })
    )
    const participantsByChat = yield* _(
      buildParticipantsByChat({
        rows: input.participants,
        chatIds,
        onError: input.onError
      })
    )
    const historyByChat = yield* _(
      buildHistoryByChat({
        rows: input.histories,
        chatIds,
        onError: input.onError
      })
    )
    const chatStates = yield* _(
      buildChatStates({
        chats: input.chats,
        pollsByChat,
        participantsByChat,
        historyByChat,
        onError: input.onError
      })
    )

    return {
      chats: chatStates,
      pollIndex,
      updateOffset: Math.max(0, input.meta.updateOffset),
      seed: RngSeed(input.meta.seed)
    }
  })
