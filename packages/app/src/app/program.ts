import { Effect, Match, pipe } from "effect"

import { ChatId, RngSeed } from "../core/brand.js"
import type { BotState, ChatState } from "../core/domain.js"
import { decideSchedule } from "../core/schedule.js"
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

const formatDecision = (decision: ReturnType<typeof decideSchedule>): string =>
  Match.value(decision).pipe(
    Match.when({ kind: "createPoll" }, (value) => `createPoll summary=${value.summaryDate}`),
    Match.when({ kind: "summarize" }, (value) => `summarize summary=${value.summaryDate}`),
    Match.when({ kind: "noop" }, () => "noop"),
    Match.exhaustive
  )

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
            `Schedule: chat=${chatId} decision=${formatDecision(decision)}`
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
  config: Config
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
      yield* _(handleMessages(updates, telegram))
      if (Object.keys(updated.chats).length === 0) {
        yield* _(Effect.logWarning("Нет зарегистрированных групповых чатов. Жду апдейтов из групп."))
      }
      yield* _(stateStore.set(updated))
      const afterCommands = yield* _(
        logAndFallback(
          handleCommands({
            state: updated,
            updates,
            telegram,
            stateStore,
            timeZone: config.timeZone
          }),
          updated
        )
      )
      yield* _(handleDecision(config, afterCommands))
    })
  )

const loop = (
  config: Config
): Effect.Effect<void, never, StateStore | TelegramService> => pipe(runOnce(config), Effect.forever, Effect.asVoid)

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
  Effect.flatMap((config) =>
    Effect.scoped(
      pipe(
        Effect.sync(() => Date.now()),
        Effect.map((now) => RngSeed(now % 2_147_483_647)),
        Effect.flatMap((seed) =>
          pipe(
            makeDrizzleService(config.databaseUrl),
            Effect.mapError((error) => new StateStoreError({ message: error.message })),
            Effect.flatMap((drizzleService) =>
              pipe(
                makeStateStore(seed),
                Effect.provideService(DrizzleService, drizzleService),
                Effect.flatMap((stateStore) => {
                  const telegramService = makeTelegramService(config.token)
                  return loop(config).pipe(
                    Effect.provideService(StateStore, stateStore),
                    Effect.provideService(TelegramService, telegramService)
                  )
                })
              )
            )
          )
        )
      )
    )
  )
)
