import { Effect, Match, pipe } from "effect"

import type { ChatId, LocalDateString, MessageId } from "../core/brand.js"
import type { BotState, ChatState } from "../core/domain.js"
import { pairParticipants } from "../core/pairing.js"
import { listParticipants } from "../core/participants.js"
import { applySummary, finishPoll, startPoll } from "../core/state.js"
import {
  formatPollClosedNoResults,
  formatPollQuestion,
  formatSummary,
  logPollAlreadyClosed,
  logPollCreated,
  logSummaryPairsSent,
  pollOptions,
  stopPollClosedMessageFragments
} from "../core/text.js"
import type { StateStoreError, StateStoreShape } from "../shell/state-store.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"

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

type StopPollOutcome = "stopped" | "alreadyClosed"

const isPollAlreadyClosedMessage = (message: string): boolean => {
  const normalized = message.toLowerCase()
  return stopPollClosedMessageFragments.some((fragment) => normalized.includes(fragment))
}

const isPollAlreadyClosed = (error: TelegramError): boolean =>
  Match.value(error).pipe(
    Match.when({ _tag: "TelegramApiError" }, (apiError) => {
      if (apiError.method !== "stopPoll" || apiError.errorCode !== 400) {
        return false
      }
      const message = apiError.description || apiError.message || ""
      return isPollAlreadyClosedMessage(message)
    }),
    Match.when({ _tag: "TelegramNetworkError" }, () => false),
    Match.exhaustive
  )

// CHANGE: return an outcome when stopping a poll fails with a closed poll message
// WHY: allow manual summaries to proceed with a no-results notice
// QUOTE(TZ): "не может почему-то закрыть опросник"
// REF: user-2026-01-16-stop-poll
// SOURCE: n/a
// FORMAT THEOREM: forall e: closed_poll(e) -> stopPollSafe(e) = alreadyClosed
// PURITY: SHELL
// EFFECT: Effect<StopPollOutcome, TelegramError, never>
// INVARIANT: non-closed errors still fail, closed errors become alreadyClosed
// COMPLEXITY: O(1)/O(1)
const stopPollSafe = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  messageId: MessageId
): Effect.Effect<StopPollOutcome, TelegramError> =>
  telegram.stopPoll(chatId, messageId).pipe(
    Effect.as<StopPollOutcome>("stopped"),
    Effect.catchAll((error) =>
      isPollAlreadyClosed(error)
        ? Effect.succeed<StopPollOutcome>("alreadyClosed")
        : Effect.fail(error)
    )
  )

const buildStopPollEffect = (
  context: SummarizeContext
): Effect.Effect<StopPollOutcome, TelegramError> =>
  context.chat.poll
    ? stopPollSafe(context.telegram, context.chatId, context.chat.poll.messageId)
    : Effect.succeed<StopPollOutcome>("stopped")

const buildSummaryState = (
  context: SummarizeContext,
  pairing: ReturnType<typeof pairParticipants>
): BotState =>
  applySummary(
    context.state,
    context.chatId,
    pairing.pairs,
    pairing.seed,
    context.summaryDate
  )

const buildClosedState = (context: SummarizeContext): BotState => finishPoll(context.state, context.chatId)

const sendClosedNotice = (
  context: SummarizeContext,
  threadId: number | null | undefined,
  closedState: BotState
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  pipe(
    context.telegram.sendMessage(
      context.chatId,
      formatPollClosedNoResults(),
      threadId ?? undefined
    ),
    Effect.flatMap(() => context.stateStore.set(closedState)),
    Effect.tap(() => Effect.logInfo(logPollAlreadyClosed(context.chatId))),
    Effect.as(closedState)
  )

const buildSummaryMessage = (
  context: SummarizeContext,
  threadId: number | null | undefined,
  pairing: ReturnType<typeof pairParticipants>,
  nextState: BotState
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  pipe(
    context.telegram.sendMessage(
      context.chatId,
      formatSummary(context.chat.title, pairing.pairs, pairing.leftovers),
      threadId ?? undefined
    ),
    Effect.flatMap(() => context.stateStore.set(nextState)),
    Effect.tap(() => Effect.logInfo(logSummaryPairsSent(context.chatId))),
    Effect.as(nextState)
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
    Effect.tap(() => Effect.logInfo(logPollCreated(context.chatId, context.summaryDate)))
  )

// CHANGE: send the pairing summary and persist updated history
// WHY: reuse identical summary logic for schedule and manual commands
// QUOTE(TZ): "Подвести итоги опросника"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s: summarize(s) -> poll_cleared(s)
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError | StateStoreError, never>
// INVARIANT: history is updated only when summary is sent
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
  const stopPollEffect = buildStopPollEffect(context)
  const nextState = buildSummaryState(context, pairing)
  const closedState = buildClosedState(context)
  const sendClosedMessage = sendClosedNotice(context, threadId, closedState)
  const sendSummaryMessage = buildSummaryMessage(context, threadId, pairing, nextState)
  return pipe(
    stopPollEffect,
    Effect.flatMap((outcome) =>
      Match.value(outcome).pipe(
        Match.when("alreadyClosed", () => sendClosedMessage),
        Match.when("stopped", () => sendSummaryMessage),
        Match.exhaustive
      )
    )
  )
}
