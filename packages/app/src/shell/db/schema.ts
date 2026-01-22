import { bigint, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

export const botMetaTable = pgTable("bot_meta", {
  id: integer("id").primaryKey(),
  updateOffset: integer("update_offset").notNull(),
  seed: integer("seed").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
})

export const chatsTable = pgTable("chats", {
  chatId: text("chat_id").primaryKey(),
  seed: integer("seed").notNull(),
  threadId: integer("thread_id"),
  title: text("title"),
  inviteLink: text("invite_link"),
  lastSummaryAt: text("last_summary_at")
})

export const pollsTable = pgTable(
  "polls",
  {
    pollId: text("poll_id").primaryKey(),
    chatId: text("chat_id").notNull().references(() => chatsTable.chatId),
    messageId: integer("message_id").notNull(),
    summaryDate: text("summary_date").notNull(),
    threadId: integer("thread_id")
  },
  (table) => [
    uniqueIndex("polls_chat_id_unique").on(table.chatId)
  ]
)

export const participantsTable = pgTable(
  "participants",
  {
    chatId: text("chat_id").notNull().references(() => chatsTable.chatId),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    username: text("username")
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.userId] })
  ]
)

export const profilesTable = pgTable(
  "profiles",
  {
    userId: bigint("user_id", { mode: "number" }).notNull().primaryKey(),
    text: text("text").notNull()
  }
)

export const pairHistoryTable = pgTable(
  "pair_history",
  {
    chatId: text("chat_id").notNull().references(() => chatsTable.chatId),
    pairKey: text("pair_key").notNull(),
    count: integer("count").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.pairKey] })
  ]
)

export type BotMetaRow = typeof botMetaTable.$inferSelect
export type ChatRow = typeof chatsTable.$inferSelect
export type PollRow = typeof pollsTable.$inferSelect
export type ParticipantRow = typeof participantsTable.$inferSelect
export type ProfileRow = typeof profilesTable.$inferSelect
export type PairHistoryRow = typeof pairHistoryTable.$inferSelect
