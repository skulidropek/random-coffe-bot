import { describe, expect, it } from "@effect/vitest"

import { ChatId, LocalDateString, MessageId, PollId, RngSeed } from "../../src/core/brand.js"
import { decideSchedule, type LocalDateParts } from "../../src/core/schedule.js"
import { emptyChatState } from "../../src/core/state.js"

const friday: LocalDateParts = { year: 2026, month: 1, day: 9 }
const monday: LocalDateParts = { year: 2026, month: 1, day: 12 }
const sunday: LocalDateParts = { year: 2026, month: 1, day: 11 }

describe("decideSchedule", () => {
  const pollCases: ReadonlyArray<
    { readonly label: string; readonly parts: LocalDateParts; readonly weekday: "Fri" | "Sun" }
  > = [
    { label: "Friday", parts: friday, weekday: "Fri" },
    { label: "Sunday catch-up", parts: sunday, weekday: "Sun" }
  ]

  for (const { label, parts, weekday } of pollCases) {
    it(`creates poll on ${label} with next Monday summary`, () => {
      const chat = emptyChatState(RngSeed(1))
      const decision = decideSchedule(chat, parts, weekday)
      expect(decision.kind).toBe("createPoll")
      if (decision.kind === "createPoll") {
        expect(decision.summaryDate).toBe(LocalDateString("2026-01-12"))
      }
    })
  }

  it("summarizes on Monday when poll summary date matches", () => {
    const chat = {
      ...emptyChatState(RngSeed(1)),
      poll: {
        pollId: PollId("poll"),
        messageId: MessageId(1),
        chatId: ChatId("-100"),
        summaryDate: LocalDateString("2026-01-12"),
        threadId: null
      }
    }
    const decision = decideSchedule(chat, monday, "Mon")
    expect(decision.kind).toBe("summarize")
  })

  it("skips scheduling when summary already ran today", () => {
    const chat = {
      ...emptyChatState(RngSeed(1)),
      lastSummaryAt: LocalDateString("2026-01-09")
    }
    const decision = decideSchedule(chat, friday, "Fri")
    expect(decision.kind).toBe("noop")
  })

  it("does not create a new poll while one is active", () => {
    const chat = {
      ...emptyChatState(RngSeed(2)),
      poll: {
        pollId: PollId("poll-active"),
        messageId: MessageId(2),
        chatId: ChatId("-200"),
        summaryDate: LocalDateString("2026-01-12"),
        threadId: null
      }
    }
    const decision = decideSchedule(chat, friday, "Fri")
    expect(decision.kind).toBe("noop")
  })
})
