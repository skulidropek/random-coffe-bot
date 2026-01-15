import { Effect, Match, pipe } from "effect"

import type { ChatId } from "../core/brand.js"
import type { BotState } from "../core/domain.js"
import { formatLocalDate, nextPollWindow, summaryDateForPoll } from "../core/schedule.js"
import { ensureChat, setThreadId } from "../core/state.js"
import type { IncomingUpdate } from "../core/updates.js"
import type { StateStoreError, StateStoreShape } from "../shell/state-store.js"
import type { TelegramError, TelegramServiceShape } from "../shell/telegram.js"
import { getZonedDate, type TimeError } from "../shell/time.js"
import { createPoll, summarize } from "./actions.js"
import { allowCommand, type Command, toCommandEnvelope } from "./command-utils.js"

type CommandContext = {
  readonly state: BotState
  readonly updates: ReadonlyArray<IncomingUpdate>
  readonly telegram: TelegramServiceShape
  readonly stateStore: StateStoreShape
  readonly timeZone: string
  readonly botUsername?: string | undefined
}

const setTopic = (
  state: BotState,
  chatId: ChatId,
  threadId: number | null,
  telegram: TelegramServiceShape,
  stateStore: StateStoreShape
): Effect.Effect<BotState, TelegramError | StateStoreError> => {
  const nextState = setThreadId(state, chatId, threadId)
  const reply = threadId === null
    ? "Ok. Polls will be posted in the main chat."
    : "Ok. Polls will be posted in this topic."
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
        "A poll is already active. Use /summary to close it.",
        context.chat.threadId ?? undefined
      ),
      Effect.as(context.state)
    )
    : createPoll(context)

type SummaryContext = Parameters<typeof summarize>[0]

const handleSummary = (
  context: SummaryContext
): Effect.Effect<BotState, TelegramError | StateStoreError> => summarize(context)

type DispatchContext = {
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
  readonly threadId?: number | undefined
  readonly messageThreadId?: number | undefined
}

type NextPollContext = {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: BotState["chats"][string]
  readonly pollWindow: ReturnType<typeof nextPollWindow>
  readonly telegram: TelegramServiceShape
  readonly replyThreadId?: number | undefined
}

const formatDays = (days: number): string => (days === 1 ? "1 day" : `${days} days`)

const handleNextPoll = (
  context: NextPollContext
): Effect.Effect<BotState, TelegramError> => {
  const poll = context.chat.poll
  let text = ""
  if (poll) {
    text = `A poll is already active. Results on ${poll.summaryDate}.`
  } else if (context.pollWindow.isOpen) {
    text = "Poll window is open now. You can start a poll with /poll."
  } else {
    text = `Next poll window starts in ${
      formatDays(context.pollWindow.daysUntilStart)
    } (${context.pollWindow.startDate}).`
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

const dispatchCommand = (
  command: Command,
  context: DispatchContextWithChat
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Match.value(command).pipe(
    Match.when("/settopic", () =>
      setTopic(
        context.state,
        context.chatId,
        context.messageThreadId ?? null,
        context.telegram,
        context.stateStore
      )),
    Match.when("/poll", () =>
      handlePoll({
        state: context.state,
        chatId: context.chatId,
        chat: context.chat,
        summaryDate: context.pollSummaryDate,
        telegram: context.telegram,
        stateStore: context.stateStore
      })),
    Match.when("/summary", () =>
      handleSummary({
        state: context.state,
        chatId: context.chatId,
        chat: context.chat,
        summaryDate: context.today,
        telegram: context.telegram,
        stateStore: context.stateStore
      })),
    Match.when("/nextpoll", () =>
      handleNextPoll({
        state: context.state,
        chatId: context.chatId,
        chat: context.chat,
        pollWindow: context.pollWindow,
        telegram: context.telegram,
        replyThreadId: context.messageThreadId
      })),
    Match.exhaustive
  )

type CommandUpdateContext = DispatchContext & {
  readonly state: BotState
  readonly update: IncomingUpdate
  readonly botUsername?: string | undefined
}

const handleCommandUpdate = (
  context: CommandUpdateContext
): Effect.Effect<BotState, TelegramError | StateStoreError> =>
  Effect.gen(function*(_) {
    const envelope = toCommandEnvelope(context.update, context.botUsername)
    if (!envelope) {
      return context.state
    }
    const chatId = envelope.chatId
    const allowed = yield* _(
      allowCommand(
        envelope.command,
        context.telegram,
        chatId,
        envelope.actorId,
        envelope.replyThreadId
      )
    )
    if (!allowed) {
      return context.state
    }
    const withChat = ensureChat(context.state, chatId)
    const withThread = envelope.command === "/poll"
      ? yield* _(persistThreadId(withChat, chatId, envelope.threadId, context.stateStore))
      : withChat
    const chat = withThread.chats[chatId]
    if (!chat) {
      return withThread
    }
    return yield* _(
      dispatchCommand(envelope.command, {
        state: withThread,
        chatId,
        chat,
        pollSummaryDate: context.pollSummaryDate,
        today: context.today,
        pollWindow: context.pollWindow,
        telegram: context.telegram,
        stateStore: context.stateStore,
        threadId: envelope.replyThreadId,
        messageThreadId: envelope.messageThreadId
      })
    )
  })

// CHANGE: handle admin commands for polls and configuration
// WHY: allow admins to control poll topic and trigger manual actions
// QUOTE(TZ): "Сделать моментальный опросник"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s: handle(s) preserves non-command state
// PURITY: SHELL
// EFFECT: Effect<BotState, TelegramError | StateStoreError, never>
// INVARIANT: only admins can invoke privileged commands
// COMPLEXITY: O(n)/O(n)
export const handleCommands = (
  context: CommandContext
): Effect.Effect<BotState, TelegramError | StateStoreError | TimeError> =>
  Effect.gen(function*(_) {
    const now = new Date()
    const zoned = yield* _(getZonedDate(context.timeZone, now))
    const pollSummaryDate = summaryDateForPoll(zoned.parts, zoned.weekday)
    const today = formatLocalDate(zoned.parts)
    const pollWindow = nextPollWindow(zoned.parts, zoned.weekday)

    let updated = context.state
    for (const update of context.updates) {
      updated = yield* _(
        handleCommandUpdate({
          state: updated,
          update,
          pollSummaryDate,
          today,
          pollWindow,
          telegram: context.telegram,
          stateStore: context.stateStore,
          botUsername: context.botUsername
        })
      )
    }

    return updated
  })
