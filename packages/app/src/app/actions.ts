import { Effect, Match, pipe } from "effect"

import { ChatId, type LocalDateString, type MessageId } from "../core/brand.js"
import type { BotState, ChatState } from "../core/domain.js"
import {
  assignOrganizers,
  assignSoloParticipants,
  pairParticipants,
  type PairingAssignment
} from "../core/pairing.js"
import { listParticipants } from "../core/participants.js"
import { applySummary, finishPoll, startPoll } from "../core/state.js"
import {
  formatDirectPairingMessage,
  formatPollClosedNoResults,
  formatPollQuestion,
  formatSummary,
  logDirectMessageFailed,
  logPollAlreadyClosed,
  logPollCreated,
  logPollPinFailed,
  logSummaryPinFailed,
  logSummaryPairsSent,
  pollOptions,
  stopPollClosedMessageFragments
} from "../core/text.js"
import { formatTelegramMessageLink } from "../core/links.js"
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
  assignments: ReadonlyArray<PairingAssignment>,
  nextState: BotState
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  pipe(
    context.telegram.sendMessage(
      context.chatId,
      formatSummary(context.chat.title, pairing.pairs, pairing.leftovers),
      threadId ?? undefined
    ),
    Effect.flatMap((messageId) =>
      pipe(
        context.stateStore.set(nextState),
        Effect.zipRight(
          pinSummaryMessageBestEffort(context.telegram, context.chatId, messageId)
        ),
        Effect.zipRight(
          sendDirectPairingMessages(
            context.telegram,
            assignments,
            context.chat.title,
            context.chat.inviteLink,
            formatTelegramMessageLink(
              context.chatId,
              messageId,
              threadId ?? null
            )
          )
        ),
        Effect.as(nextState)
      )
    ),
    Effect.tap(() => Effect.logInfo(logSummaryPairsSent(context.chatId)))
  )

// CHANGE: pin a newly created poll message
// WHY: keep the active poll visible in the chat
// QUOTE(TZ): "Добавь в бота что бы он кидал в закреп свой опросник всегда"
// REF: user-2026-01-20-pin-poll
// SOURCE: n/a
// FORMAT THEOREM: forall c,m: attempt_pin(c,m) -> logged(c) | pinned(c,m)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: a pin attempt is made exactly once per poll creation
// COMPLEXITY: O(1)/O(1)
const pinPollMessageBestEffort = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  messageId: MessageId
): Effect.Effect<void> =>
  pipe(
    telegram.pinChatMessage(chatId, messageId),
    Effect.tapError(() => Effect.logWarning(logPollPinFailed(chatId))),
    Effect.catchAll(() => Effect.void)
  )

// CHANGE: pin a summary message after sending results
// WHY: keep weekly outcomes visible in the chat
// QUOTE(TZ): "итоги тоже есть смысл кинуть в закреп"
// REF: user-2026-01-20-pin-summary
// SOURCE: n/a
// FORMAT THEOREM: forall c,m: attempt_pin(c,m) -> logged(c) | pinned(c,m)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: a pin attempt is made exactly once per summary message
// COMPLEXITY: O(1)/O(1)
const pinSummaryMessageBestEffort = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  messageId: MessageId
): Effect.Effect<void> =>
  pipe(
    telegram.pinChatMessage(chatId, messageId),
    Effect.tapError(() => Effect.logWarning(logSummaryPinFailed(chatId))),
    Effect.catchAll(() => Effect.void)
  )

// CHANGE: send a direct pairing message to a participant
// WHY: notify participants in private chat when a pair is formed
// QUOTE(TZ): "если у бота есть чат с человеком"
// REF: user-2026-01-20-direct-dm
// SOURCE: n/a
// FORMAT THEOREM: forall a: dm(a) -> sent(a) | logged(a)
// PURITY: SHELL
// EFFECT: Effect<void, never, never>
// INVARIANT: a DM attempt is made exactly once per assignment
// COMPLEXITY: O(1)/O(1)
const sendDirectMessageBestEffort = (
  telegram: TelegramServiceShape,
  assignment: PairingAssignment,
  chatTitle: string | null,
  chatInviteLink: string | null,
  summaryLink: string | null
): Effect.Effect<void> => {
  const chatId = ChatId(`${assignment.participant.id}`)
  return pipe(
    telegram.sendMessage(
      chatId,
      formatDirectPairingMessage({
        counterparts: assignment.counterparts,
        isOrganizer: assignment.isOrganizer,
        chatTitle,
        chatInviteLink,
        summaryLink
      })
    ),
    Effect.tapError(() => Effect.logWarning(logDirectMessageFailed(chatId))),
    Effect.catchAll(() => Effect.void)
  )
}

const sendDirectPairingMessages = (
  telegram: TelegramServiceShape,
  assignments: ReadonlyArray<PairingAssignment>,
  chatTitle: string | null,
  chatInviteLink: string | null,
  summaryLink: string | null
): Effect.Effect<void> =>
  Effect.forEach(assignments, (assignment) =>
    sendDirectMessageBestEffort(telegram, assignment, chatTitle, chatInviteLink, summaryLink), { discard: true }
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
        Effect.zipRight(
          pinPollMessageBestEffort(context.telegram, context.chatId, result.messageId)
        ),
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
  const organizerAssignments = assignOrganizers(pairing.pairs, pairing.seed)
  const soloAssignments = assignSoloParticipants(pairing.leftovers)
  const directAssignments = [
    ...organizerAssignments.assignments,
    ...soloAssignments
  ]
  const pairingWithOrganizerSeed = {
    ...pairing,
    seed: organizerAssignments.seed
  }
  const threadId = context.chat.poll?.threadId ?? context.chat.threadId
  const stopPollEffect = buildStopPollEffect(context)
  const nextState = buildSummaryState(context, pairingWithOrganizerSeed)
  const closedState = buildClosedState(context)
  const sendClosedMessage = sendClosedNotice(context, threadId, closedState)
  const sendSummaryMessage = buildSummaryMessage(
    context,
    threadId,
    pairing,
    directAssignments,
    nextState
  )
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
