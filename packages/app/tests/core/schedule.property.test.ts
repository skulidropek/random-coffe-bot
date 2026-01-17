import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import { ChatId, LocalDateString, MessageId, PollId, RngSeed } from "../../src/core/brand.js"
import type { ChatState } from "../../src/core/domain.js"
import { decideSchedule, formatLocalDate, nextPollWindow, summaryDateForPoll } from "../../src/core/schedule.js"

const datePartsArb = fc.record({
  year: fc.integer({ min: 2000, max: 2100 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 })
})

const baseChatState = (): ChatState => ({
  poll: null,
  participants: {},
  history: {},
  seed: RngSeed(1),
  threadId: null,
  title: null,
  lastSummaryAt: null
})

const buildChatWithPoll = (summaryDate: LocalDateString, suffix: string): ChatState => ({
  ...baseChatState(),
  poll: {
    pollId: PollId(`poll-${suffix}`),
    messageId: MessageId(1),
    chatId: ChatId(`chat-${suffix}`),
    summaryDate,
    threadId: null
  }
})

const addDays = (year: number, month: number, day: number, days: number): LocalDateString => {
  const base = new Date(Date.UTC(year, month - 1, day))
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
  const result = [
    next.getUTCFullYear().toString().padStart(4, "0"),
    (next.getUTCMonth() + 1).toString().padStart(2, "0"),
    next.getUTCDate().toString().padStart(2, "0")
  ].join("-")
  return LocalDateString(result)
}

describe("schedule", () => {
  it("formatLocalDate produces YYYY-MM-DD", () => {
    fc.assert(
      fc.property(datePartsArb, (parts) => {
        const value = formatLocalDate(parts)
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    )
  })

  it("nextPollWindow opens on Fri/Sat/Sun", () => {
    fc.assert(
      fc.property(datePartsArb, fc.constantFrom("Fri", "Sat", "Sun"), (parts, weekday) => {
        const window = nextPollWindow(parts, weekday)
        expect(window.isOpen).toBe(true)
        expect(window.daysUntilStart).toBe(0)
        expect(window.startDate).toBe(formatLocalDate(parts))
      })
    )
  })

  it("nextPollWindow is closed on Mon-Thu", () => {
    fc.assert(
      fc.property(datePartsArb, fc.constantFrom("Mon", "Tue", "Wed", "Thu"), (parts, weekday) => {
        const window = nextPollWindow(parts, weekday)
        expect(window.isOpen).toBe(false)
        expect(window.daysUntilStart).toBeGreaterThan(0)
      })
    )
  })

  it("summaryDateForPoll advances to next Monday", () => {
    fc.assert(
      fc.property(datePartsArb, fc.constantFrom("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), (parts, weekday) => {
        const summaryDate = summaryDateForPoll(parts, weekday)
        if (weekday === "Mon") {
          const expected = addDays(parts.year, parts.month, parts.day, 7)
          expect(summaryDate).toBe(expected)
        } else {
          expect(summaryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        }
      })
    )
  })

  it("decideSchedule returns noop when lastSummaryAt is today", () => {
    fc.assert(
      fc.property(datePartsArb, fc.constantFrom("Mon", "Fri"), (parts, weekday) => {
        const today = formatLocalDate(parts)
        const chat: ChatState = { ...baseChatState(), lastSummaryAt: today }
        expect(decideSchedule(chat, parts, weekday)).toEqual({ kind: "noop" })
      })
    )
  })

  it("decideSchedule summarizes on Monday when poll is due", () => {
    fc.assert(
      fc.property(datePartsArb, (parts) => {
        const today = formatLocalDate(parts)
        const chat = buildChatWithPoll(today, "due")
        expect(decideSchedule(chat, parts, "Mon")).toEqual({ kind: "summarize", summaryDate: today })
      })
    )
  })

  it("decideSchedule skips when poll exists on a non-summary day", () => {
    fc.assert(
      fc.property(datePartsArb, (parts) => {
        const today = formatLocalDate(parts)
        const chat = buildChatWithPoll(today, "skip")
        const decision = decideSchedule(chat, parts, "Tue")
        expect(decision).toEqual({ kind: "noop" })
      })
    )
  })

  it("decideSchedule creates polls on poll days when needed", () => {
    fc.assert(
      fc.property(datePartsArb, (parts) => {
        const chat = baseChatState()
        const decision = decideSchedule(chat, parts, "Fri")
        expect(decision.kind).toBe("createPoll")
      })
    )
  })

  it("decideSchedule noops when poll already scheduled for next Monday", () => {
    fc.assert(
      fc.property(datePartsArb, (parts) => {
        const summaryDate = addDays(parts.year, parts.month, parts.day, 3)
        const chat: ChatState = {
          ...baseChatState(),
          poll: {
            pollId: PollId("poll-2"),
            messageId: MessageId(2),
            chatId: ChatId("chat-2"),
            summaryDate,
            threadId: null
          }
        }
        const decision = decideSchedule(chat, parts, "Fri")
        expect(decision.kind).toBe("noop")
      })
    )
  })
})
