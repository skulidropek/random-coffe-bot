import type { ChatId, LocalDateString, RngSeed } from "./brand.js"
import type {
  BotState,
  ChatState,
  Pairing,
  PollState,
  UserProfile
} from "./domain.js"
import {
  clearProfileEditPending,
  isProfileEditPending,
  markProfileEditPending,
  upsertProfile
} from "./profiles.js"
import { updateHistory } from "./pairing.js"
import { nextSeed } from "./rng.js"

// CHANGE: initialize a per-chat state container
// WHY: track polls, history, and randomness independently per group chat
// QUOTE(TZ): "может работать в любом чате в который добавят бота"
// REF: user-2026-01-09-multi-chat
// SOURCE: n/a
// FORMAT THEOREM: forall seed: emptyChat(seed).poll = null
// PURITY: CORE
// INVARIANT: empty chat state has no poll or participants
// COMPLEXITY: O(1)/O(1)
export const emptyChatState = (seed: RngSeed): ChatState => ({
  poll: null,
  participants: {},
  history: {},
  seed,
  threadId: null,
  title: null,
  inviteLink: null,
  lastSummaryAt: null
})

const updateChat = (
  state: BotState,
  chatId: ChatId,
  updater: (chat: ChatState) => ChatState
): BotState => {
  const current = state.chats[chatId]
  if (!current) {
    return state
  }
  return {
    ...state,
    chats: {
      ...state.chats,
      [chatId]: updater(current)
    }
  }
}

const removePollIndex = (state: BotState, pollId: string): BotState => {
  const entries = Object.entries(state.pollIndex).filter(
    ([entryId]) => entryId !== pollId
  )
  return {
    ...state,
    pollIndex: Object.fromEntries(entries)
  }
}

const clearPoll = (
  state: BotState,
  chatId: ChatId,
  updater: (chat: ChatState) => ChatState
): BotState => {
  const chat = state.chats[chatId]
  if (!chat) {
    return state
  }
  const pollId = chat.poll?.pollId
  const updated = updateChat(state, chatId, updater)
  return pollId ? removePollIndex(updated, pollId) : updated
}

// CHANGE: ensure a chat state exists for the given chat id
// WHY: allow the bot to self-configure when added to any group
// QUOTE(TZ): "может работать в любом чате в который добавят бота"
// REF: user-2026-01-09-multi-chat
// SOURCE: n/a
// FORMAT THEOREM: forall s,id: hasChat(ensure(s,id),id)
// PURITY: CORE
// INVARIANT: chat seeds are deterministic and derived from the global seed
// COMPLEXITY: O(1)/O(1)
export const ensureChat = (state: BotState, chatId: ChatId): BotState => {
  if (state.chats[chatId]) {
    return state
  }
  const chatSeed = state.seed
  const next = nextSeed(state.seed)
  return {
    ...state,
    seed: next,
    chats: {
      ...state.chats,
      [chatId]: emptyChatState(chatSeed)
    }
  }
}

// CHANGE: persist a user profile into bot state
// WHY: keep private profile text available for weekly pair messages
// QUOTE(TZ): "Профиль просто внутри бота делается Там текст и всё"
// REF: user-2026-01-21-profile-text
// SOURCE: n/a
// FORMAT THEOREM: forall s,p: setProfile(s,p).profiles[key(p)] = p
// PURITY: CORE
// INVARIANT: only profiles map is updated
// COMPLEXITY: O(1)/O(n)
export const setUserProfile = (
  state: BotState,
  profile: UserProfile
): BotState => ({
  ...state,
  profiles: upsertProfile(state.profiles, profile)
})

// CHANGE: mark profile editing for a private chat
// WHY: only capture profile text after explicit request
// QUOTE(TZ): "Заполнить профиль и изменить описание это по сути одно и тоже"
// REF: user-2026-01-21-profile-edit-unify
// SOURCE: n/a
// FORMAT THEOREM: forall s,id: mark(s,id).pending[id] = true
// PURITY: CORE
// INVARIANT: pending profile edits are tracked per chat
// COMPLEXITY: O(1)/O(n)
export const markProfileEdit = (
  state: BotState,
  chatId: ChatId
): BotState => ({
  ...state,
  pendingProfileEdits: markProfileEditPending(state.pendingProfileEdits, chatId)
})

// CHANGE: clear profile editing flag for a private chat
// WHY: stop consuming messages after saving profile text
// QUOTE(TZ): "Заполнить профиль и изменить описание это по сути одно и тоже"
// REF: user-2026-01-21-profile-edit-unify
// SOURCE: n/a
// FORMAT THEOREM: forall s,id: clear(s,id).pending[id] = false
// PURITY: CORE
// INVARIANT: other pending flags remain unchanged
// COMPLEXITY: O(n)/O(n)
export const clearProfileEdit = (
  state: BotState,
  chatId: ChatId
): BotState => ({
  ...state,
  pendingProfileEdits: clearProfileEditPending(state.pendingProfileEdits, chatId)
})

