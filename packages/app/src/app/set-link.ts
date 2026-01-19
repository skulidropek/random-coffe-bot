import { Effect, pipe } from "effect"

import type { ChatId } from "../core/brand.js"
import type { BotState } from "../core/domain.js"
import { parseTelegramChatLink } from "../core/links.js"
import { setChatInviteLink } from "../core/state.js"
import { replySetLinkInvalid, replySetLinkSaved } from "../core/text.js"
import type { StateStoreError, StateStoreShape } from "../shell/state-store.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"

type SetLinkContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: BotState["chats"][string]
  readonly commandText: string
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
  readonly replyThreadId?: number | undefined
}

const extractCommandArg = (text: string): string | null => {
  const tokens = text.trim().split(/\s+/)
  return tokens.length >= 2 ? tokens[1] ?? null : null
}

// CHANGE: store a manual invite link for the leaderboard
// WHY: allow groups without usernames to appear with a join link
// QUOTE(TZ): "должна быть ссылка на группу"
// REF: user-2026-01-18-leaderboard-link
// SOURCE: n/a
// FORMAT THEOREM: forall s,l: setLink(s,l).chats[id].inviteLink = l
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError | StateStoreError, never>
// INVARIANT: invalid links do not mutate state
// COMPLEXITY: O(1)/O(1)
export const handleSetLink = (
  context: SetLinkContext
): Effect.Effect<BotState, TelegramError | StateStoreError> => {
  const arg = extractCommandArg(context.commandText)
  const parsed = arg ? parseTelegramChatLink(arg) : null
  if (!parsed) {
    return pipe(
      context.telegram.sendMessage(
        context.chatId,
        replySetLinkInvalid(),
        context.replyThreadId ?? context.chat.threadId ?? undefined
      ),
      Effect.as(context.state)
    )
  }
  const nextState = setChatInviteLink(context.state, context.chatId, parsed)
  return pipe(
    context.stateStore.set(nextState),
    Effect.zipRight(
      context.telegram.sendMessage(
        context.chatId,
        replySetLinkSaved(),
        context.replyThreadId ?? context.chat.threadId ?? undefined
      )
    ),
    Effect.as(nextState)
  )
}
