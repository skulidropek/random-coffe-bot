import { Context, Data, Effect, pipe } from "effect"
import { Bot, GrammyError, HttpError } from "grammy"
import type { Update, User } from "grammy/types"

import { ChatId, MessageId, PollId, UserId } from "../core/brand.js"
import type { ChatType, Participant } from "../core/domain.js"
import type { IncomingUpdate } from "../core/updates.js"

export class TelegramApiError extends Data.TaggedError("TelegramApiError")<{
  readonly description?: string | undefined
  readonly errorCode?: number | undefined
  readonly method?: string | undefined
  readonly message?: string | undefined
}> {}

export class TelegramNetworkError extends Data.TaggedError("TelegramNetworkError")<{
  readonly message: string
}> {}

export type TelegramError = TelegramApiError | TelegramNetworkError

const toChatType = (value: string): ChatType =>
  value === "group" || value === "supergroup" || value === "private"
    ? value
    : "private"

const toParticipant = (user: User): Participant => ({
  id: UserId(user.id),
  firstName: user.first_name,
  lastName: user.last_name,
  username: user.username
})

const extractChatSeen = (update: Update): IncomingUpdate["chatSeen"] => {
  const fromMessage = update.message?.chat
  const fromMember = update.my_chat_member?.chat
  const chat = fromMessage ?? fromMember
  if (!chat) {
    return undefined
  }
  return {
    chatId: ChatId(chat.id.toString()),
    chatType: toChatType(chat.type),
    chatTitle: chat.title
  }
}

const extractPollVote = (update: Update): IncomingUpdate["pollVote"] => {
  const pollAnswer = update.poll_answer
  if (!pollAnswer) {
    return undefined
  }
  return {
    pollId: PollId(pollAnswer.poll_id),
    participant: pollAnswer.user ? toParticipant(pollAnswer.user) : undefined,
    optionIds: pollAnswer.option_ids
  }
}

const extractMessage = (update: Update): IncomingUpdate["message"] => {
  const message = update.message
  const text = message?.text
  if (!message || !text) {
    return undefined
  }
  const from = toParticipant(message.from)
  return {
    chatId: ChatId(message.chat.id.toString()),
    chatType: toChatType(message.chat.type),
    text,
    from,
    messageThreadId: message.message_thread_id,
    chatTitle: message.chat.title
  }
}

const toIncomingUpdate = (update: Update): IncomingUpdate => ({
  updateId: update.update_id,
  chatSeen: extractChatSeen(update),
  pollVote: extractPollVote(update),
  message: extractMessage(update)
})

export type SendPollResult = {
  readonly pollId: PollId
  readonly messageId: MessageId
}

export type ChatMemberStatus =
  | "creator"
  | "administrator"
  | "member"
  | "restricted"
  | "left"
  | "kicked"

export type BotProfile = {
  readonly id: UserId
  readonly username?: string | undefined
  readonly firstName: string
  readonly lastName?: string | undefined
}

export type TelegramServiceShape = {
  readonly getUpdates: (
    offset: number,
    timeoutSeconds: number
  ) => Effect.Effect<ReadonlyArray<IncomingUpdate>, TelegramError>
  readonly sendPoll: (
    chatId: ChatId,
    question: string,
    options: ReadonlyArray<string>,
    threadId?: number
  ) => Effect.Effect<SendPollResult, TelegramError>
  readonly sendMessage: (
    chatId: ChatId,
    text: string,
    threadId?: number
  ) => Effect.Effect<MessageId, TelegramError>
  readonly stopPoll: (
    chatId: ChatId,
    messageId: MessageId
  ) => Effect.Effect<void, TelegramError>
  readonly getChatMember: (
    chatId: ChatId,
    userId: UserId
  ) => Effect.Effect<ChatMemberStatus, TelegramError>
  readonly getMe: Effect.Effect<BotProfile, TelegramError>
}

export class TelegramService extends Context.Tag("TelegramService")<
  TelegramService,
  TelegramServiceShape
>() {}

