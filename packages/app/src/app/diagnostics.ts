import { Effect, pipe } from "effect"

import type { BotState, Participant } from "../core/domain.js"
import { ensureChat, setThreadId } from "../core/state.js"
import { isGroupChat } from "../core/telegram-commands.js"
import type { ChatMessage, IncomingUpdate } from "../core/updates.js"
import type { TelegramServiceShape } from "../shell/telegram.js"
import { matchesTarget, parseCommandTarget } from "./command-utils.js"

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

const isStartCommand = (text: string, botUsername?: string): boolean => {
  const parsed = parseCommandTarget(text)
  if (!matchesTarget(parsed.target, botUsername)) {
    return false
  }
  return parsed.command === "/start" || parsed.command === "/help"
}

const updateThreadFromStart = (state: BotState, message: ChatMessage): BotState => {
  const threadId = message.messageThreadId ?? null
  const withChat = ensureChat(state, message.chatId)
  const current = withChat.chats[message.chatId]
  return current && current.threadId === threadId
    ? withChat
    : setThreadId(withChat, message.chatId, threadId)
}

const sendStartReply = (
  message: ChatMessage,
  telegram: TelegramServiceShape
): Effect.Effect<void> => {
  const text = [
    "Random Coffee bot is active ✅",
    pollWeekdays,
    pollPermissionHint
  ].join("\n")
  return logAndIgnore(
    pipe(
      telegram.sendMessage(message.chatId, text, message.messageThreadId),
      Effect.asVoid
    )
  )
}

const handleMessage = (
  state: BotState,
  update: IncomingUpdate,
  telegram: TelegramServiceShape,
  botUsername?: string
): Effect.Effect<BotState> =>
  Effect.gen(function*(_) {
    const message = update.message
    if (!message || !isGroupChat(message.chatType)) {
      return state
    }
    if (!isStartCommand(message.text, botUsername)) {
      return state
    }
    const updated = updateThreadFromStart(state, message)
    yield* _(sendStartReply(message, telegram))
    return updated
  })

// CHANGE: keep /start topic bindings while ignoring Telegram send errors
// WHY: persist thread affinity for /start and avoid aborting the update loop
// QUOTE(TZ): "сохранение топиков исходя из этих команд"
// REF: user-2026-01-15-topic-binding
// SOURCE: n/a
// FORMAT THEOREM: forall u: handleMessages(s,u).updateOffset = s.updateOffset
// PURITY: SHELL
// EFFECT: Effect<BotState, never, never>
// INVARIANT: sendMessage failures do not escape to caller
// COMPLEXITY: O(n)/O(1)
export const handleMessages = (
  state: BotState,
  updates: ReadonlyArray<IncomingUpdate>,
  telegram: TelegramServiceShape,
  botUsername?: string
): Effect.Effect<BotState> =>
  Effect.gen(function*(_) {
    let updated = state
    for (const update of updates) {
      updated = yield* _(handleMessage(updated, update, telegram, botUsername))
    }
    return updated
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
    Effect.matchEffect({
      onFailure: (error) => Effect.logError(formatError(error)),
      onSuccess: () => Effect.void
    })
  )

export const logAndFallback = <A, E extends LoggableError, R>(
  effect: Effect.Effect<A, E, R>,
  fallback: A
): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        pipe(
          Effect.logError(formatError(error)),
          Effect.as(fallback)
        ),
      onSuccess: (value) => Effect.succeed(value)
    })
  )