// CHANGE: check if profile editing is active for a private chat
// WHY: ignore unrelated messages in private chats
// QUOTE(TZ): "Заполнить профиль и изменить описание это по сути одно и тоже"
// REF: user-2026-01-21-profile-edit-unify
// SOURCE: n/a
// FORMAT THEOREM: forall s,id: isPending(s,id) = pending[id]
// PURITY: CORE
// INVARIANT: returns false when pending flag is absent
// COMPLEXITY: O(1)/O(1)
export const isProfileEditActive = (state: BotState, chatId: ChatId): boolean =>
  isProfileEditPending(state.pendingProfileEdits, chatId)

// CHANGE: update the target thread for a chat
// WHY: allow admins to choose where polls and summaries are posted
// QUOTE(TZ): "Которая задаст в каком топике/чате отправлять опросник"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s,id,t: setThread(s,id,t).chats[id].threadId = t
// PURITY: CORE
// INVARIANT: only the target thread is updated
// COMPLEXITY: O(1)/O(1)
export const setThreadId = (
  state: BotState,
  chatId: ChatId,
  threadId: number | null
): BotState =>
  updateChat(state, chatId, (chat) => ({
    ...chat,
    threadId
  }))

// CHANGE: update the cached chat title
// WHY: include the current chat name in the weekly summary
// QUOTE(TZ): "берётся название текущего чата"
// REF: user-2026-01-09-english-messages
// SOURCE: n/a
// FORMAT THEOREM: forall s,id,t: setTitle(s,id,t).chats[id].title = t
// PURITY: CORE
// INVARIANT: only the chat title is updated
// COMPLEXITY: O(1)/O(1)
export const setChatTitle = (
  state: BotState,
  chatId: ChatId,
  title: string
): BotState =>
  updateChat(state, chatId, (chat) => (
    chat.title === title
      ? chat
      : {
        ...chat,
        title
      }
  ))

// CHANGE: update the cached chat invite link
// WHY: allow manual configuration of group join links for the leaderboard
// QUOTE(TZ): "должна быть ссылка на группу"
// REF: user-2026-01-18-leaderboard-link
// SOURCE: n/a
// FORMAT THEOREM: forall s,id,l: setLink(s,id,l).chats[id].inviteLink = l
// PURITY: CORE
// INVARIANT: only the chat invite link is updated
// COMPLEXITY: O(1)/O(1)
export const setChatInviteLink = (
  state: BotState,
  chatId: ChatId,
  inviteLink: string | null
): BotState =>
  updateChat(state, chatId, (chat) => (
    chat.inviteLink === inviteLink
      ? chat
      : {
        ...chat,
        inviteLink
      }
  ))

// CHANGE: start a new poll by resetting participants and storing poll metadata
// WHY: ensure each weekly poll has a clean participant set
// QUOTE(TZ): "создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s,p: start(s,p).poll = p ∧ participants = {}
// PURITY: CORE
// INVARIANT: poll participants are cleared on new poll
// COMPLEXITY: O(1)/O(1)
export const startPoll = (
  state: BotState,
  chatId: ChatId,
  poll: PollState
): BotState => {
  const existingPollId = state.chats[chatId]?.poll?.pollId
  const base = existingPollId ? removePollIndex(state, existingPollId) : state
  const updated = updateChat(base, chatId, (chat) => ({
    ...chat,
    poll,
    participants: {}
  }))
  return {
    ...updated,
    pollIndex: {
      ...updated.pollIndex,
      [poll.pollId]: chatId
    }
  }
}

// CHANGE: apply summary results to the bot state
// WHY: persist pairing history and advance the RNG seed deterministically
// QUOTE(TZ): "Что бы меньше попадались те кто уже был"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s,pairs: history' = update(history, pairs)
// PURITY: CORE
// INVARIANT: poll is cleared after summary and lastSummaryAt is updated
// COMPLEXITY: O(n)/O(n)
export const applySummary = (
  state: BotState,
  chatId: ChatId,
  pairs: ReadonlyArray<Pairing>,
  seed: RngSeed,
  summaryDate: LocalDateString
): BotState => {
  return clearPoll(state, chatId, (current) => ({
    ...current,
    history: updateHistory(current.history, pairs),
    poll: null,
    participants: {},
    seed,
    lastSummaryAt: summaryDate
  }))
}

// CHANGE: clear an active poll without updating history
// WHY: allow explicit poll termination while preserving chat history
// QUOTE(TZ): "подводит итог в понедельник"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s: finish(s).poll = null ∧ participants = {}
// PURITY: CORE
// INVARIANT: history is preserved
// COMPLEXITY: O(1)/O(1)
export const finishPoll = (state: BotState, chatId: ChatId): BotState => {
  return clearPoll(state, chatId, (current) => ({
    ...current,
    poll: null,
    participants: {}
  }))
}
