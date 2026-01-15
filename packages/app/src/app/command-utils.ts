import { Effect, pipe } from "effect"

import type { ChatId, UserId } from "../core/brand.js"
import { isGroupChat, normalizeCommand } from "../core/telegram-commands.js"
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

const requiresAdmin = (command: Command): boolean => command !== "/nextpoll"

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
            "This command is available to chat admins only.",
            threadId
          ),
          Effect.as(false)
        )
    )
  )

export const allowCommand = (
  command: Command,
  telegram: TelegramServiceShape,
  chatId: ChatId,
  userId: UserId,
  threadId?: number
): Effect.Effect<boolean, TelegramError> =>
  requiresAdmin(command)
    ? adminOnly(telegram, chatId, userId, threadId)
    : Effect.succeed(true)
