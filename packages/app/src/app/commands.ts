import { Effect, pipe } from "effect"

import type { BotState } from "../core/domain.js"
import { formatLocalDate, nextPollWindow, summaryDateForPoll } from "../core/schedule.js"
import type { IncomingUpdate } from "../core/updates.js"
import type { StateStoreError, StateStoreShape } from "../shell/state-store.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"
import { getZonedDate, type TimeError } from "../shell/time.js"
import { dispatchChatCommand, type DispatchContext } from "./command-dispatch.js"
import { allowCommand, type CommandEnvelope, toCommandEnvelope } from "./command-utils.js"
import { handleLeaderboard } from "./leaderboard.js"

type CommandContext = {
  readonly state: BotState
  readonly updates: ReadonlyArray<IncomingUpdate>
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
  readonly timeZone: string
  readonly botUsername?: string | undefined
}

type CommandUpdateContext = DispatchContext & {
  readonly state: BotState
  readonly update: IncomingUpdate
  readonly botUsername?: string | undefined
}

const isCommandAllowed = (
  telegram: TelegramServiceShape,
  envelope: CommandEnvelope
): Effect.Effect<boolean, TelegramError> =>
  allowCommand(
    telegram,
    envelope.chatId,
    envelope.actorId,
    envelope.command,
    envelope.replyThreadId
  )

const handleLeaderboardCommand = (
  state: BotState,
  context: DispatchContext,
  envelope: CommandEnvelope
): Effect.Effect<BotState, TelegramError> =>
  handleLeaderboard({
    state,
    chatId: envelope.chatId,
    telegram: context.telegram,
    replyThreadId: envelope.replyThreadId
  })

const handleCommandUpdate = (
  context: CommandUpdateContext
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Effect.gen(function*(_) {
    const envelope = toCommandEnvelope(context.update, context.botUsername)
    if (!envelope) {
      return context.state
    }
    const allowed = yield* _(isCommandAllowed(context.telegram, envelope))
    if (!allowed) {
      return context.state
    }
    return envelope.command === "/leaderboard"
      ? yield* _(handleLeaderboardCommand(context.state, context, envelope))
      : yield* _(dispatchChatCommand(context.state, context, envelope, envelope.command))
  })

type PollContextValues = {
  readonly pollSummaryDate: ReturnType<typeof summaryDateForPoll>
  readonly today: ReturnType<typeof formatLocalDate>
  readonly pollWindow: ReturnType<typeof nextPollWindow>
}

const buildPollContext = (
  context: CommandContext
): Effect.Effect<PollContextValues, TimeError> =>
  Effect.gen(function*(_) {
    const now = new Date()
    const zoned = yield* _(getZonedDate(context.timeZone, now))
    return {
      pollSummaryDate: summaryDateForPoll(zoned.parts, zoned.weekday),
      today: formatLocalDate(zoned.parts),
      pollWindow: nextPollWindow(zoned.parts, zoned.weekday)
    }
  })

const applyCommandUpdates = (
  context: CommandContext,
  pollContext: PollContextValues
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Effect.gen(function*(_) {
    let updated = context.state
    for (const update of context.updates) {
      updated = yield* _(
        handleCommandUpdate({
          state: updated,
          update,
          pollSummaryDate: pollContext.pollSummaryDate,
          today: pollContext.today,
          pollWindow: pollContext.pollWindow,
          telegram: context.telegram,
          stateStore: context.stateStore,
          botUsername: context.botUsername
        })
      )
    }

    return updated
  })

// CHANGE: handle admin commands for polls and configuration
// WHY: allow admins to control poll topic and trigger manual actions
// QUOTE(TZ): "Сделать моментальный опросник"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s: handle(s) preserves non-command state
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError | StateStoreError, never>
// INVARIANT: only admins can invoke privileged commands
// COMPLEXITY: O(n)/O(n)
export const handleCommands = (
  context: CommandContext
): Effect.Effect<BotState, TelegramError | StateStoreError | TimeError> =>
  pipe(
    buildPollContext(context),
    Effect.flatMap((pollContext) => applyCommandUpdates(context, pollContext))
  )
