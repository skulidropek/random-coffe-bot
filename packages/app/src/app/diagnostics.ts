import { Effect, pipe } from "effect"

import type { BotState } from "../core/domain.js"
import { ensureChat, setThreadId } from "../core/state.js"
import { isGroupChat } from "../core/telegram-commands.js"
import {
  formatPrivateStartReply,
  formatStartReply,
  formatUpdateLog,
  logStateSnapshot,
  logTelegramNoUpdates,
  logTelegramReceivedUpdates,
  logTelegramUpdate,
  privateStartButtons
} from "../core/text.js"
import type { ChatMessage, IncomingUpdate } from "../core/updates.js"
import type { ReplyKeyboard, TelegramServiceShape } from "../shell/telegram.js"
import { allowAdminOnly, matchesTarget, parseCommandTarget } from "./command-utils.js"

export const logUpdates = (
  updates: ReadonlyArray<IncomingUpdate>
): Effect.Effect<void> =>
  Effect.gen(function*(_) {
    if (updates.length === 0) {
      yield* _(Effect.logInfo(logTelegramNoUpdates()))
      return
    }
    yield* _(Effect.logInfo(logTelegramReceivedUpdates(updates.length)))
    for (const update of updates) {
      yield* _(Effect.logInfo(logTelegramUpdate(formatUpdateLog(update))))
    }
  })

export const logState = (state: BotState): Effect.Effect<void> => {
  const chatsCount = Object.keys(state.chats).length
  const pollIndexCount = Object.keys(state.pollIndex).length
  return Effect.logInfo(
    logStateSnapshot(chatsCount, pollIndexCount, state.updateOffset)
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
  const text = formatStartReply()
  return logAndIgnore(
    pipe(
      telegram.sendMessage(message.chatId, text, message.messageThreadId),
      Effect.asVoid
    )
  )
}

const buildPrivateStartKeyboard = (): ReplyKeyboard => ({
  keyboard: privateStartButtons().map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true
})

const sendPrivateStartReply = (
  message: ChatMessage,
  telegram: TelegramServiceShape
): Effect.Effect<void> => {
  const text = formatPrivateStartReply()
  return logAndIgnore(
    pipe(
      telegram.sendMessageWithKeyboard(message.chatId, text, buildPrivateStartKeyboard()),
      Effect.asVoid
    )
  )
}

// CHANGE: guard /start and /help against non-admin users
// WHY: prevent non-admin users from changing thread bindings via bot commands
// QUOTE(TZ): n/a
// REF: user-2026-01-17-admin-commands
// SOURCE: n/a
// FORMAT THEOREM: forall m: allow(m) = true -> isAdmin(m.from)
// PURITY: SHELL
// EFFECT: Effect<boolean, never, never>
// INVARIANT: non-admins receive the admin-only reply
// COMPLEXITY: O(1)/O(1)
const allowStartCommand = (
  message: ChatMessage,
  telegram: TelegramServiceShape
): Effect.Effect<boolean> =>
  message.from
    ? logAndFallback(
      allowAdminOnly(
        telegram,
        message.chatId,
        message.from.id,
        message.messageThreadId
      ),
      false
    )
    : Effect.succeed(false)

const handleMessage = (
  state: BotState,
  update: IncomingUpdate,
  telegram: TelegramServiceShape,
  botUsername?: string
): Effect.Effect<BotState> =>
  Effect.gen(function*(_) {
    const message = update.message
    if (!message) {
      return state
    }
    if (isGroupChat(message.chatType)) {
      if (!isStartCommand(message.text, botUsername)) {
        return state
      }
      const allowed = yield* _(allowStartCommand(message, telegram))
      if (!allowed) {
        return state
      }
      const updated = updateThreadFromStart(state, message)
      yield* _(sendStartReply(message, telegram))
      return updated
    }
    if (message.chatType !== "private") {
      return state
    }
    if (!isStartCommand(message.text, botUsername)) {
      return state
    }
    yield* _(sendPrivateStartReply(message, telegram))
    return state
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
