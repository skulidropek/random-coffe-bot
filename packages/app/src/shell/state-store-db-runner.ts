import { Effect } from "effect"

import type { DrizzleDatabase } from "./drizzle.js"

export type DbRunner<E> = <A>(
  run: () => PromiseLike<A>
) => Effect.Effect<A, E>

// CHANGE: lift Promise-returning DB calls into typed Effects
// WHY: keep database IO explicit and typed at the shell boundary
// QUOTE(TZ): "Все эффекты (IO, сеть, БД, env/process) изолированы в тонкой оболочке"
// REF: AGENTS.md
// SOURCE: n/a
// FORMAT THEOREM: ∀run: Effect(run) either succeeds or returns typed E
// PURITY: SHELL
// EFFECT: Effect<A, E>
// INVARIANT: thrown errors are mapped to the provided error type
// COMPLEXITY: O(1)/O(1)
export const makeDbRunner = <E>(
  onError: (error: Error | string) => E
): DbRunner<E> =>
<A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => onError(error instanceof Error ? error : String(error))
  })

type TransactionCallback = Parameters<DrizzleDatabase["transaction"]>[0]
export type DrizzleTransaction = Parameters<TransactionCallback>[0]

// CHANGE: execute an Effect inside a Drizzle transaction
// WHY: guarantee atomic persistence of normalized bot state
// QUOTE(TZ): "CORE никогда не вызывает SHELL"
// REF: AGENTS.md
// SOURCE: n/a
// FORMAT THEOREM: ∀tx: run(tx) ⇒ atomic(tx)
// PURITY: SHELL
// EFFECT: Effect<A, E>
// INVARIANT: transaction is committed or rolled back atomically
// COMPLEXITY: O(1)/O(1)
export const runInTransaction = <E, A>(
  db: DrizzleDatabase,
  onError: (error: Error | string) => E,
  effect: (tx: DrizzleTransaction) => Effect.Effect<A, E>
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: () => db.transaction((tx) => Effect.runPromise(effect(tx))),
    catch: (error) => onError(error instanceof Error ? error : String(error))
  })
