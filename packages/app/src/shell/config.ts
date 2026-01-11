import * as S from "@effect/schema/Schema"
import dotenv from "dotenv"
import { Data, Effect, pipe } from "effect"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
}> {}

const envSchema = S.Struct({
  BOT_TOKEN: S.NonEmptyString,
  BOT_TIMEZONE: S.optionalWith(S.NonEmptyString, { default: () => "UTC" }),
  BOT_STATE_PATH: S.optionalWith(S.NonEmptyString, {
    default: () => "./data/state.json"
  })
})

type Env = S.Schema.Type<typeof envSchema>

export type Config = {
  readonly token: string
  readonly timeZone: string
  readonly statePath: string
}

// CHANGE: decode bot configuration from environment variables
// WHY: keep boundary data validated before entering the domain
// QUOTE(TZ): "Его добавляют в группу и он создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall env: decode(env) = config -> config.token != ""
// PURITY: SHELL
// EFFECT: Effect<Config, ConfigError, never>
// INVARIANT: timezone is always a non-empty string
// COMPLEXITY: O(1)/O(1)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(moduleDir, ".env"),
  path.resolve(moduleDir, "../.env"),
  path.resolve(moduleDir, "../../.env")
]

const findEnvPath = (): string | null => {
  for (const envPath of candidateEnvPaths) {
    if (existsSync(envPath)) {
      return envPath
    }
  }
  return null
}

const loadEnv = pipe(
  Effect.sync(() => {
    const envPath = findEnvPath()
    if (envPath) {
      dotenv.config({ path: envPath })
    } else {
      dotenv.config()
    }
  }),
  Effect.asVoid
)

export const loadConfig = pipe(
  loadEnv,
  Effect.flatMap(() => Effect.sync(() => process.env)),
  Effect.flatMap(S.decodeUnknown(envSchema)),
  Effect.map((env: Env): Config => ({
    token: env.BOT_TOKEN,
    timeZone: env.BOT_TIMEZONE,
    statePath: env.BOT_STATE_PATH
  })),
  Effect.mapError((error) => new ConfigError({ message: error instanceof Error ? error.message : String(error) }))
)
