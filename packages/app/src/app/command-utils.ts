import { Effect, pipe } from "effect"

import type { ChatId, UserId } from "../core/brand.js"
import { isGroupChat, normalizeCommand } from "../core/telegram-commands.js"
import { replyAdminOnly } from "../core/text.js"
import type { IncomingUpdate } from "../core/updates.js"
import type { ChatMemberStatus, TelegramError, TelegramServiceShape } from "../shell/telegram.js"

export type Command = "/settopic" | "/poll" | "/summary" | "/nextpoll"

const normalizeUsername = (value: string): string => value.replace(/^@/, "").toLowerCase()

const extractToken = (text: string): string => text.trim().split(/\s+/)[0] ?? ""

export const parseCommandTarget = (
  text: string
): { readonly command: string; readonly target?: string | undefined } => {
  const token = extractToken(text)
  const [rawCommand, rawTarget] = token.split("@")
  return {
    command: normalizeCommand(rawCommand ?? ""),
    target: rawTarget ? normalizeUsername(rawTarget) : undefined
  }
}

export const matchesTarget = (target: string | undefined, botUsername?: string): boolean =>
  !target || !botUsername || normalizeUsername(botUsername) === target

const parseCommand = (text: string, botUsername?: string): Command | null => {
  const parsed = parseCommandTarget(text)
  if (!matchesTarget(parsed.target, botUsername)) {
    return null
  }
  const command = parsed.command
  return command === "/settopic" ||
      command === "/poll" ||
      command === "/summary" ||
      command === "/nextpoll"
    ? command
    : null
}

export type CommandEnvelope = {
  readonly chatId: ChatId
  readonly actorId: UserId
  readonly command: Command
  readonly replyThreadId?: number | undefined
  readonly messageThreadId?: number | undefined
  readonly threadId: number | null
}

export const toCommandEnvelope = (
  update: IncomingUpdate,
  botUsername?: string
): CommandEnvelope | null => {
  const message = update.message
  if (!message || !isGroupChat(message.chatType)) {
    return null
  }
  const actor = message.from
  if (!actor) {
    return null
  }
  const command = parseCommand(message.text, botUsername)
  if (!command) {
    return null
  }
  return {
    chatId: message.chatId,
    actorId: actor.id,
    command,
    replyThreadId: message.messageThreadId ?? undefined,
    messageThreadId: message.messageThreadId,
    threadId: message.messageThreadId ?? null
  }
}

const isAdmin = (status: ChatMemberStatus): boolean => status === "creator" || status === "administrator"

const adminOnly = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  userId: UserId,
  threadId?: number
): Effect.Effect<boolean, TelegramError> =>
  pipe(
    telegram.getChatMember(chatId, userId),
    Effect.flatMap((status) =>
      isAdmin(status)
        ? Effect.succeed(true)
        : pipe(
          telegram.sendMessage(
            chatId,
            replyAdminOnly(),
            threadId
          ),
          Effect.as(false)
        )
    )
  )

// CHANGE: gate all chat commands behind admin checks
// WHY: prevent non-admin users from changing bot configuration or state
// QUOTE(TZ): n/a
// REF: user-2026-01-17-admin-commands
// SOURCE: n/a
// FORMAT THEOREM: forall u: allow(u) = true -> isAdmin(u)
// PURITY: SHELL
// EFFECT: Effect<boolean, TelegramError, never>
// INVARIANT: non-admin users receive the admin-only reply
// COMPLEXITY: O(1)/O(1)
export const allowAdminOnly = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  userId: UserId,
  threadId?: number
): Effect.Effect<boolean, TelegramError> => adminOnly(telegram, chatId, userId, threadId)

export const allowCommand = (
  telegram: TelegramServiceShape,
  chatId: ChatId,
  userId: UserId,
  threadId?: number
): Effect.Effect<boolean, TelegramError> => allowAdminOnly(telegram, chatId, userId, threadId)
