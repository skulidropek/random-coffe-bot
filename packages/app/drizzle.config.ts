import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shell/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.BOT_DATABASE_URL ?? ""
  }
})
