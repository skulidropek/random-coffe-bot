import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import { RngSeed } from "../../src/core/brand.js"
import { nextSeed, randomInt, shuffle } from "../../src/core/rng.js"

const modulus = 2_147_483_647

const shuffleItems = <T>(items: ReadonlyArray<T>, seed: number): ReadonlyArray<T> => shuffle(items, RngSeed(seed)).items

const expectSameLength = <T>(items: ReadonlyArray<T>, result: ReadonlyArray<T>): void => {
  expect(result.length).toBe(items.length)
}

const assertShuffle = <T>(items: ReadonlyArray<T>, seed: number): ReadonlyArray<T> => {
  const result = shuffleItems(items, seed)
  expectSameLength(items, result)
  return result
}

const countUndefined = (values: ReadonlyArray<number | undefined>): number =>
  values.filter((value) => value === undefined).length

const countNumbers = (values: ReadonlyArray<number>): Record<string, number> => {
  let counts: Record<string, number> = {}
  for (const value of values) {
    const key = value.toString()
    const current = counts[key] ?? 0
    counts = { ...counts, [key]: current + 1 }
  }
  return counts
}

describe("rng", () => {
  it("nextSeed stays within (0, modulus)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (seed) => {
        const next = nextSeed(RngSeed(seed))
        expect(next).toBeGreaterThan(0)
        expect(next).toBeLessThan(modulus)
      })
    )
  })

  it("randomInt returns 0 when upperExclusive <= 0", () => {
    fc.assert(
      fc.property(fc.constantFrom(0, -1, -10), (upperExclusive) => {
        const result = randomInt(RngSeed(1), upperExclusive)
        expect(result.value).toBe(0)
      })
    )
  })

  it("randomInt returns values within bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (upperExclusive, seed) => {
          const result = randomInt(RngSeed(seed), upperExclusive)
          expect(result.value).toBeGreaterThanOrEqual(0)
          expect(result.value).toBeLessThan(upperExclusive)
        }
      )
    )
  })

  it("shuffle preserves length and multiset", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 12 }), fc.integer(), (items, seed) => {
        const result = assertShuffle(items, seed)
        expect(countNumbers(result)).toEqual(countNumbers(items))
      })
    )
  })

  it("shuffle preserves undefined entries", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ReadonlyArray<number | undefined>>(
          [undefined, 1],
          [1, undefined],
          [undefined, undefined],
          [2, undefined, 3]
        ),
        fc.integer(),
        (items, seed) => {
          const result = assertShuffle(items, seed)
          expect(countUndefined(result)).toBe(countUndefined(items))
        }
      )
    )
  })
})
