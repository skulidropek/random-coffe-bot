import type { ChatId, LocalDateString, MessageId, PairKey, PollId, RngSeed, UserId } from "./brand.js"

export type ChatType = "private" | "group" | "supergroup"

export type Participant = {
  readonly id: UserId
  readonly firstName: string
  readonly lastName?: string | undefined
  readonly username?: string | undefined
}

export type ParticipantsById = Readonly<Record<string, Participant>>

export type PollState = {
  readonly pollId: PollId
  readonly messageId: MessageId
  readonly chatId: ChatId
  readonly summaryDate: LocalDateString
  readonly threadId: number | null
}

export type PairHistory = Readonly<Record<PairKey, number>>

export type Pairing =
  | {
    readonly kind: "pair"
    readonly members: readonly [Participant, Participant]
  }
  | {
    readonly kind: "triple"
    readonly members: readonly [Participant, Participant, Participant]
  }

export type ChatState = {
  readonly poll: PollState | null
  readonly participants: ParticipantsById
  readonly history: PairHistory
  readonly seed: RngSeed
  readonly threadId: number | null
  readonly title: string | null
  readonly inviteLink: string | null
  readonly lastSummaryAt: LocalDateString | null
}

export type ChatStates = Readonly<Record<string, ChatState>>

export type PollIndex = Readonly<Record<string, ChatId>>

export type BotState = {
  readonly chats: ChatStates
  readonly pollIndex: PollIndex
  readonly updateOffset: number
  readonly seed: RngSeed
}

// CHANGE: provide a pure initializer for bot state
// WHY: allow multi-chat operation without preconfiguring chat ids
// QUOTE(TZ): "может работать в любом чате в который добавят бота"
// REF: user-2026-01-09-multi-chat
// SOURCE: n/a
// FORMAT THEOREM: forall seed: init(seed).seed = seed
// PURITY: CORE
// INVARIANT: empty state has no chats or polls
// COMPLEXITY: O(1)/O(1)
export const emptyState = (seed: RngSeed): BotState => ({
  chats: {},
  pollIndex: {},
  updateOffset: 0,
  seed
})
