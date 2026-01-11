import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, pipe } from "effect"

import { program } from "./program.js"

// CHANGE: run the Telegram bot program through the Node runtime
// WHY: keep the effect runtime centralized while the bot loop runs indefinitely
// QUOTE(TZ): "Его добавляют в группу и он создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall t: runMain(program) -> program effects executed
// PURITY: SHELL
// EFFECT: Effect<void, ConfigError | StateStoreError, never>
// INVARIANT: program executed with NodeContext.layer
// COMPLEXITY: O(1)/O(1)
const main = pipe(program, Effect.provide(NodeContext.layer))

NodeRuntime.runMain(main)
