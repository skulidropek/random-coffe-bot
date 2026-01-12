import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Effect, pipe } from "effect"
import { existsSync } from "node:fs"
import path from "node:path"

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

const resolveMigrationsFolder = (): string => {
  const direct = path.resolve(process.cwd(), "drizzle")
  const directMeta = path.join(direct, "meta", "_journal.json")
  if (existsSync(directMeta)) {
    return direct
  }

  const nested = path.resolve(process.cwd(), "packages/app/drizzle")
  const nestedMeta = path.join(nested, "meta", "_journal.json")
  if (existsSync(nestedMeta)) {
    return nested
  }

  return direct
}

const migrationsFolder = resolveMigrationsFolder()

export const makeStateDb = <E>(runDb: DbRunner<E>) => {
  const runMigrations = (db: DrizzleDatabase): Effect.Effect<void, E> =>
    pipe(
      runDb(() => migrate(db, { migrationsFolder })),
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
