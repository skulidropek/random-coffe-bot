import { Effect, pipe } from "effect"

import { ChatId } from "../core/brand.js"
import type { BotState } from "../core/domain.js"
import {
  formatLeaderboard,
  type LeaderboardEntry,
  replyLeaderboardEmpty,
  replyLeaderboardUnavailable
} from "../core/text.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"
import { formatError } from "./diagnostics.js"

type LeaderboardSnapshot = {
  readonly entries: ReadonlyArray<LeaderboardEntry>
  readonly skipped: number
}

type LeaderboardMeta = {
  readonly username?: string | undefined
  readonly inviteLink?: string | undefined
}

const fetchMemberCount = (
  telegram: TelegramServiceShape,
  chatId: ChatId
): Effect.Effect<number | null> =>
  pipe(
    telegram.getChatMemberCount(chatId),
    Effect.map((count): number | null => count),
    Effect.catchAll((error) =>
      pipe(
        Effect.logError(formatError(error)),
        Effect.as<number | null>(null)
      )
    )
  )

const fetchChatMeta = (
  telegram: TelegramServiceShape,
  chatId: ChatId
): Effect.Effect<LeaderboardMeta | null> =>
  pipe(
    telegram.getChat(chatId),
    Effect.map((chat): LeaderboardMeta => ({
      username: chat.username,
      inviteLink: chat.inviteLink
    })),
    Effect.catchAll((error) =>
      pipe(
        Effect.logError(formatError(error)),
        Effect.as<LeaderboardMeta | null>(null)
      )
    )
  )

const buildLeaderboardSnapshot = (
  state: BotState,
  telegram: TelegramServiceShape
): Effect.Effect<LeaderboardSnapshot> =>
  Effect.gen(function*(_) {
    const entries: Array<LeaderboardEntry> = []
    let skipped = 0
    for (const [chatId, chat] of Object.entries(state.chats)) {
      const typedChatId = ChatId(chatId)
      const members = yield* _(fetchMemberCount(telegram, typedChatId))
      if (members === null) {
        skipped += 1
        continue
      }
      const meta = yield* _(fetchChatMeta(telegram, typedChatId))
      entries.push({
        chatId: typedChatId,
        title: chat.title,
        members,
        username: meta?.username,
        inviteLink: chat.inviteLink ?? meta?.inviteLink
      })
    }
    return { entries, skipped }
  })

type LeaderboardContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly telegram: TelegramServiceShape
  readonly replyThreadId?: number | undefined
}

// CHANGE: send a leaderboard of group member counts
// WHY: let users discover other bot-enabled communities
// QUOTE(TZ): "список групп в которых используется бот"
// REF: user-2026-01-18-leaderboard
// SOURCE: n/a
// FORMAT THEOREM: forall s: handle(s) preserves bot state
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError, never>
// INVARIANT: no state mutation occurs
// COMPLEXITY: O(n log n)/O(n)
export const handleLeaderboard = (
  context: LeaderboardContext
): Effect.Effect<BotState, TelegramError> =>
  Effect.gen(function*(_) {
    const snapshot = yield* _(buildLeaderboardSnapshot(context.state, context.telegram))
    let message = ""
    if (snapshot.entries.length === 0) {
      message = snapshot.skipped === 0
        ? replyLeaderboardEmpty()
        : replyLeaderboardUnavailable(snapshot.skipped)
    } else {
      message = formatLeaderboard(snapshot.entries, snapshot.skipped)
    }
    yield* _(
      context.telegram.sendMessage(
        context.chatId,
        message,
        context.replyThreadId
      )
    )
    return context.state
  })
