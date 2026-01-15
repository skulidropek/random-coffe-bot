import { Effect, Match, pipe } from "effect"

import type { ChatId, LocalDateString, MessageId } from "../core/brand.js"
import type { BotState, ChatState } from "../core/domain.js"
import { pairParticipants } from "../core/pairing.js"
import { listParticipants } from "../core/participants.js"
import { applySummary, startPoll } from "../core/state.js"
import { formatPollQuestion, formatSummary } from "../core/text.js"
import type { StateStoreError, StateStoreShape } from "../shell/state-store.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"

const pollOptions = ["Yes! 🤗", "Not this time 💁🏽‍♂️"]

type CreatePollContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: ChatState
  readonly summaryDate: LocalDateString
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
}

type SummarizeContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: ChatState
  readonly summaryDate: LocalDateString
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
}

const isPollAlreadyClosed = (error: TelegramError): boolean =>
  Match.value(error).pipe(
    Match.when({ _tag: "TelegramApiError" }, (apiError) => {
      if (apiError.method !== "stopPoll" || apiError.errorCode !== 400) {
        return false
      }
      const message = apiError.description || apiError.message || ""
      return message.includes("poll has already been closed")
    }),
    Match.when({ _tag: "TelegramNetworkError" }, () => false),
    Match.exhaustive
  )

// CHANGE: ignore stopPoll errors for already closed polls
// WHY: allow summaries to complete when polls are closed manually
// QUOTE(TZ): "не может почему-то закрыть опросник"
// REF: user-2026-01-16-stop-poll
// SOURCE: n/a
// FORMAT THEOREM: forall e: closed_poll(e) -> stopPollSafe(e) = void
// PURITY: SHELL
// EFFECT: Effect<void, TelegramError, never>
// INVARIANT: non-closed errors still fail
// COMPLEXITY: O(1)/O(1)
const stopPollSafe = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  messageId: MessageId
): Effect.Effect<void, TelegramError> =>
  telegram.stopPoll(chatId, messageId).pipe(
    Effect.catchAll((error) =>
      isPollAlreadyClosed(error)
        ? Effect.void
        : Effect.fail(error)
    )
  )

// CHANGE: send a poll and persist state for a chat
// WHY: reuse identical polling logic for schedule and manual commands
// QUOTE(TZ): "Сделать моментальный опросник"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s: createPoll(s) -> poll exists in state
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError | StateStoreError, never>
// INVARIANT: poll participants are cleared on creation
// COMPLEXITY: O(1)/O(1)
export const createPoll = (
  context: CreatePollContext
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  pipe(
    context.telegram.sendPoll(
      context.chatId,
      formatPollQuestion(),
      pollOptions,
      context.chat.threadId ?? undefined
    ),
    Effect.flatMap((result) => {
      const nextState = startPoll(context.state, context.chatId, {
        pollId: result.pollId,
        messageId: result.messageId,
        chatId: context.chatId,
        summaryDate: context.summaryDate,
        threadId: context.chat.threadId
      })
      return pipe(
        context.stateStore.set(nextState),
        Effect.as(nextState)
      )
    }),
    Effect.tap(() =>
      Effect.logInfo(
        `Опрос создан для чата ${context.chatId} на дату итогов ${context.summaryDate}`
      )
    )
  )

// CHANGE: send the pairing summary and persist updated history
// WHY: reuse identical summary logic for schedule and manual commands
// QUOTE(TZ): "Подвести итоги опросника"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s: summarize(s) -> history updated
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError | StateStoreError, never>
// INVARIANT: poll is cleared after summary
// COMPLEXITY: O(n)/O(n)
export const summarize = (
  context: SummarizeContext
): Effect.Effect<BotState, TelegramError | StateStoreError> => {
  const participants = listParticipants(context.chat.participants)
  const pairing = pairParticipants(
    participants,
    context.chat.history,
    context.chat.seed
  )
  const threadId = context.chat.poll?.threadId ?? context.chat.threadId
  const stopPollEffect = context.chat.poll
    ? stopPollSafe(context.telegram, context.chatId, context.chat.poll.messageId)
    : Effect.void
  const nextState = applySummary(
    context.state,
    context.chatId,
    pairing.pairs,
    pairing.seed,
    context.summaryDate
  )
  return pipe(
    stopPollEffect,
    Effect.zipRight(
      context.telegram.sendMessage(
        context.chatId,
        formatSummary(context.chat.title, pairing.pairs, pairing.leftovers),
        threadId ?? undefined
      )
    ),
    Effect.flatMap(() => context.stateStore.set(nextState)),
    Effect.tap(() => Effect.logInfo(`Итоговые пары отправлены для чата ${context.chatId}`)),
    Effect.as(nextState)
  )
}
