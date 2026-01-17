import fc from "fast-check"

import { LocalDateString, UserId } from "../../src/core/brand.js"
import type { Participant } from "../../src/core/domain.js"

export const alphaChar = fc.constantFrom<string>(
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z"
)

export const alphaString = fc.string({ minLength: 1, maxLength: 10, unit: alphaChar })

export const localDateArb = fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") })
  .map((date) => {
    const value = [
      date.getUTCFullYear().toString().padStart(4, "0"),
      (date.getUTCMonth() + 1).toString().padStart(2, "0"),
      date.getUTCDate().toString().padStart(2, "0")
    ].join("-")
    return LocalDateString(value)
  })

export const participant = (
  id: number,
  firstName: string,
  lastName?: string,
  username?: string
): Participant => ({
  id: UserId(id),
  firstName,
  lastName,
  username
})

export const participantArb = fc.record({
  id: fc.integer({ min: 1, max: 10_000 }),
  firstName: alphaString
}).map((raw): Participant => ({
  id: UserId(raw.id),
  firstName: raw.firstName
}))
