import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { handleCommands } from "../../src/app/commands.js"
import { ChatId, LocalDateString, MessageId, PollId, RngSeed } from "../../src/core/brand.js"
import type { BotState } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import { upsertParticipant } from "../../src/core/participants.js"
import { emptyChatState } from "../../src/core/state.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import type { ChatMemberStatus } from "../../src/shell/telegram.js"
import {
  makeMessageUpdate,
  makeParticipant,
  makeStateStoreStub,
  makeStateWithPoll,
  makeTelegramStub
} from "./test-utils.js"

const runCommands = (params: {
  readonly state: BotState
  readonly updates: ReadonlyArray<IncomingUpdate>
  readonly telegram: ReturnType<typeof makeTelegramStub>["telegram"]
  readonly stateStore: ReturnType<typeof makeStateStoreStub>["stateStore"]
  readonly botUsername?: string | undefined
}) =>
  handleCommands({
    state: params.state,
    updates: params.updates,
    telegram: params.telegram,
    stateStore: params.stateStore,
    timeZone: "UTC",
    botUsername: params.botUsername
  })

const runWithStubs = (params: {
  readonly state: BotState
  readonly update: IncomingUpdate
  readonly memberStatus?: ChatMemberStatus
  readonly pollResult?: { readonly pollId: PollId; readonly messageId: MessageId }
  readonly botUsername?: string | undefined
}) =>
  Effect.gen(function*(_) {
    const options = params.pollResult
      ? { pollResult: params.pollResult }
      : undefined
    const { messageCalls, pollCalls, setMemberStatus, telegram } = makeTelegramStub({
      ...options,
      botUsername: params.botUsername
    })
    if (params.memberStatus) {
      setMemberStatus(params.memberStatus)
    }
    const { stateStore } = makeStateStoreStub(params.state)
    const next = yield* _(
      runCommands({
        state: params.state,
        updates: [params.update],
        telegram,
        stateStore,
        botUsername: params.botUsername
      })
    )
    return { next, messageCalls, pollCalls }
  })

