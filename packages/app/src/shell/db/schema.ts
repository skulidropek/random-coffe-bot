import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const botStateTable = pgTable("bot_state", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
})

export type BotStateRow = typeof botStateTable.$inferSelect
