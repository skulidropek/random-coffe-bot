import { Effect } from "effect"

import { MessageId, PollId, UserId } from "../../src/core/brand.js"
import type { ChatId, PollId as PollIdType, RngSeed } from "../../src/core/brand.js"
import type { BotState, ChatState, ChatType, Participant } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import type { StateStoreShape } from "../../src/shell/state-store.js"
import type { ChatMemberStatus, TelegramServiceShape } from "../../src/shell/telegram.js"

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

export type StopPollCall = {
  readonly chatId: ChatId
  readonly messageId: MessageId
}

export type MemberCall = {
  readonly chatId: ChatId
  readonly userId: UserId
}

export const makeTelegramStub = (options?: {
  readonly memberStatus?: ChatMemberStatus
  readonly pollResult?: { readonly pollId: PollId; readonly messageId: MessageId }
  readonly botUsername?: string | undefined
}) => {
  const pollCalls: Array<PollCall> = []
  const messageCalls: Array<MessageCall> = []
  const stopPollCalls: Array<StopPollCall> = []
  const memberCalls: Array<MemberCall> = []
  const pollResult = options?.pollResult ?? {
    pollId: PollId("poll-1"),
    messageId: MessageId(100)
  }
  let memberStatus: ChatMemberStatus = options?.memberStatus ?? "administrator"
  const botUsername = options?.botUsername ?? "random_coffee_bot"

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
    stopPoll: (chatId, messageId) =>
      Effect.sync(() => {
        stopPollCalls.push({ chatId, messageId })
      }),
    getChatMember: (chatId, userId) =>
      Effect.sync(() => {
        memberCalls.push({ chatId, userId })
        return memberStatus
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

  return {
    telegram,
    pollCalls,
    messageCalls,
    stopPollCalls,
    memberCalls,
    setMemberStatus
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
