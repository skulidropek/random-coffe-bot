import { Effect } from "effect"

import { MessageId, PollId } from "../../src/core/brand.js"
import type { ChatId, PollId as PollIdType, RngSeed, UserId } from "../../src/core/brand.js"
import type { BotState, ChatState } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
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
      })
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
