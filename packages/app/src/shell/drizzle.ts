import { drizzle } from "drizzle-orm/node-postgres"
import { Context, Data, Effect, pipe } from "effect"
import type { Scope } from "effect/Scope"
import { Pool } from "pg"

export class DrizzleError extends Data.TaggedError("DrizzleError")<{
  readonly message: string
}> {}

export type DrizzleDatabase = ReturnType<typeof drizzle>

export type DrizzleServiceShape = {
  readonly db: DrizzleDatabase
}

export class DrizzleService extends Context.Tag("DrizzleService")<
  DrizzleService,
  DrizzleServiceShape
>() {}

const toDrizzleError = (
  error: DrizzleError | Error | string
): DrizzleError =>
  error instanceof DrizzleError
    ? error
    : new DrizzleError({
      message: error instanceof Error ? error.message : error
    })

const makePool = (databaseUrl: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => new Pool({ connectionString: databaseUrl }),
      catch: (error) => toDrizzleError(error instanceof Error ? error : String(error))
    }),
    (pool) =>
      pipe(
        Effect.tryPromise({
          try: () => pool.end(),
          catch: (error) => toDrizzleError(error instanceof Error ? error : String(error))
        }),
        Effect.matchEffect({
          onFailure: () => Effect.sync(() => {}),
          onSuccess: () => Effect.void
        }),
        Effect.asVoid
      )
  )

// CHANGE: expose a typed Drizzle database in a scoped Effect service
// WHY: keep database effects isolated behind a single service boundary
// QUOTE(TZ): "А ты можешь не писать SQL код а использовать ORM?"
// REF: user-2026-01-12-orm
// SOURCE: n/a
// FORMAT THEOREM: forall q: run(q) -> errors are typed as DrizzleError
// PURITY: SHELL
// EFFECT: Effect<DrizzleServiceShape, DrizzleError, Scope>
// INVARIANT: pool is closed when scope ends
// COMPLEXITY: O(1)/O(1)
export const makeDrizzleService = (
  databaseUrl: string
): Effect.Effect<DrizzleServiceShape, DrizzleError, Scope> =>
  pipe(
    makePool(databaseUrl),
    Effect.map((pool) => ({
      db: drizzle({ client: pool })
    }))
  )
