import { Effect, Match, pipe } from "effect"

import { ChatId, RngSeed } from "../core/brand.js"
import type { BotState, ChatState } from "../core/domain.js"
import { decideSchedule } from "../core/schedule.js"
import { logNoRegisteredGroupChats, logScheduleDecision } from "../core/text.js"
import { applyUpdates } from "../core/updates.js"
import { type Config, loadConfig } from "../shell/config.js"
import { DrizzleService, makeDrizzleService } from "../shell/drizzle.js"
import { makeStateStore, StateStore, StateStoreError, type StateStoreShape } from "../shell/state-store.js"
import {
  makeTelegramService,
  type TelegramError,
  TelegramService,
  type TelegramServiceShape
} from "../shell/telegram.js"
import { getZonedDate } from "../shell/time.js"
import { createPoll, summarize } from "./actions.js"
import { handleCommands } from "./commands.js"
import { handleMessages, logAndFallback, logAndIgnore, logState, logUpdates } from "./diagnostics.js"

const longPollSeconds = 25

type DecisionContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: ChatState
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
}

const handleDecisionEffect = (
  decision: ReturnType<typeof decideSchedule>,
  context: DecisionContext
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Match.value(decision).pipe(
    Match.when({ kind: "createPoll" }, (value) =>
      createPoll({
        ...context,
        summaryDate: value.summaryDate
      })),
    Match.when({ kind: "summarize" }, (value) =>
      summarize({
        ...context,
        summaryDate: value.summaryDate
      })),
    Match.when({ kind: "noop" }, () => Effect.succeed(context.state)),
    Match.exhaustive
  )

const handleDecision = (
  config: Config,
  state: BotState
): Effect.Effect<BotState, never, StateStore | TelegramService> =>
  logAndFallback(
    Effect.gen(function*(_) {
      const now = new Date()
      const zoned = yield* _(getZonedDate(config.timeZone, now))
      const telegram = yield* _(TelegramService)
      const stateStore = yield* _(StateStore)

      let updated = state
      for (const [chatId] of Object.entries(state.chats)) {
        const current = updated.chats[chatId]
        if (!current) {
          continue
        }
        const decision = decideSchedule(current, zoned.parts, zoned.weekday)
        yield* _(
          Effect.logInfo(
            logScheduleDecision(ChatId(chatId), decision)
          )
        )
        updated = yield* _(
          handleDecisionEffect(decision, {
            state: updated,
            chatId: ChatId(chatId),
            chat: current,
            telegram,
            stateStore
          })
        )
      }

      return updated
    }),
    state
  )

const runOnce = (
  config: Config,
  botUsername?: string
): Effect.Effect<void, never, StateStore | TelegramService> =>
  logAndIgnore(
    Effect.gen(function*(_) {
      const telegram = yield* _(TelegramService)
      const stateStore = yield* _(StateStore)
      const current = yield* _(stateStore.get)
      const updates = yield* _(telegram.getUpdates(current.updateOffset, longPollSeconds))
      yield* _(logUpdates(updates))
      const updated = applyUpdates(current, updates)
      yield* _(logState(updated))
      const afterMessages = yield* _(handleMessages(updated, updates, telegram, botUsername))
      if (Object.keys(afterMessages.chats).length === 0) {
        yield* _(Effect.logWarning(logNoRegisteredGroupChats()))
      }
      yield* _(stateStore.set(afterMessages))
      const afterCommands = yield* _(
        logAndFallback(
          handleCommands({
            state: afterMessages,
            updates,
            telegram,
            stateStore,
            timeZone: config.timeZone,
            botUsername
          }),
          afterMessages
        )
      )
      yield* _(handleDecision(config, afterCommands))
    })
  )

const loop = (
  config: Config,
  botUsername?: string
): Effect.Effect<void, never, StateStore | TelegramService> =>
  pipe(runOnce(config, botUsername), Effect.forever, Effect.asVoid)

const resolveBotUsername = (
  telegram: TelegramServiceShape
): Effect.Effect<string | undefined> =>
  pipe(
    telegram.getMe,
    Effect.map((profile) => profile.username ?? undefined),
    Effect.catchAll(() => Effect.sync((): string | undefined => undefined))
  )

const buildRuntime = (
  config: Config
) =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const now = yield* _(Effect.sync(() => Date.now()))
      const seed = RngSeed(now % 2_147_483_647)
      const drizzleService = yield* _(
        pipe(
          makeDrizzleService(config.databaseUrl),
          Effect.mapError((error) => new StateStoreError({ message: error.message }))
        )
      )
      const stateStore = yield* _(
        pipe(
          makeStateStore(seed),
          Effect.provideService(DrizzleService, drizzleService)
        )
      )
      const telegramService = makeTelegramService(config.token)
      const botUsername = yield* _(resolveBotUsername(telegramService))
      yield* _(
        loop(config, botUsername).pipe(
          Effect.provideService(StateStore, stateStore),
          Effect.provideService(TelegramService, telegramService)
        )
      )
    })
  )

// CHANGE: compose the bot runtime program with Effect services
// WHY: run the scheduler, update loop, and state persistence through typed effects
// QUOTE(TZ): "Его добавляют в группу и он создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall t: program(t) -> effects only through services
// PURITY: SHELL
// EFFECT: Effect<void, ConfigError | StateStoreError, never>
// INVARIANT: state is persisted after every update and schedule action
// COMPLEXITY: O(n)/O(n)
export const program = pipe(
  loadConfig,
  Effect.flatMap((config) => buildRuntime(config))
)
