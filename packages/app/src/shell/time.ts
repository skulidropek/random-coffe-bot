import { Data, Effect } from "effect"

import type { LocalDateParts, Weekday } from "../core/schedule.js"

export class TimeError extends Data.TaggedError("TimeError")<{
  readonly message: string
}> {}

const weekdayMap: Readonly<Record<string, Weekday>> = {
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
  Sun: "Sun"
}

const parseLocalDateParts = (parts: Array<Intl.DateTimeFormatPart>): LocalDateParts => {
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0")
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0")
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0")
  return { year, month, day }
}

const parseWeekday = (value: string): Weekday => weekdayMap[value] ?? "Mon"

// CHANGE: compute the local date and weekday for a timezone
// WHY: drive scheduling decisions without relying on mutable global time
// QUOTE(TZ): "Создаёт опросник в пятницу/субботу а подводит итог в понедельник"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall now: result.weekday in Weekday
// PURITY: SHELL
// EFFECT: Effect<{parts, weekday}, TimeError, never>
// INVARIANT: local date parts are consistent with the given timezone
// COMPLEXITY: O(1)/O(1)
export const getZonedDate = (
  timeZone: string,
  now: Date
): Effect.Effect<
  { readonly parts: LocalDateParts; readonly weekday: Weekday },
  TimeError
> =>
  Effect.try({
    try: () => {
      const dateFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      })
      const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short"
      })

      const parts = parseLocalDateParts(dateFormatter.formatToParts(now))
      const weekday = parseWeekday(weekdayFormatter.format(now))

      return { parts, weekday }
    },
    catch: (error) =>
      new TimeError({
        message: error instanceof Error ? error.message : String(error)
      })
  })
