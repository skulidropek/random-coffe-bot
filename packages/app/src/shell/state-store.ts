import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Context, Data, Effect, pipe, Ref } from "effect"

import type { RngSeed } from "../core/brand.js"
import type { BotState } from "../core/domain.js"
import { emptyState } from "../core/domain.js"
import { DrizzleService, type DrizzleServiceShape } from "./drizzle.js"
import { makeDbRunner, makeStateDb } from "./state-store-db.js"

export class StateStoreError extends Data.TaggedError("StateStoreError")<{
  readonly message: string
}> {}

const formatCause = (cause: Error["cause"]): string | null => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === "string") {
    return cause
  }
  if (typeof cause === "number" || typeof cause === "boolean" || typeof cause === "bigint") {
    return `${cause}`
  }
  if (cause === null) {
    return "null"
  }
  if (cause === undefined) {
    return null
  }
  return "unknown"
}

const formatErrorMessage = (error: Error | string): string => {
  if (typeof error === "string") {
    return error
  }
  const base = error.message
  const causeMessage = formatCause(error.cause)
  return causeMessage ? `${base}; cause: ${causeMessage}` : base
}

export type StateStoreShape = {
  readonly get: Effect.Effect<BotState, StateStoreError>
  readonly set: (state: BotState) => Effect.Effect<void, StateStoreError>
}

export class StateStore extends Context.Tag("StateStore")<
  StateStore,
  StateStoreShape
>() {}

const toStoreError = (
  error: StateStoreError | Error | string
): StateStoreError =>
  error instanceof StateStoreError
    ? error
    : new StateStoreError({
      message: formatErrorMessage(error)
    })

const runDb = makeDbRunner((error) => toStoreError(error))

const { loadState, persistState, runMigrations } = makeStateDb(
  runDb,
  (error) => toStoreError(error)
)

const loadOrInitState = (
  db: DrizzleServiceShape["db"],
  initialSeed: RngSeed
): Effect.Effect<BotState, StateStoreError> =>
  pipe(
    loadState(db),
    Effect.flatMap((state) =>
      state
        ? Effect.succeed(state)
        : pipe(
          Effect.succeed(emptyState(initialSeed)),
          Effect.tap((next) => persistState(db, next))
        )
    )
  )

// CHANGE: load and persist bot state via ORM-backed Postgres storage
// WHY: keep weekly pairing history stable across restarts without filesystem state
// QUOTE(TZ): "А ты можешь не писать SQL код а использовать ORM?"
// REF: user-2026-01-12-orm
// SOURCE: n/a
// FORMAT THEOREM: forall s: save(load(s)) = s
// PURITY: SHELL
// EFFECT: Effect<StateStoreShape, StateStoreError, DrizzleService | FileSystem | Path>
// INVARIANT: state is schema-validated before use
// COMPLEXITY: O(n)/O(n)
export const makeStateStore = (
  initialSeed: RngSeed
): Effect.Effect<
  StateStoreShape,
  StateStoreError,
  DrizzleService | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const dbService = yield* _(DrizzleService)
    const db = dbService.db
    yield* _(runMigrations(db))
    const state = yield* _(loadOrInitState(db, initialSeed))
    const ref = yield* _(Ref.make(state))
    return {
      get: Ref.get(ref),
      set: (next: BotState) =>
        pipe(
          Ref.set(ref, next),
          Effect.zipRight(persistState(db, next))
        )
    }
  })
