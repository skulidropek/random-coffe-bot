import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Effect, pipe } from "effect"

import type { BotState } from "../core/domain.js"
import { botMetaTable, chatsTable, pairHistoryTable, participantsTable, pollsTable } from "./db/schema.js"
import type { DrizzleDatabase } from "./drizzle.js"
import { makePersistState } from "./state-store-db-persist.js"
import { buildStateFromRows } from "./state-store-db-rows.js"
import type { DbRunner } from "./state-store-db-runner.js"

const metaRowId = 1

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

const buildResolveMigrations = <E>(
  onError: (error: Error | string) => E
): Effect.Effect<string, E, FileSystem.FileSystem | Path.Path> =>
  pipe(
    resolveMigrationsFolder,
    Effect.mapError((error) => onError(error instanceof Error ? error : String(error)))
  )

const makeRunMigrations = <E>(
  runDb: DbRunner<E>,
  resolveMigrations: Effect.Effect<string, E, FileSystem.FileSystem | Path.Path>
) =>
(db: DrizzleDatabase): Effect.Effect<void, E, FileSystem.FileSystem | Path.Path> =>
  pipe(
    resolveMigrations,
    Effect.flatMap((migrationsFolder) => runDb(() => migrate(db, { migrationsFolder }))),
    Effect.asVoid
  )

const loadMetaRow = <E>(runDb: DbRunner<E>, onError: (error: Error | string) => E) =>
(
  db: DrizzleDatabase
): Effect.Effect<{ readonly updateOffset: number; readonly seed: number } | null, E> =>
  pipe(
    runDb(() =>
      db
        .select({ updateOffset: botMetaTable.updateOffset, seed: botMetaTable.seed })
        .from(botMetaTable)
        .where(eq(botMetaTable.id, metaRowId))
        .limit(1)
    ),
    Effect.flatMap((rows) => {
      const row = rows[0]
      if (!row) {
        return Effect.succeed(null)
      }
      if (row.updateOffset < 0) {
        return Effect.fail(onError(`Invalid updateOffset: ${row.updateOffset}`))
      }
      return Effect.succeed({ updateOffset: row.updateOffset, seed: row.seed })
    })
  )

const loadNormalizedState = <E>(
  runDb: DbRunner<E>,
  onError: (error: Error | string) => E
) =>
(db: DrizzleDatabase): Effect.Effect<BotState | null, E> =>
  Effect.gen(function*(_) {
    const meta = yield* _(loadMetaRow(runDb, onError)(db))
    if (!meta) {
      return null
    }
    const chats = yield* _(runDb(() => db.select().from(chatsTable)))
    const polls = yield* _(runDb(() => db.select().from(pollsTable)))
    const participants = yield* _(runDb(() => db.select().from(participantsTable)))
    const histories = yield* _(runDb(() => db.select().from(pairHistoryTable)))
    return yield* _(
      buildStateFromRows({
        meta,
        chats,
        polls,
        participants,
        histories,
        onError
      })
    )
  })

// CHANGE: load state exclusively from normalized tables (no JSON payload fallback)
// WHY: enforce typed relational persistence without legacy JSON blobs
// QUOTE(TZ): "всё типобезопасно без ебучих payload"
// REF: user-2026-01-17-no-payload
// SOURCE: n/a
// FORMAT THEOREM: ∀db: loadState(db) = normalized(db) ∨ null
// PURITY: SHELL
// EFFECT: Effect<{runMigrations, loadState, persistState}, E>
// INVARIANT: legacy payloads are never decoded
// COMPLEXITY: O(n)/O(n)
export const makeStateDb = <E>(
  runDb: DbRunner<E>,
  onError: (error: Error | string) => E
) => {
  const resolveMigrations = buildResolveMigrations(onError)
  const loadNormalized = loadNormalizedState(runDb, onError)
  const persist = makePersistState({ metaRowId, onError })

  return {
    runMigrations: makeRunMigrations(runDb, resolveMigrations),
    loadState: (db: DrizzleDatabase): Effect.Effect<BotState | null, E> =>
      Effect.gen(function*(_) {
        const normalized = yield* _(loadNormalized(db))
        if (normalized) {
          return normalized
        }
        return null
      }),
    persistState: persist
  }
}

export { makeDbRunner } from "./state-store-db-runner.js"
export type { DbRunner } from "./state-store-db-runner.js"
