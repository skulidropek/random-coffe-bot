import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import { ChatId, LocalDateString, PollId } from "../../src/core/brand.js"
import type { Pairing, Participant } from "../../src/core/domain.js"
import {
  formatParticipantLog,
  formatPollClosedNoResults,
  formatPollQuestion,
  formatStartReply,
  formatSummary,
  formatUpdateLog,
  logNoRegisteredGroupChats,
  logPollAlreadyClosed,
  logPollCreated,
  logScheduleDecision,
  logStateSnapshot,
  logSummaryPairsSent,
  logTelegramNoUpdates,
  logTelegramReceivedUpdates,
  logTelegramUpdate,
  pollOptions,
  replyAdminOnly,
  replyNextPollWindow,
  replyPollAlreadyActive,
  replyPollAlreadyActiveWithDate,
  replyPollWindowOpen,
  replySetTopicMain,
  replySetTopicThread,
  stopPollClosedMessageFragments
} from "../../src/core/text.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import { alphaString, localDateArb, participant } from "./property-helpers.js"

describe("text", () => {
  it("poll options are stable and non-empty", () => {
    expect(pollOptions.length).toBe(2)
    expect(pollOptions[0]?.length).toBeGreaterThan(0)
    expect(pollOptions[1]?.length).toBeGreaterThan(0)
  })

  it("reply messages are non-empty", () => {
    expect(replyAdminOnly().length).toBeGreaterThan(0)
    expect(replySetTopicMain().length).toBeGreaterThan(0)
    expect(replySetTopicThread().length).toBeGreaterThan(0)
    expect(replyPollAlreadyActive().length).toBeGreaterThan(0)
    expect(replyPollWindowOpen().length).toBeGreaterThan(0)
    expect(formatStartReply().length).toBeGreaterThan(0)
    expect(formatPollQuestion().length).toBeGreaterThan(0)
    expect(formatPollClosedNoResults().length).toBeGreaterThan(0)
    expect(logTelegramNoUpdates().length).toBeGreaterThan(0)
    expect(logNoRegisteredGroupChats().length).toBeGreaterThan(0)
  })

  it("replyPollAlreadyActiveWithDate includes the date", () => {
    fc.assert(
      fc.property(localDateArb, (summaryDate) => {
        const reply = replyPollAlreadyActiveWithDate(summaryDate)
        expect(reply.includes(summaryDate)).toBe(true)
      })
    )
  })

  it("replyNextPollWindow uses singular and plural day forms", () => {
    fc.assert(
      fc.property(fc.constantFrom(1, 2), localDateArb, (days, date) => {
        const reply = replyNextPollWindow(days, date)
        expect(reply.includes(date)).toBe(true)
        if (days === 1) {
          expect(reply.includes("1 day")).toBe(true)
        } else {
          expect(reply.includes("days")).toBe(true)
        }
      })
    )
  })

  it("log helpers include dynamic values", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), alphaString, (count, detail) => {
        expect(logTelegramReceivedUpdates(count)).toContain(count.toString())
        expect(logTelegramUpdate(detail)).toContain(detail)
        expect(logStateSnapshot(1, 2, count)).toContain(count.toString())
      })
    )
  })

  it("logScheduleDecision covers all variants", () => {
    const chatId = ChatId("chat-1")
    expect(logScheduleDecision(chatId, { kind: "noop" })).toContain("noop")
    expect(logScheduleDecision(chatId, { kind: "createPoll", summaryDate: LocalDateString("2026-01-19") }))
      .toContain("createPoll")
    expect(logScheduleDecision(chatId, { kind: "summarize", summaryDate: LocalDateString("2026-01-19") }))
      .toContain("summarize")
  })

  it("poll log helpers include ids and dates", () => {
    fc.assert(
      fc.property(localDateArb, (summaryDate) => {
        const chatId = ChatId("chat-2")
        expect(logPollCreated(chatId, summaryDate)).toContain(summaryDate)
        expect(logPollAlreadyClosed(chatId)).toContain(chatId)
        expect(logSummaryPairsSent(chatId)).toContain(chatId)
      })
    )
  })

  it("formatParticipantLog handles missing participant", () => {
    const missing: Participant | undefined = undefined
    expect(formatParticipantLog(missing)).toBe("participant=none")
  })

  it("formatParticipantLog formats username and name", () => {
    const user = participant(1, "Ada", "Lovelace", "ada")
    const text = formatParticipantLog(user)
    expect(text).toContain("username=@ada")
    expect(text).toContain("name=\"Ada Lovelace\"")
  })

  it("formatParticipantLog formats without username", () => {
    const user = participant(2, "Linus")
    const text = formatParticipantLog(user)
    expect(text).toContain("username=-")
    expect(text).toContain("name=\"Linus\"")
  })

  it("formatUpdateLog composes all available update parts", () => {
    const update: IncomingUpdate = {
      updateId: 1,
      chatSeen: {
        chatId: ChatId("chat-3"),
        chatType: "supergroup",
        chatTitle: "Chat"
      },
      pollVote: {
        pollId: PollId("poll-1"),
        participant: undefined,
        optionIds: [0]
      },
      message: {
        chatId: ChatId("chat-3"),
        chatType: "supergroup",
        text: "/start",
        from: participant(3, "Mia")
      }
    }
    const text = formatUpdateLog(update)
    expect(text).toContain("updateId=1")
    expect(text).toContain("chatSeen")
    expect(text).toContain("pollVote")
    expect(text).toContain("participant=none")
    expect(text).toContain("message")
  })

  it("formatUpdateLog handles updates without optional fields", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (updateId) => {
        const update: IncomingUpdate = { updateId }
        const text = formatUpdateLog(update)
        expect(text).toBe(`updateId=${updateId}`)
      })
    )
  })

  it("stopPollClosedMessageFragments are lowercase and non-empty", () => {
    for (const fragment of stopPollClosedMessageFragments) {
      expect(fragment.length).toBeGreaterThan(0)
      expect(fragment).toBe(fragment.toLowerCase())
    }
  })

  it("formatSummary covers all branch combinations", () => {
    const alice = participant(10, "Alice", undefined, "alice")
    const bob = participant(11, "Bob")
    const carol = participant(12, "Carol", "Smith", "carol")
    const pair: Pairing = { kind: "pair", members: [alice, bob] }
    const triple: Pairing = { kind: "triple", members: [alice, bob, carol] }
    const safeTitle = "Fish & Chips <\"Test\">'"

    const none = formatSummary(safeTitle, [], [])
    expect(none).toContain("Not enough participants")
    expect(none).toContain("&amp;")
    expect(none).toContain("&lt;")
    expect(none).toContain("&gt;")
    expect(none).toContain("&quot;")
    expect(none).toContain("&#39;")

    const leftoversOnly = formatSummary("Team", [], [alice])
    expect(leftoversOnly).toContain("Signed up:")
    expect(leftoversOnly).toContain("tg://user?id=")

    const pairsAndLeftovers = formatSummary("Team", [pair, triple], [bob])
    expect(pairsAndLeftovers).toContain("Pairs for Team are ready!")
    expect(pairsAndLeftovers).toContain("No match this week:")
    expect(pairsAndLeftovers).toContain("tg://user?id=")

    const pairsOnly = formatSummary("Team", [pair], [])
    expect(pairsOnly).toContain("Pairs for Team are ready!")
    expect(pairsOnly).toContain("Find your match for this week below:")
  })
})
