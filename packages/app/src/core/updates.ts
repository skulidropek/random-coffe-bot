import type { ChatId, PollId } from "./brand.js"
import type { BotState, ChatType, Participant } from "./domain.js"
import { removeParticipant, upsertParticipant } from "./participants.js"
import { ensureChat, setChatTitle } from "./state.js"
import { isGroupChat } from "./telegram-commands.js"

export type PollVote = {
  readonly pollId: PollId
  readonly participant?: Participant | undefined
  readonly optionIds: ReadonlyArray<number>
}

export type ChatSeen = {
  readonly chatId: ChatId
  readonly chatType: ChatType
  readonly chatTitle?: string | undefined
}

export type ChatMessage = {
  readonly chatId: ChatId
  readonly chatType: ChatType
  readonly text: string
  readonly from?: Participant | undefined
  readonly messageThreadId?: number | undefined
  readonly chatTitle?: string | undefined
}

export type IncomingUpdate = {
  readonly updateId: number
  readonly pollVote?: PollVote | undefined
  readonly chatSeen?: ChatSeen | undefined
  readonly message?: ChatMessage | undefined
}

const applyChatMetadata = (
  state: BotState,
  chatId: ChatId,
  chatType: ChatType,
  chatTitle?: string
): BotState => {
  if (!isGroupChat(chatType)) {
    return state
  }
  const withChat = ensureChat(state, chatId)
  return chatTitle ? setChatTitle(withChat, chatId, chatTitle) : withChat
}

const applyChatSeen = (state: BotState, chatSeen: ChatSeen): BotState =>
  applyChatMetadata(state, chatSeen.chatId, chatSeen.chatType, chatSeen.chatTitle)

const applyMessage = (state: BotState, message: ChatMessage): BotState =>
  applyChatMetadata(state, message.chatId, message.chatType, message.chatTitle)

const applyPollVote = (state: BotState, pollVote: PollVote): BotState => {
  const chatId = state.pollIndex[pollVote.pollId]
  if (!chatId) {
    return state
  }

  const chat = state.chats[chatId]
  if (!chat) {
    return state
  }

  const participant = pollVote.participant
  if (participant === undefined) {
    return state
  }

  const voted = pollVote.optionIds.includes(0)
  const participants = voted
    ? upsertParticipant(chat.participants, participant)
    : removeParticipant(chat.participants, participant.id)

  return {
    ...state,
    chats: {
      ...state.chats,
      [chatId]: {
        ...chat,
        participants
      }
    }
  }
}

// CHANGE: fold incoming Telegram updates into the bot state
// WHY: keep state transitions pure and auditable for scheduling and pairing
// QUOTE(TZ): "между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall u: updateOffset' >= updateOffset
// PURITY: CORE
// INVARIANT: only updates for the active poll modify participants
// COMPLEXITY: O(n)/O(n)
export const applyUpdates = (
  state: BotState,
  updates: ReadonlyArray<IncomingUpdate>
): BotState => {
  let updated = state
  let maxUpdateId = -1

  for (const update of updates) {
    const withChatSeen = update.chatSeen
      ? applyChatSeen(updated, update.chatSeen)
      : updated
    const withMessage = update.message
      ? applyMessage(withChatSeen, update.message)
      : withChatSeen
    updated = update.pollVote
      ? applyPollVote(withMessage, update.pollVote)
      : withMessage
    if (update.updateId > maxUpdateId) {
      maxUpdateId = update.updateId
    }
  }

  if (updates.length === 0) {
    return updated
  }

  return {
    ...updated,
    updateOffset: maxUpdateId + 1
  }
}
