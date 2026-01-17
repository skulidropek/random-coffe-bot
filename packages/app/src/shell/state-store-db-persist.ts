import { Effect, pipe } from "effect"

import type { BotState, PollState } from "../core/domain.js"
import { botMetaTable, chatsTable, pairHistoryTable, participantsTable, pollsTable } from "./db/schema.js"
import type { DrizzleDatabase } from "./drizzle.js"
import type { DbRunner, DrizzleTransaction } from "./state-store-db-runner.js"
import { makeDbRunner, runInTransaction } from "./state-store-db-runner.js"

type ErrorHandler<E> = (error: Error | string) => E

type PersistRows = {
  chatRows: Array<{
    chatId: string
    seed: number
    threadId: number | null
    title: string | null
    lastSummaryAt: string | null
  }>
  pollRows: Array<{
    pollId: string
    chatId: string
    messageId: number
    summaryDate: string
    threadId: number | null
  }>
  participantRows: Array<{
    chatId: string
    userId: number
    firstName: string
    lastName: string | null
    username: string | null
  }>
  historyRows: Array<{
    chatId: string
    pairKey: string
    count: number
  }>
  metaRow: {
    id: number
    updateOffset: number
    seed: number
    updatedAt: Date
  }
}

type PersistOperationArgs<E> = {
  readonly tx: DrizzleTransaction
  readonly runDb: DbRunner<E>
  readonly rows: PersistRows
}

const buildPersistRows = (
  state: BotState,
  metaRowId: number
): PersistRows => {
  const chatRows = Object.entries(state.chats).map(([chatId, chat]) => ({
    chatId,
    seed: chat.seed,
    threadId: chat.threadId,
    title: chat.title,
    lastSummaryAt: chat.lastSummaryAt
  }))
  const pollRows = Object.values(state.chats)
    .map((chat) => chat.poll)
    .filter((poll): poll is PollState => poll !== null)
    .map((poll) => ({
      pollId: poll.pollId,
      chatId: poll.chatId,
      messageId: poll.messageId,
      summaryDate: poll.summaryDate,
      threadId: poll.threadId
    }))
  const participantRows = Object.entries(state.chats).flatMap(([chatId, chat]) =>
    Object.values(chat.participants).map((participant) => ({
      chatId,
      userId: participant.id,
      firstName: participant.firstName,
      lastName: participant.lastName ?? null,
      username: participant.username ?? null
    }))
  )
  const historyRows = Object.entries(state.chats).flatMap(([chatId, chat]) =>
    Object.entries(chat.history).map(([pairKey, count]) => ({
      chatId,
      pairKey,
      count
    }))
  )
  const metaRow = {
    id: metaRowId,
    updateOffset: state.updateOffset,
    seed: state.seed,
    updatedAt: new Date()
  }

  return { chatRows, pollRows, participantRows, historyRows, metaRow }
}

const runQuery = <E, A>(
  runDb: DbRunner<E>,
  query: PromiseLike<A>
): Effect.Effect<A, E> => runDb(() => query)

const deleteAllRows = <E>(args: {
  readonly tx: DrizzleTransaction
  readonly runDb: DbRunner<E>
}): Effect.Effect<void, E> =>
  pipe(
    runQuery(args.runDb, args.tx.delete(participantsTable)),
    Effect.zipRight(runQuery(args.runDb, args.tx.delete(pairHistoryTable))),
    Effect.zipRight(runQuery(args.runDb, args.tx.delete(pollsTable))),
    Effect.zipRight(runQuery(args.runDb, args.tx.delete(chatsTable))),
    Effect.asVoid
  )

const insertWhen = <E, A>(
  condition: boolean,
  effect: () => Effect.Effect<A, E>
): Effect.Effect<void, E> => condition ? pipe(effect(), Effect.asVoid) : Effect.void

const insertDataRows = <E>(
  args: PersistOperationArgs<E>
): Effect.Effect<void, E> =>
  pipe(
    insertWhen(
      args.rows.chatRows.length > 0,
      () => runQuery(args.runDb, args.tx.insert(chatsTable).values(args.rows.chatRows))
    ),
    Effect.zipRight(
      insertWhen(
        args.rows.pollRows.length > 0,
        () => runQuery(args.runDb, args.tx.insert(pollsTable).values(args.rows.pollRows))
      )
    ),
    Effect.zipRight(
      insertWhen(
        args.rows.participantRows.length > 0,
        () =>
          runQuery(
            args.runDb,
            args.tx.insert(participantsTable).values(args.rows.participantRows)
          )
      )
    ),
    Effect.zipRight(
      insertWhen(
        args.rows.historyRows.length > 0,
        () =>
          runQuery(
            args.runDb,
            args.tx.insert(pairHistoryTable).values(args.rows.historyRows)
          )
      )
    ),
    Effect.asVoid
  )

const upsertMetaRow = <E>(args: {
  readonly tx: DrizzleTransaction
  readonly runDb: DbRunner<E>
  readonly metaRow: PersistRows["metaRow"]
}): Effect.Effect<void, E> =>
  pipe(
    runQuery(
      args.runDb,
      args.tx
        .insert(botMetaTable)
        .values(args.metaRow)
        .onConflictDoUpdate({
          target: botMetaTable.id,
          set: {
            updateOffset: args.metaRow.updateOffset,
            seed: args.metaRow.seed,
            updatedAt: args.metaRow.updatedAt
          }
        })
    ),
    Effect.asVoid
  )

const persistRows = <E>(
  args: PersistOperationArgs<E>
): Effect.Effect<void, E> =>
  pipe(
    deleteAllRows({ tx: args.tx, runDb: args.runDb }),
    Effect.zipRight(
      insertDataRows({ tx: args.tx, runDb: args.runDb, rows: args.rows })
    ),
    Effect.zipRight(
      upsertMetaRow({ tx: args.tx, runDb: args.runDb, metaRow: args.rows.metaRow })
    ),
    Effect.asVoid
  )

// CHANGE: persist normalized bot state into SQL tables
// WHY: replace JSON blob storage with typed relational persistence
// QUOTE(TZ): "Да реализуй нормальные схемы. Всё типизируй"
// REF: user-2026-01-16-normalized-db
// SOURCE: n/a
// FORMAT THEOREM: ∀s: persist(s) ⇒ db = s
// PURITY: SHELL
// EFFECT: Effect<void, E>
// INVARIANT: writes are atomic and consistent with FK constraints
// COMPLEXITY: O(n)/O(n)
export const makePersistState = <E>(args: {
  readonly metaRowId: number
  readonly onError: ErrorHandler<E>
}) =>
(db: DrizzleDatabase, state: BotState): Effect.Effect<void, E> => {
  const runDb = makeDbRunner(args.onError)
  const rows = buildPersistRows(state, args.metaRowId)
  return runInTransaction(db, args.onError, (tx) => persistRows({ tx, runDb, rows }))
}
