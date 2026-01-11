import type { LocalDateString } from "./brand.js"
import { LocalDateString as LocalDate } from "./brand.js"
import type { ChatState } from "./domain.js"

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"

export type LocalDateParts = {
  readonly year: number
  readonly month: number
  readonly day: number
}

export type ScheduleDecision =
  | { readonly kind: "createPoll"; readonly summaryDate: LocalDateString }
  | { readonly kind: "summarize"; readonly summaryDate: LocalDateString }
  | { readonly kind: "noop" }

export type PollWindow = {
  readonly startDate: LocalDateString
  readonly daysUntilStart: number
  readonly isOpen: boolean
}

const weekdayIndex: Readonly<Record<Weekday, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
}

// CHANGE: build a LocalDateString from parts
// WHY: reuse date formatting across scheduling and manual commands
// QUOTE(TZ): n/a
// REF: user-2026-01-09-manual-summary
// SOURCE: n/a
// FORMAT THEOREM: forall p: format(p) matches YYYY-MM-DD
// PURITY: CORE
// INVARIANT: output is a valid LocalDateString
// COMPLEXITY: O(1)/O(1)
export const formatLocalDate = (parts: LocalDateParts): LocalDateString => {
  const year = parts.year.toString().padStart(4, "0")
  const month = parts.month.toString().padStart(2, "0")
  const day = parts.day.toString().padStart(2, "0")
  return LocalDate(`${year}-${month}-${day}`)
}

const addDays = (parts: LocalDateParts, days: number): LocalDateParts => {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  }
}

const nextMonday = (parts: LocalDateParts, weekday: Weekday): LocalDateString => {
  const index = weekdayIndex[weekday]
  const daysToMonday = (8 - index) % 7
  return formatLocalDate(addDays(parts, daysToMonday))
}

const isPollDay = (weekday: Weekday): boolean => weekday === "Fri" || weekday === "Sat" || weekday === "Sun"

const isSummaryDay = (
  chat: ChatState,
  today: LocalDateString,
  weekday: Weekday
): boolean => weekday === "Mon" && chat.poll?.summaryDate === today

const shouldSkipSchedule = (
  chat: ChatState,
  today: LocalDateString,
  weekday: Weekday
): boolean => {
  if (chat.lastSummaryAt === today) {
    return true
  }
  if (chat.poll && !isSummaryDay(chat, today, weekday)) {
    return true
  }
  return false
}

// CHANGE: compute the next poll window relative to today
// WHY: answer user queries about when the next poll can start
// QUOTE(TZ): "команду которая скажет через сколько начало будет"
// REF: user-2026-01-09-nextpoll
// SOURCE: n/a
// FORMAT THEOREM: forall d: daysUntilStart >= 0
// PURITY: CORE
// INVARIANT: startDate is a valid LocalDateString
// COMPLEXITY: O(1)/O(1)
export const nextPollWindow = (
  todayParts: LocalDateParts,
  weekday: Weekday
): PollWindow => {
  if (isPollDay(weekday)) {
    return {
      startDate: formatLocalDate(todayParts),
      daysUntilStart: 0,
      isOpen: true
    }
  }

  const targetIndex = weekdayIndex.Fri
  const currentIndex = weekdayIndex[weekday]
  const daysUntil = (targetIndex - currentIndex + 7) % 7

  return {
    startDate: formatLocalDate(addDays(todayParts, daysUntil)),
    daysUntilStart: daysUntil,
    isOpen: false
  }
}

// CHANGE: compute the next summary date for a manual poll
// WHY: allow admins to trigger polls on any day with a predictable summary date
// QUOTE(TZ): "Сделать моментальный опросник"
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall d: summaryDate(d) is a Monday
// PURITY: CORE
// INVARIANT: returned date is a valid LocalDateString
// COMPLEXITY: O(1)/O(1)
export const summaryDateForPoll = (
  todayParts: LocalDateParts,
  weekday: Weekday
): LocalDateString => {
  const index = weekdayIndex[weekday]
  const daysToMonday = weekday === "Mon" ? 7 : (8 - index) % 7
  return formatLocalDate(addDays(todayParts, daysToMonday))
}

// CHANGE: decide whether to create a poll or summarize based on the calendar
// WHY: enforce the weekly Friday/Saturday poll and Monday summary cycle deterministically
// QUOTE(TZ): "Создаёт опросник в пятницу/субботу а подводит итог в понедельник"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s: decision(s, Mon) = summarize iff poll.summaryDate = today
// PURITY: CORE
// INVARIANT: decisions never schedule both create and summarize on the same tick
// COMPLEXITY: O(1)/O(1)
export const decideSchedule = (
  chat: ChatState,
  todayParts: LocalDateParts,
  weekday: Weekday
): ScheduleDecision => {
  const today = formatLocalDate(todayParts)

  if (shouldSkipSchedule(chat, today, weekday)) {
    return { kind: "noop" }
  }

  if (isSummaryDay(chat, today, weekday)) {
    return { kind: "summarize", summaryDate: today }
  }

  if (isPollDay(weekday)) {
    const summaryDate = nextMonday(todayParts, weekday)
    if (chat.poll?.summaryDate !== summaryDate) {
      return { kind: "createPoll", summaryDate }
    }
  }

  return { kind: "noop" }
}
