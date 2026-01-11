import { Effect, pipe } from "effect"

import type { BotState, Participant } from "../core/domain.js"
import { isGroupChat, normalizeCommand } from "../core/telegram-commands.js"
import type { IncomingUpdate } from "../core/updates.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"

const pollWeekdays = "Polls: Friday/Saturday. Results: Monday."
const pollPermissionHint = "Make sure the bot can send polls in this chat."

const formatParticipant = (participant: Participant | undefined): string => {
  if (!participant) {
    return "participant=none"
  }
  const username = participant.username ? `@${participant.username}` : "-"
  const name = participant.lastName
    ? `${participant.firstName} ${participant.lastName}`
    : participant.firstName
  return `participant id=${participant.id} username=${username} name="${name}"`
}

const formatUpdate = (update: IncomingUpdate): string => {
  const parts: Array<string> = [`updateId=${update.updateId}`]
  if (update.chatSeen) {
    parts.push(
      `chatSeen chatId=${update.chatSeen.chatId} type=${update.chatSeen.chatType}`
    )
  }
  if (update.pollVote) {
    const options = `[${update.pollVote.optionIds.join(",")}]`
    parts.push(
      `pollVote pollId=${update.pollVote.pollId} ${formatParticipant(update.pollVote.participant)} options=${options}`
    )
  }
  if (update.message) {
    parts.push(
      `message chatId=${update.message.chatId} type=${update.message.chatType} text="${update.message.text}"`
    )
  }
  return parts.join(" | ")
}

export const logUpdates = (
  updates: ReadonlyArray<IncomingUpdate>
): Effect.Effect<void> =>
  Effect.gen(function*(_) {
    if (updates.length === 0) {
      yield* _(Effect.logInfo("Telegram: апдейтов нет"))
      return
    }
    yield* _(Effect.logInfo(`Telegram: получено апдейтов ${updates.length}`))
    for (const update of updates) {
      yield* _(Effect.logInfo(`Telegram: ${formatUpdate(update)}`))
    }
  })

export const logState = (state: BotState): Effect.Effect<void> => {
  const chatsCount = Object.keys(state.chats).length
  const pollIndexCount = Object.keys(state.pollIndex).length
  return Effect.logInfo(
    `State: chats=${chatsCount} pollIndex=${pollIndexCount} updateOffset=${state.updateOffset}`
  )
}

export const handleMessages = (
  updates: ReadonlyArray<IncomingUpdate>,
  telegram: TelegramServiceShape
): Effect.Effect<void, TelegramError> =>
  Effect.gen(function*(_) {
    for (const update of updates) {
      const message = update.message
      if (!message || !isGroupChat(message.chatType)) {
        continue
      }
      const command = normalizeCommand(message.text)
      if (command === "/start" || command === "/help") {
        const text = [
          "Random Coffee bot is active ✅",
          pollWeekdays,
          pollPermissionHint
        ].join("\n")
        yield* _(telegram.sendMessage(message.chatId, text, message.messageThreadId))
      }
    }
  })

export type LoggableError =
  | Error
  | string
  | {
    readonly _tag?: string
    readonly message?: string
    readonly description?: string
    readonly errorCode?: number
    readonly method?: string
  }

type TaggedError = {
  readonly _tag?: string
  readonly message?: string
  readonly description?: string
  readonly errorCode?: number
  readonly method?: string
}

const hasTag = (error: LoggableError): error is TaggedError => typeof error !== "string" && "_tag" in error

const formatCode = (error: TaggedError): string => error.errorCode === undefined ? "" : ` code=${error.errorCode}`

const formatMethod = (error: TaggedError): string => error.method ? ` method=${error.method}` : ""

const formatTaggedError = (error: TaggedError): string => {
  const tag = error._tag ?? "UnknownError"
  const message = error.message ?? error.description ?? ""
  const base = message ? `${tag}: ${message}` : tag
  return `${base}${formatCode(error)}${formatMethod(error)}`
}

export const formatError = (error: LoggableError): string => {
  if (typeof error === "string") {
    return error
  }
  if (hasTag(error)) {
    return formatTaggedError(error)
  }
  return `${error.name}: ${error.message}`
}

export const logAndIgnore = <E extends LoggableError, R>(
  effect: Effect.Effect<void, E, R>
): Effect.Effect<void, never, R> =>
  effect.pipe(
    Effect.catchAll((error) => Effect.logError(formatError(error)))
  )

export const logAndFallback = <A, E extends LoggableError, R>(
  effect: Effect.Effect<A, E, R>,
  fallback: A
): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.catchAll((error) =>
      pipe(
        Effect.logError(formatError(error)),
        Effect.as(fallback)
      )
    )
  )
