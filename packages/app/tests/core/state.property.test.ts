import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import { ChatId, MessageId, PairKey, PollId, RngSeed } from "../../src/core/brand.js"
import type { PairHistory, Pairing } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import { nextSeed } from "../../src/core/rng.js"
import {
  applySummary,
  emptyChatState,
  ensureChat,
  finishPoll,
  setChatTitle,
  setThreadId,
  startPoll
} from "../../src/core/state.js"
import { alphaString, localDateArb, participantArb } from "./property-helpers.js"

const buildEmptyState = (seed: number, chatRaw: string) => ({
  chatId: ChatId(chatRaw),
  state: emptyState(RngSeed(seed))
})

describe("state", () => {
  it("handles operations on missing chats", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), alphaString, (seed, chatRaw) => {
        const { chatId, state } = buildEmptyState(seed, chatRaw)
        const ensured = ensureChat(state, chatId)
        expect(ensured.chats[chatId]).not.toBeUndefined()
        expect(ensured.seed).toBe(nextSeed(RngSeed(seed)))

        const threadResult = setThreadId(state, chatId, 42)
        expect(threadResult).toBe(state)

        const finishResult = finishPoll(state, chatId)
        expect(finishResult).toBe(state)
      })
    )
  })

  it("ensureChat returns same state when chat exists", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), alphaString, (seed, chatRaw) => {
        const { chatId, state } = buildEmptyState(seed, chatRaw)
        const withChat = ensureChat(state, chatId)
        const next = ensureChat(withChat, chatId)
        expect(next).toBe(withChat)
      })
    )
  })

  it("setChatTitle keeps state when title is unchanged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), alphaString, (seed, title) => {
        const chatId = ChatId("chat-1")
        const chat = { ...emptyChatState(RngSeed(seed)), title }
        const state = {
          ...emptyState(RngSeed(seed)),
          chats: {
            [chatId]: chat
          }
        }
        const next = setChatTitle(state, chatId, title)
        expect(next).toEqual(state)
      })
    )
  })

  it("startPoll replaces poll index entries", () => {
    fc.assert(
      fc.property(localDateArb, localDateArb, (firstDate, secondDate) => {
        const chatId = ChatId("chat-2")
        const base = ensureChat(emptyState(RngSeed(1)), chatId)
        const first = startPoll(base, chatId, {
          pollId: PollId("poll-1"),
          messageId: MessageId(1),
          chatId,
          summaryDate: firstDate,
          threadId: null
        })
        const second = startPoll(first, chatId, {
          pollId: PollId("poll-2"),
          messageId: MessageId(2),
          chatId,
          summaryDate: secondDate,
          threadId: null
        })
        expect(second.pollIndex[PollId("poll-1")]).toBeUndefined()
        expect(second.pollIndex[PollId("poll-2")]).toBe(chatId)
      })
    )
  })

  it("applySummary clears poll and participants, updates lastSummaryAt", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(participantArb, { selector: (p) => p.id, minLength: 2, maxLength: 2 }),
        localDateArb,
        (participants, summaryDate) => {
          const [a, b] = participants
          if (!a || !b) {
            return
          }
          const chatId = ChatId("chat-3")
          const base = ensureChat(emptyState(RngSeed(10)), chatId)
          const withPoll = startPoll(base, chatId, {
            pollId: PollId("poll-3"),
            messageId: MessageId(3),
            chatId,
            summaryDate,
            threadId: null
          })
          const pairs: ReadonlyArray<Pairing> = [{ kind: "pair", members: [a, b] }]
          const next = applySummary(withPoll, chatId, pairs, RngSeed(11), summaryDate)
          expect(next.chats[chatId]?.poll).toBeNull()
          expect(Object.keys(next.chats[chatId]?.participants ?? {})).toHaveLength(0)
          expect(next.chats[chatId]?.lastSummaryAt).toBe(summaryDate)
        }
      )
    )
  })

  it("finishPoll clears poll but keeps history", () => {
    fc.assert(
      fc.property(localDateArb, (summaryDate) => {
        const chatId = ChatId("chat-4")
        const base = ensureChat(emptyState(RngSeed(5)), chatId)
        const withPoll = startPoll(base, chatId, {
          pollId: PollId("poll-4"),
          messageId: MessageId(4),
          chatId,
          summaryDate,
          threadId: null
        })
        const chat = withPoll.chats[chatId]
        if (!chat) {
          return
        }
        const history: PairHistory = { [PairKey("1-2")]: 2 }
        const withHistory = {
          ...withPoll,
          chats: {
            ...withPoll.chats,
            [chatId]: {
              ...chat,
              history
            }
          }
        }
        const next = finishPoll(withHistory, chatId)
        expect(next.chats[chatId]?.poll).toBeNull()
        expect(next.chats[chatId]?.history).toEqual(history)
      })
    )
  })
})
