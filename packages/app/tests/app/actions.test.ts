import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, pipe } from "effect"

import { createPoll, summarize } from "../../src/app/actions.js"
import { ChatId, LocalDateString, MessageId, PollId, RngSeed, UserId } from "../../src/core/brand.js"
import type { BotState, ChatState } from "../../src/core/domain.js"
import { upsertParticipant } from "../../src/core/participants.js"
import { emptyChatState } from "../../src/core/state.js"
import type { TelegramServiceShape } from "../../src/shell/telegram.js"
import { makeStateStoreStub, makeStateWithChat, makeStateWithPoll, makeTelegramStub } from "./test-utils.js"

const makeParticipant = (id: number, name: string, username: string) => ({
  id: UserId(id),
  firstName: name,
  username
})

const runSummarize = (params: {
  readonly state: BotState
  readonly chatId: ChatId
  readonly chat: ChatState
  readonly summaryDate: LocalDateString
  readonly pollId: PollId
  readonly messageId: MessageId
}) =>
  Effect.gen(function*(_) {
    const { messageCalls, stopPollCalls, telegram } = makeTelegramStub({
      pollResult: { pollId: params.pollId, messageId: params.messageId }
    })
    const { stateStore } = makeStateStoreStub(params.state)
    const next = yield* _(
      summarize({
        state: params.state,
        chatId: params.chatId,
        chat: params.chat,
        summaryDate: params.summaryDate,
        telegram,
        stateStore
      })
    )
    return { next, messageCalls, stopPollCalls }
  })

const makeAsyncTelegram = (
  pollDeferred: Deferred.Deferred<{ readonly pollId: PollId; readonly messageId: MessageId }>
): TelegramServiceShape => ({
  getUpdates: () => Effect.succeed([]),
  sendPoll: (chatId, question, options, threadId) =>
    pipe(
      Effect.sync(() => ({ chatId, question, options, threadId })),
      Effect.zipRight(Deferred.await(pollDeferred))
    ),
  sendMessage: () => Effect.succeed(MessageId(0)),
  stopPoll: () => Effect.void,
  getChatMember: () => Effect.succeed("administrator")
})

describe("actions", () => {
  it.effect("createPoll stores poll and calls sendPoll", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-100")
      const chat = {
        ...emptyChatState(RngSeed(1)),
        threadId: 42,
        title: "Test Chat"
      }
      const state = makeStateWithChat(chatId, chat, RngSeed(1))
      const summaryDate = LocalDateString("2026-01-12")
      const { pollCalls, telegram } = makeTelegramStub()
      const { setCalls, stateStore } = makeStateStoreStub(state)

      const next = yield* _(
        createPoll({
          state,
          chatId,
          chat,
          summaryDate,
          telegram,
          stateStore
        })
      )

      expect(pollCalls.length).toBe(1)
      expect(pollCalls[0]?.options.length).toBe(2)
      expect(pollCalls[0]?.question.startsWith("Hi! Will you join Random Coffee")).toBe(true)
      expect(next.chats[chatId]?.poll?.summaryDate).toBe(summaryDate)
      expect(Object.keys(next.pollIndex).length).toBe(1)
      expect(setCalls.length).toBe(1)
    }))

  it.effect("summarize clears poll, updates history, and sets lastSummaryAt", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-200")
      const pollId = PollId("poll-1")
      const summaryDate = LocalDateString("2026-01-12")
      const alice = makeParticipant(1, "Alice", "alice")
      const bob = makeParticipant(2, "Bob", "bob")
      const participants = upsertParticipant(upsertParticipant({}, alice), bob)
      const chat = {
        ...emptyChatState(RngSeed(10)),
        poll: {
          pollId,
          messageId: MessageId(10),
          chatId,
          summaryDate,
          threadId: 99
        },
        participants,
        title: "Unicorn Embassy | Georgia"
      }
      const state = makeStateWithPoll(chatId, chat, pollId, RngSeed(2))
      const { messageCalls, next, stopPollCalls } = yield* _(
        runSummarize({
          state,
          chatId,
          chat,
          summaryDate,
          pollId,
          messageId: MessageId(10)
        })
      )

      expect(messageCalls.length).toBe(1)
      expect(messageCalls[0]?.threadId).toBe(99)
      expect(messageCalls[0]?.text.includes("Pairs for Unicorn Embassy | Georgia")).toBe(true)
      expect(stopPollCalls.length).toBe(1)
      expect(next.chats[chatId]?.poll).toBeNull()
      expect(Object.keys(next.chats[chatId]?.participants ?? {}).length).toBe(0)
      expect(next.chats[chatId]?.lastSummaryAt).toBe(summaryDate)
      expect(Object.keys(next.pollIndex).length).toBe(0)
    }))

  it.effect("summarize mentions leftover participants when no pairs", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-201")
      const pollId = PollId("poll-2")
      const summaryDate = LocalDateString("2026-01-12")
      const alice = makeParticipant(1, "Alice", "alice")
      const participants = upsertParticipant({}, alice)
      const chat = {
        ...emptyChatState(RngSeed(11)),
        poll: {
          pollId,
          messageId: MessageId(11),
          chatId,
          summaryDate,
          threadId: null
        },
        participants,
        title: "Coffee Club"
      }
      const state = makeStateWithPoll(chatId, chat, pollId, RngSeed(11))
      const { messageCalls, next } = yield* _(
        runSummarize({
          state,
          chatId,
          chat,
          summaryDate,
          pollId,
          messageId: MessageId(11)
        })
      )

      expect(messageCalls.length).toBe(1)
      expect(messageCalls[0]?.text.includes("Not enough participants to make pairs")).toBe(true)
      expect(messageCalls[0]?.text.includes("@alice")).toBe(true)
      expect(next.chats[chatId]?.poll).toBeNull()
    }))

  it.effect("createPoll waits for async sendPoll before updating state", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-150")
      const chat = {
        ...emptyChatState(RngSeed(5)),
        title: "Async Chat"
      }
      const state = makeStateWithChat(chatId, chat, RngSeed(5))
      const summaryDate = LocalDateString("2026-01-12")
      const pollDeferred = yield* _(Deferred.make<{ readonly pollId: PollId; readonly messageId: MessageId }>())
      const telegram = makeAsyncTelegram(pollDeferred)
      const { stateStore } = makeStateStoreStub(state)

      const fiber = yield* _(
        createPoll({
          state,
          chatId,
          chat,
          summaryDate,
          telegram,
          stateStore
        }).pipe(Effect.fork)
      )

      yield* _(Deferred.succeed(pollDeferred, { pollId: PollId("poll-async"), messageId: MessageId(999) }))
      const next = yield* _(Fiber.join(fiber))

      expect(next.chats[chatId]?.poll?.pollId).toBe(PollId("poll-async"))
    }))
})