const mapError = (error: Error | string): TelegramError => {
  if (error instanceof GrammyError) {
    return new TelegramApiError({
      description: error.description,
      errorCode: error.error_code,
      method: error.method,
      message: error.message
    })
  }
  if (error instanceof HttpError) {
    return new TelegramNetworkError({ message: error.message })
  }
  return new TelegramNetworkError({
    message: error instanceof Error ? error.message : error
  })
}

const makeGetUpdates = (
  bot: Bot
): TelegramServiceShape["getUpdates"] =>
(offset, timeoutSeconds) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        bot.api.getUpdates({
          offset,
          timeout: timeoutSeconds,
          allowed_updates: ["message", "poll_answer", "my_chat_member"]
        }),
      catch: (error) => mapError(error instanceof Error ? error : String(error))
    }),
    Effect.map((updates) => updates.map((update) => toIncomingUpdate(update)))
  )

const makeSendPoll = (
  bot: Bot
): TelegramServiceShape["sendPoll"] =>
(chatId, question, options, threadId) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        bot.api.sendPoll(
          chatId,
          question,
          [...options],
          threadId === undefined
            ? {
              is_anonymous: false,
              allows_multiple_answers: false
            }
            : {
              is_anonymous: false,
              allows_multiple_answers: false,
              message_thread_id: threadId
            }
        ),
      catch: (error) => mapError(error instanceof Error ? error : String(error))
    }),
    Effect.flatMap((message) => {
      const pollId = message.poll.id
      return Effect.succeed({
        pollId: PollId(pollId),
        messageId: MessageId(message.message_id)
      })
    })
  )

const makeSendMessage = (
  bot: Bot
): TelegramServiceShape["sendMessage"] =>
(chatId, text, threadId) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        bot.api.sendMessage(
          chatId,
          text,
          threadId === undefined
            ? { parse_mode: "HTML" }
            : { parse_mode: "HTML", message_thread_id: threadId }
        ),
      catch: (error) => mapError(error instanceof Error ? error : String(error))
    }),
    Effect.map((message) => MessageId(message.message_id))
  )

const makeGetChatMember = (
  bot: Bot
): TelegramServiceShape["getChatMember"] =>
(chatId, userId) =>
  pipe(
    Effect.tryPromise({
      try: () => bot.api.getChatMember(chatId, userId),
      catch: (error) => mapError(error instanceof Error ? error : String(error))
    }),
    Effect.map((member) => member.status)
  )

const makeGetMe = (
  bot: Bot
): TelegramServiceShape["getMe"] =>
  pipe(
    Effect.tryPromise({
      try: () => bot.api.getMe(),
      catch: (error) => mapError(error instanceof Error ? error : String(error))
    }),
    Effect.map((user) => ({
      id: UserId(user.id),
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name
    }))
  )

const makeStopPoll = (
  bot: Bot
): TelegramServiceShape["stopPoll"] =>
(chatId, messageId) =>
  pipe(
    Effect.tryPromise({
      try: () => bot.api.stopPoll(chatId, messageId),
      catch: (error) => mapError(error instanceof Error ? error : String(error))
    }),
    Effect.asVoid
  )

// CHANGE: construct a Telegram service backed by grammY
// WHY: reuse a typed Telegram Bot API client instead of custom HTTP calls
// QUOTE(TZ): "Используй значит grammy"
// REF: user-2026-01-09-grammy
// SOURCE: n/a
// FORMAT THEOREM: forall req: api(req) -> ok | typed error
// PURITY: SHELL
// EFFECT: Effect<TelegramServiceShape, TelegramError, never>
// INVARIANT: all Telegram calls flow through grammY client
// COMPLEXITY: O(1)/O(1)
export const makeTelegramService = (token: string): TelegramServiceShape => {
  const bot = new Bot(token)

  return {
    getUpdates: makeGetUpdates(bot),
    sendPoll: makeSendPoll(bot),
    sendMessage: makeSendMessage(bot),
    stopPoll: makeStopPoll(bot),
    getChatMember: makeGetChatMember(bot),
    getMe: makeGetMe(bot)
  }
}
