import { describe, expect, it } from "@effect/vitest"

import { ChatId, LocalDateString, MessageId, PollId, RngSeed, UserId } from "../../src/core/brand.js"
import type { Participant } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import { emptyChatState, startPoll } from "../../src/core/state.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import { applyUpdates } from "../../src/core/updates.js"

const makeParticipant = (id: number, name: string): Participant => ({
  id: UserId(id),
  firstName: name
})

describe("applyUpdates", () => {
  it("captures chat title from messages", () => {
    const chatId = ChatId("-700")
    const update: IncomingUpdate = {
      updateId: 1,
      message: {
        chatId,
        chatType: "supergroup",
        text: "hello",
        from: makeParticipant(1, "Alice"),
        chatTitle: "Coffee Club"
      }
    }
    const base = emptyState(RngSeed(1))
    const next = applyUpdates(base, [update])
    expect(next.chats[chatId]?.title).toBe("Coffee Club")
  })

  it("adds and removes participants based on poll votes", () => {
    const chatId = ChatId("-800")
    const pollId = PollId("poll-3")
    const poll = {
      pollId,
      messageId: MessageId(3),
      chatId,
      summaryDate: LocalDateString("2026-01-12"),
      threadId: null
    }
    const base = {
      ...emptyState(RngSeed(2)),
      chats: {
        [chatId]: emptyChatState(RngSeed(2))
      }
    }
    const withPoll = startPoll(base, chatId, poll)
    const alice = makeParticipant(2, "Alice")

    const voteYes: IncomingUpdate = {
      updateId: 2,
      pollVote: {
        pollId,
        participant: alice,
        optionIds: [0]
      }
    }
    const voteNo: IncomingUpdate = {
      updateId: 3,
      pollVote: {
        pollId,
        participant: alice,
        optionIds: [1]
      }
    }

    const afterYes = applyUpdates(withPoll, [voteYes])
    expect(Object.keys(afterYes.chats[chatId]?.participants ?? {}).length).toBe(1)

    const afterNo = applyUpdates(afterYes, [voteNo])
    expect(Object.keys(afterNo.chats[chatId]?.participants ?? {}).length).toBe(0)
  })
})
