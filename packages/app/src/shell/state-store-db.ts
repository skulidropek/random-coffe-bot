import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Effect, pipe } from "effect"

import { botStateTable } from "./db/schema.js"
import type { DrizzleDatabase } from "./drizzle.js"

const stateRowId = 1

export type DbRunner<E> = <A>(
  run: () => PromiseLike<A>
) => Effect.Effect<A, E>

export const makeDbRunner = <E>(onError: (error: Error | string) => E): DbRunner<E> => <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => onError(error instanceof Error ? error : String(error))
  })

const resolveMigrationsFolder = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const cwd = process.cwd()
  const direct = path.resolve(cwd, "drizzle")
  const directMeta = path.join(direct, "meta", "_journal.json")
  const directExists = yield* _(fs.exists(directMeta))
  if (directExists) {
    return direct
  }

  const nested = path.resolve(cwd, "packages/app/drizzle")
  const nestedMeta = path.join(nested, "meta", "_journal.json")
  const nestedExists = yield* _(fs.exists(nestedMeta))
  if (nestedExists) {
    return nested
  }

  return direct
})

export const makeStateDb = <E>(
  runDb: DbRunner<E>,
  onError: (error: Error | string) => E
) => {
  const toDbError = (error: Error | string): E => onError(error)

  const resolveMigrations = pipe(
    resolveMigrationsFolder,
    Effect.mapError((error) => toDbError(error instanceof Error ? error : String(error)))
  )

  const runMigrations = (
    db: DrizzleDatabase
  ): Effect.Effect<void, E, FileSystem.FileSystem | Path.Path> =>
    pipe(
      resolveMigrations,
      Effect.flatMap((migrationsFolder) =>
        runDb(() => migrate(db, { migrationsFolder }))
      ),
      Effect.asVoid
    )

  const loadStatePayload = (
    db: DrizzleDatabase
  ): Effect.Effect<string | null, E> =>
    pipe(
      runDb(() =>
        db
          .select({ payload: botStateTable.payload })
          .from(botStateTable)
          .where(eq(botStateTable.id, stateRowId))
          .limit(1)
      ),
      Effect.map((rows) => {
        const row = rows[0]
        return row ? row.payload : null
      })
    )

  const persistStatePayload = (
    db: DrizzleDatabase,
    payload: string
  ): Effect.Effect<void, E> =>
    pipe(
      runDb(() =>
        db
          .insert(botStateTable)
          .values({
            id: stateRowId,
            payload
          })
          .onConflictDoUpdate({
            target: botStateTable.id,
            set: {
              payload,
              updatedAt: new Date()
            }
          })
      ),
      Effect.asVoid
    )

  return {
    runMigrations,
    loadStatePayload,
    persistStatePayload
  }
}
