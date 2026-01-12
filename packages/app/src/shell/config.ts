import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as S from "@effect/schema/Schema"
import dotenv from "dotenv"
import { Data, Effect, pipe } from "effect"

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
}> {}

const envSchema = S.Struct({
  BOT_TOKEN: S.NonEmptyString,
  BOT_TIMEZONE: S.optionalWith(S.NonEmptyString, { default: () => "UTC" }),
  BOT_DATABASE_URL: S.NonEmptyString
})

type Env = S.Schema.Type<typeof envSchema>

export type Config = {
  readonly token: string
  readonly timeZone: string
  readonly databaseUrl: string
}

const toConfigError = (
  error: ConfigError | Error | string
): ConfigError =>
  error instanceof ConfigError
    ? error
    : new ConfigError({
      message: error instanceof Error ? error.message : error
    })

// CHANGE: decode bot configuration from environment variables
// WHY: keep boundary data validated before entering the domain
// QUOTE(TZ): "Его добавляют в группу и он создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall env: decode(env) = config -> config.token != ""
// PURITY: SHELL
// EFFECT: Effect<Config, ConfigError, FileSystem | Path>
// INVARIANT: timezone is always a non-empty string
// COMPLEXITY: O(1)/O(1)
const loadEnv = pipe(
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const modulePath = yield* _(path.fromFileUrl(new URL(import.meta.url)))
    const moduleDir = path.dirname(modulePath)
    const cwd = process.cwd()
    const candidateEnvPaths = [
      path.resolve(cwd, ".env"),
      path.resolve(cwd, "../.env"),
      path.resolve(cwd, "../../.env"),
      path.resolve(moduleDir, ".env"),
      path.resolve(moduleDir, "../.env"),
      path.resolve(moduleDir, "../../.env")
    ]

    let resolvedEnvPath: string | null = null
    for (const envPath of candidateEnvPaths) {
      const exists = yield* _(fs.exists(envPath))
      if (exists) {
        resolvedEnvPath = envPath
        break
      }
    }

    if (resolvedEnvPath) {
      dotenv.config({ path: resolvedEnvPath })
    } else {
      dotenv.config()
    }
  }),
  Effect.mapError((error) => toConfigError(error instanceof Error ? error : String(error))),
  Effect.asVoid
)

export const loadConfig = pipe(
  loadEnv,
  Effect.flatMap(() => Effect.sync(() => process.env)),
  Effect.flatMap(S.decodeUnknown(envSchema)),
  Effect.map((env: Env): Config => ({
    token: env.BOT_TOKEN,
    timeZone: env.BOT_TIMEZONE,
    databaseUrl: env.BOT_DATABASE_URL
  })),
  Effect.mapError((error) => toConfigError(error instanceof Error ? error : String(error)))
)