describe("commands", () => {
  it.effect("/settopic stores thread id for admins", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-300")
      const user = makeParticipant(1, "Admin")
      const update = makeMessageUpdate({
        updateId: 1,
        chatId,
        text: "/settopic",
        from: user,
        threadId: 777
      })
      const base = emptyState(RngSeed(1))
      const { messageCalls, next } = yield* _(
        runWithStubs({
          state: base,
          update
        })
      )

      expect(next.chats[chatId]?.threadId).toBe(777)
      expect(messageCalls[0]?.text).toBe("Ok. Polls will be posted in this topic.")
    }))

  it.effect("/poll triggers poll creation for admins", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-400")
      const user = makeParticipant(2, "Admin")
      const update = makeMessageUpdate({
        updateId: 2,
        chatId,
        text: "/poll",
        from: user
      })
      const base = emptyState(RngSeed(2))
      const { next, pollCalls } = yield* _(
        runWithStubs({
          state: base,
          update
        })
      )

      expect(pollCalls.length).toBe(1)
      expect(next.chats[chatId]?.poll).not.toBeNull()
    }))

  it.effect("/poll stores thread id from the command topic", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-401")
      const user = makeParticipant(2, "Admin")
      const update = makeMessageUpdate({
        updateId: 7,
        chatId,
        text: "/poll",
        from: user,
        threadId: 321
      })
      const base = emptyState(RngSeed(7))
      const { next, pollCalls } = yield* _(
        runWithStubs({
          state: base,
          update
        })
      )
      expect(pollCalls[0]?.threadId).toBe(321)
      expect(next.chats[chatId]?.threadId).toBe(321)
      expect(next.chats[chatId]?.poll?.threadId).toBe(321)
    }))
  it.effect("/poll ignores commands addressed to another bot", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-402")
      const user = makeParticipant(2, "Admin")
      const update = makeMessageUpdate({
        updateId: 8,
        chatId,
        text: "/poll@other_bot",
        from: user
      })
      const base = emptyState(RngSeed(8))
      const { next, pollCalls } = yield* _(
        runWithStubs({
          state: base,
          update,
          botUsername: "rustgpt_bot"
        })
      )
      expect(pollCalls.length).toBe(0)
      expect(next.chats[chatId]).toBeUndefined()
    }))
  it.effect("/summary denies non-admin users", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-500")
      const pollId = PollId("poll-1")
      const summaryDate = LocalDateString("2026-01-12")
      const user = makeParticipant(3, "Member")
      const update = makeMessageUpdate({
        updateId: 3,
        chatId,
        text: "/summary",
        from: user
      })
      const chat = {
        ...emptyChatState(RngSeed(3)),
        poll: {
          pollId,
          messageId: MessageId(1),
          chatId,
          summaryDate,
          threadId: null
        }
      }
      const base = makeStateWithPoll(chatId, chat, pollId, RngSeed(3))
      const { messageCalls, next } = yield* _(
        runWithStubs({
          state: base,
          update,
          memberStatus: "member"
        })
      )
      expect(messageCalls[0]?.text).toBe("This command is available to chat admins only.")
      expect(next.chats[chatId]?.poll?.pollId).toBe(pollId)
      expect(next.chats[chatId]?.lastSummaryAt).toBeNull()
    }))
  it.effect("/summary clears poll and records summary date for admins", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-600")
      const pollId = PollId("poll-2")
      const summaryDate = LocalDateString("2026-01-12")
      const user = makeParticipant(4, "Admin")
      const update = makeMessageUpdate({
        updateId: 4,
        chatId,
        text: "/summary",
        from: user
      })
      const alice = makeParticipant(5, "Alice")
      const bob = makeParticipant(6, "Bob")
      const participants = upsertParticipant(upsertParticipant({}, alice), bob)
      const chat = {
        ...emptyChatState(RngSeed(4)),
        poll: {
          pollId,
          messageId: MessageId(2),
          chatId,
          summaryDate,
          threadId: null
        },
        participants,
        title: "Test Group"
      }
      const base = makeStateWithPoll(chatId, chat, pollId, RngSeed(4))
      const { messageCalls, next } = yield* _(
        runWithStubs({
          state: base,
          update,
          pollResult: { pollId, messageId: MessageId(2) }
        })
      )

      expect(messageCalls.length).toBe(1)
      expect(messageCalls[0]?.text.includes("Pairs for Test Group")).toBe(true)
      expect(next.chats[chatId]?.poll).toBeNull()
      expect(next.chats[chatId]?.lastSummaryAt).not.toBeNull()
    }))

  it.effect("/poll refuses when a poll is already active", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-700")
      const pollId = PollId("poll-active")
      const summaryDate = LocalDateString("2026-01-12")
      const user = makeParticipant(7, "Admin")
      const update = makeMessageUpdate({
        updateId: 5,
        chatId,
        text: "/poll",
        from: user
      })
      const chat = {
        ...emptyChatState(RngSeed(5)),
        poll: {
          pollId,
          messageId: MessageId(5),
          chatId,
          summaryDate,
          threadId: null
        }
      }
      const base = makeStateWithPoll(chatId, chat, pollId, RngSeed(5))
      const { messageCalls, next, pollCalls } = yield* _(
        runWithStubs({
          state: base,
          update
        })
      )
      expect(pollCalls.length).toBe(0)
      expect(messageCalls[0]?.text).toBe("A poll is already active. Use /summary to close it.")
      expect(next.chats[chatId]?.poll?.pollId).toBe(pollId)
    }))
  it.effect("/nextpoll responds even for non-admin users", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-701")
      const pollId = PollId("poll-active")
      const summaryDate = LocalDateString("2026-01-12")
      const user = makeParticipant(8, "Member")
      const update = makeMessageUpdate({
        updateId: 6,
        chatId,
        text: "/nextpoll",
        from: user
      })
      const chat = {
        ...emptyChatState(RngSeed(6)),
        poll: {
          pollId,
          messageId: MessageId(6),
          chatId,
          summaryDate,
          threadId: null
        }
      }
      const base = makeStateWithPoll(chatId, chat, pollId, RngSeed(6))
      const { messageCalls, pollCalls } = yield* _(
        runWithStubs({
          state: base,
          update,
          memberStatus: "member"
        })
      )
      expect(pollCalls.length).toBe(0)
      expect(messageCalls[0]?.text).toBe("A poll is already active. Results on 2026-01-12.")
    }))
})
