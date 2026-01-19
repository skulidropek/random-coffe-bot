import { Effect } from "effect"

import { MessageId, PollId, UserId } from "../../src/core/brand.js"
import type { ChatId, PollId as PollIdType, RngSeed } from "../../src/core/brand.js"
import type { BotState, ChatState, ChatType, Participant } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import type { StateStoreShape } from "../../src/shell/state-store.js"
import type { ChatInfo, ChatMemberStatus, ReplyKeyboard, TelegramServiceShape } from "../../src/shell/telegram.js"

export type PollCall = {
  readonly chatId: ChatId
  readonly question: string
  readonly options: ReadonlyArray<string>
  readonly threadId?: number | undefined
}

export type MessageCall = {
  readonly chatId: ChatId
  readonly text: string
  readonly threadId?: number | undefined
}

export type MessageWithKeyboardCall = {
  readonly chatId: ChatId
  readonly text: string
  readonly keyboard: ReplyKeyboard
  readonly threadId?: number | undefined
}

export type StopPollCall = {
  readonly chatId: ChatId
  readonly messageId: MessageId
}

export type MemberCall = {
  readonly chatId: ChatId
  readonly userId: UserId
}

export type MemberCountCall = {
  readonly chatId: ChatId
}

export type ChatCall = {
  readonly chatId: ChatId
}

type TelegramStubOptions = {
  readonly memberStatus: ChatMemberStatus
  readonly memberCount: number
  readonly pollResult: { readonly pollId: PollId; readonly messageId: MessageId }
  readonly botUsername: string
  readonly chatInfo: Omit<ChatInfo, "id">
}

type TelegramStubOverrides = {
  readonly memberStatus?: ChatMemberStatus
  readonly memberCount?: number
  readonly pollResult?: { readonly pollId: PollId; readonly messageId: MessageId }
  readonly botUsername?: string | undefined
  readonly chatInfo?: Omit<ChatInfo, "id">
}

const defaultPollResult = {
  pollId: PollId("poll-1"),
  messageId: MessageId(100)
}

const defaultBotUsername = "random_coffee_bot"

const resolveMemberStatus = (options?: TelegramStubOverrides): ChatMemberStatus =>
  options?.memberStatus ?? "administrator"

const resolveMemberCount = (options?: TelegramStubOverrides): number => options?.memberCount ?? 0

const resolvePollResult = (
  options?: TelegramStubOverrides
): { readonly pollId: PollId; readonly messageId: MessageId } => options?.pollResult ?? defaultPollResult

const resolveBotUsername = (options?: TelegramStubOverrides): string => options?.botUsername ?? defaultBotUsername

const resolveChatInfo = (options?: TelegramStubOverrides): Omit<ChatInfo, "id"> =>
  options?.chatInfo ?? {
    title: undefined,
    username: undefined,
    inviteLink: undefined
  }

const resolveTelegramStubOptions = (
  options?: TelegramStubOverrides
): TelegramStubOptions => ({
  memberStatus: resolveMemberStatus(options),
  memberCount: resolveMemberCount(options),
  pollResult: resolvePollResult(options),
  botUsername: resolveBotUsername(options),
  chatInfo: resolveChatInfo(options)
})

export const makeTelegramStub = (options?: TelegramStubOverrides) => {
  const pollCalls: Array<PollCall> = []
  const messageCalls: Array<MessageCall> = []
  const messageWithKeyboardCalls: Array<MessageWithKeyboardCall> = []
  const stopPollCalls: Array<StopPollCall> = []
  const memberCalls: Array<MemberCall> = []
  const memberCountCalls: Array<MemberCountCall> = []
  const chatCalls: Array<ChatCall> = []
  const resolvedOptions = resolveTelegramStubOptions(options)
  const pollResult = resolvedOptions.pollResult
  let memberStatus: ChatMemberStatus = resolvedOptions.memberStatus
  let memberCount = resolvedOptions.memberCount
  const botUsername = resolvedOptions.botUsername
  const chatInfo = resolvedOptions.chatInfo

  const telegram: TelegramServiceShape = {
    getUpdates: () => Effect.succeed([]),
    sendPoll: (chatId, question, optionsList, threadId) =>
      Effect.sync(() => {
        pollCalls.push({
          chatId,
          question,
          options: optionsList,
          threadId
        })
        return pollResult
      }),
    sendMessage: (chatId, text, threadId) =>
      Effect.sync(() => {
        messageCalls.push({ chatId, text, threadId })
        return MessageId(200)
      }),
    sendMessageWithKeyboard: (chatId, text, keyboard, threadId) =>
      Effect.sync(() => {
        messageWithKeyboardCalls.push({ chatId, text, keyboard, threadId })
        return MessageId(201)
      }),
    stopPoll: (chatId, messageId) =>
      Effect.sync(() => {
        stopPollCalls.push({ chatId, messageId })
      }),
    getChatMember: (chatId, userId) =>
      Effect.sync(() => {
        memberCalls.push({ chatId, userId })
        return memberStatus
      }),
    getChatMemberCount: (chatId) =>
      Effect.sync(() => {
        memberCountCalls.push({ chatId })
        return memberCount
      }),
    getChat: (chatId) =>
      Effect.sync(() => {
        chatCalls.push({ chatId })
        return {
          id: chatId,
          ...chatInfo
        }
      }),
    getMe: Effect.sync(() => ({
      id: UserId(1),
      username: botUsername,
      firstName: "Random",
      lastName: "Coffee"
    }))
  }

  const setMemberStatus = (status: ChatMemberStatus): void => {
    memberStatus = status
  }

  const setMemberCount = (count: number): void => {
    memberCount = count
  }

  return {
    telegram,
    pollCalls,
    messageCalls,
    messageWithKeyboardCalls,
    stopPollCalls,
    memberCalls,
    memberCountCalls,
    chatCalls,
    setMemberStatus,
    setMemberCount
  }
}

export const makeStateStoreStub = (initial: BotState) => {
  const setCalls: Array<BotState> = []
  let current = initial

  const stateStore: StateStoreShape = {
    get: Effect.sync(() => current),
    set: (next) =>
      Effect.sync(() => {
        current = next
        setCalls.push(next)
      })
  }

  return {
    stateStore,
    setCalls,
    getCurrent: () => current
  }
}

export const makeStateWithChat = (
  chatId: ChatId,
  chat: ChatState,
  seed: RngSeed
): BotState => ({
  ...emptyState(seed),
  chats: {
    [chatId]: chat
  }
})

export const makeStateWithPoll = (
  chatId: ChatId,
  chat: ChatState,
  pollId: PollIdType,
  seed: RngSeed
): BotState => ({
  ...makeStateWithChat(chatId, chat, seed),
  pollIndex: {
    [pollId]: chatId
  }
})

export const makeParticipant = (id: number, name: string): Participant => ({
  id: UserId(id),
  firstName: name
})

export const makeMessageUpdate = (params: {
  readonly updateId: number
  readonly chatId: ChatId
  readonly text: string
  readonly from: Participant
  readonly threadId?: number | undefined
  readonly chatTitle?: string | undefined
  readonly chatType?: ChatType | undefined
}): IncomingUpdate => ({
  updateId: params.updateId,
  message: {
    chatId: params.chatId,
    chatType: params.chatType ?? "supergroup",
    text: params.text,
    from: params.from,
    messageThreadId: params.threadId,
    chatTitle: params.chatTitle
  }
})
