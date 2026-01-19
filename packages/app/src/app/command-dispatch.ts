import { Effect, Match, pipe } from "effect"

import type { ChatId } from "../core/brand.js"
import type { BotState } from "../core/domain.js"
import type { formatLocalDate, nextPollWindow, summaryDateForPoll } from "../core/schedule.js"
import { ensureChat, setThreadId } from "../core/state.js"
import {
  replyNextPollWindow,
  replyPollAlreadyActive,
  replyPollAlreadyActiveWithDate,
  replyPollWindowOpen,
  replySetTopicMain,
  replySetTopicThread
} from "../core/text.js"
import type { StateStoreError, StateStoreShape } from "../shell/state-store.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"
import { createPoll, summarize } from "./actions.js"
import type { Command, CommandEnvelope } from "./command-utils.js"
import { handleSetLink } from "./set-link.js"

export type DispatchContext = {
  readonly pollSummaryDate: ReturnType<typeof summaryDateForPoll>
  readonly today: ReturnType<typeof formatLocalDate>
  readonly pollWindow: ReturnType<typeof nextPollWindow>
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
}

type DispatchContextWithChat = DispatchContext & {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: BotState["chats"][string]
  readonly messageThreadId?: number | undefined
  readonly commandText: string
}

type ChatCommand = Exclude<Command, "/leaderboard">

const setTopic = (
  state: BotState,
  chatId: ChatId,
  threadId: number | null,
  telegram: TelegramServiceShape,
  stateStore: StateStoreShape
): Effect.Effect<BotState, TelegramError | StateStoreError> => {
  const nextState = setThreadId(state, chatId, threadId)
  const reply = threadId === null
    ? replySetTopicMain()
    : replySetTopicThread()
  return pipe(
    stateStore.set(nextState),
    Effect.zipRight(telegram.sendMessage(chatId, reply, threadId ?? undefined)),
    Effect.as(nextState)
  )
}

// CHANGE: persist a thread id derived from a command message
// WHY: keep polls aligned with the topic where /poll was issued
// QUOTE(TZ): "сохранение топиков исходя из этих команд"
// REF: user-2026-01-15-topic-binding
// SOURCE: n/a
// FORMAT THEOREM: forall s,id,t: setThread(s,id,t).chats[id].threadId = t
// PURITY: SHELL
// EFFECT: Effect<BotState, StateStoreError, never>
// INVARIANT: no persistence occurs when thread id is unchanged
// COMPLEXITY: O(1)/O(1)
const persistThreadId = (
  state: BotState,
  chatId: ChatId,
  threadId: number | null,
  stateStore: StateStoreShape
): Effect.Effect<BotState, StateStoreError> =>
  Effect.gen(function*(_) {
    const withChat = ensureChat(state, chatId)
    const current = withChat.chats[chatId]
    if (!current || current.threadId === threadId) {
      return withChat
    }
    const nextState = setThreadId(withChat, chatId, threadId)
    yield* _(stateStore.set(nextState))
    return nextState
  })

type PollContext = Parameters<typeof createPoll>[0]

const handlePoll = (
  context: PollContext
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  context.chat.poll
    ? pipe(
      context.telegram.sendMessage(
        context.chatId,
        replyPollAlreadyActive(),
        context.chat.threadId ?? undefined
      ),
      Effect.as(context.state)
    )
    : createPoll(context)

type SummaryContext = Parameters<typeof summarize>[0]

const handleSummary = (
  context: SummaryContext
): Effect.Effect<BotState, TelegramError | StateStoreError> => summarize(context)

type NextPollContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: BotState["chats"][string]
  readonly pollWindow: ReturnType<typeof nextPollWindow>
  readonly telegram: TelegramServiceShape
  readonly replyThreadId?: number | undefined
}

const handleNextPoll = (
  context: NextPollContext
): Effect.Effect<BotState, TelegramError> => {
  const poll = context.chat.poll
  let text = ""
  if (poll) {
    text = replyPollAlreadyActiveWithDate(poll.summaryDate)
  } else if (context.pollWindow.isOpen) {
    text = replyPollWindowOpen()
  } else {
    text = replyNextPollWindow(
      context.pollWindow.daysUntilStart,
      context.pollWindow.startDate
    )
  }

  return pipe(
    context.telegram.sendMessage(
      context.chatId,
      text,
      context.replyThreadId ?? context.chat.threadId ?? undefined
    ),
    Effect.as(context.state)
  )
}

const handleSetTopicCommand = (
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  setTopic(
    context.state,
    context.chatId,
    context.messageThreadId ?? null,
    context.telegram,
    context.stateStore
  )

const handlePollCommand = (
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  handlePoll({
    state: context.state,
    chatId: context.chatId,
    chat: context.chat,
    summaryDate: context.pollSummaryDate,
    telegram: context.telegram,
    stateStore: context.stateStore
  })

const handleSummaryCommand = (
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  handleSummary({
    state: context.state,
    chatId: context.chatId,
    chat: context.chat,
    summaryDate: context.today,
    telegram: context.telegram,
    stateStore: context.stateStore
  })

const handleNextPollCommand = (
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError> =>
  handleNextPoll({
    state: context.state,
    chatId: context.chatId,
    chat: context.chat,
    pollWindow: context.pollWindow,
    telegram: context.telegram,
    replyThreadId: context.messageThreadId
  })

const handleSetLinkCommand = (
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  handleSetLink({
    state: context.state,
    chatId: context.chatId,
    chat: context.chat,
    commandText: context.commandText,
    telegram: context.telegram,
    stateStore: context.stateStore,
    replyThreadId: context.messageThreadId
  })

const dispatchCommand = (
  command: ChatCommand,
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Match.value(command).pipe(
    Match.when("/settopic", () => handleSetTopicCommand(context)),
    Match.when("/poll", () => handlePollCommand(context)),
    Match.when("/summary", () => handleSummaryCommand(context)),
    Match.when("/nextpoll", () => handleNextPollCommand(context)),
    Match.when("/setlink", () => handleSetLinkCommand(context)),
    Match.exhaustive
  )

type PreparedChatState = {
  readonly state: BotState
  readonly chat: BotState["chats"][string] | undefined
}

const prepareChatState = (
  state: BotState,
  envelope: CommandEnvelope,
  stateStore: StateStoreShape
): Effect.Effect<PreparedChatState, StateStoreError> =>
  Effect.gen(function*(_) {
    const withChat = ensureChat(state, envelope.chatId)
    const withThread = envelope.command === "/poll"
      ? yield* _(persistThreadId(withChat, envelope.chatId, envelope.threadId, stateStore))
      : withChat
    return {
      state: withThread,
      chat: withThread.chats[envelope.chatId]
    }
  })

export const dispatchChatCommand = (
  state: BotState,
  context: DispatchContext,
  envelope: CommandEnvelope,
  command: ChatCommand
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Effect.gen(function*(_) {
    const prepared = yield* _(prepareChatState(state, envelope, context.stateStore))
    const chat = prepared.chat
    if (!chat) {
      return prepared.state
    }
    return yield* _(
      dispatchCommand(command, {
        state: prepared.state,
        chatId: envelope.chatId,
        chat,
        pollSummaryDate: context.pollSummaryDate,
        today: context.today,
        pollWindow: context.pollWindow,
        telegram: context.telegram,
        stateStore: context.stateStore,
        messageThreadId: envelope.messageThreadId,
        commandText: envelope.text
      })
    )
  })
