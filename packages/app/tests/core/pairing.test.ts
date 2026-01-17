import { describe, expect, it } from "@effect/vitest"
import { Match } from "effect"
import fc from "fast-check"

import { PairKey, RngSeed } from "../../src/core/brand.js"
import type { Pairing, Participant } from "../../src/core/domain.js"
import { pairParticipants, updateHistory } from "../../src/core/pairing.js"
import { participantArb } from "./property-helpers.js"

const uniqueParticipants = fc.uniqueArray(participantArb, {
  selector: (participant) => participant.id,
  minLength: 0,
  maxLength: 8
})

const flattenMembers = (pairs: ReadonlyArray<Pairing>): ReadonlyArray<Participant> =>
  pairs.flatMap((pair) =>
    Match.value(pair).pipe(
      Match.when({ kind: "pair" }, (value) => value.members),
      Match.when({ kind: "triple" }, (value) => value.members),
      Match.exhaustive
    )
  )

const pairKey = (a: Participant, b: Participant): PairKey => {
  const first = Math.min(a.id, b.id)
  const second = Math.max(a.id, b.id)
  return PairKey(`${first}-${second}`)
}

describe("pairParticipants", () => {
  it("keeps each participant at most once across pairs and leftovers", () => {
    fc.assert(
      fc.property(uniqueParticipants, fc.integer(), (participants, seed) => {
        const result = pairParticipants(participants, {}, RngSeed(seed))
        const members = [...flattenMembers(result.pairs), ...result.leftovers]
        const ids = members.map((member) => member.id.toString())
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.length).toBe(participants.length)
      })
    )
  })

  it("returns no pairs when there are fewer than two participants", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(participantArb, { selector: (p) => p.id, maxLength: 1 }),
        fc.integer(),
        (participants, seed) => {
          const result = pairParticipants(participants, {}, RngSeed(seed))
          expect(result.pairs.length).toBe(0)
          expect(result.leftovers.length).toBe(participants.length)
        }
      )
    )
  })

  it("leaves at most one participant without a pair", () => {
    fc.assert(
      fc.property(uniqueParticipants, fc.integer(), (participants, seed) => {
        const result = pairParticipants(participants, {}, RngSeed(seed))
        expect(result.leftovers.length).toBe(participants.length % 2)
      })
    )
  })

  it("increments history counts for pairs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(participantArb, { selector: (p) => p.id, minLength: 2, maxLength: 2 }),
        (participants) => {
          const [a, b] = participants
          if (!a || !b) {
            return
          }
          const history = updateHistory({}, [
            { kind: "pair", members: [a, b] }
          ])
          expect(history[pairKey(a, b)]).toBe(1)
        }
      )
    )
  })

  it("increments history counts for triples", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(participantArb, { selector: (p) => p.id, minLength: 3, maxLength: 3 }),
        (participants) => {
          const [a, b, c] = participants
          if (!a || !b || !c) {
            return
          }
          const history = updateHistory({}, [
            { kind: "triple", members: [a, b, c] }
          ])
          expect(history[pairKey(a, b)]).toBe(1)
          expect(history[pairKey(a, c)]).toBe(1)
          expect(history[pairKey(b, c)]).toBe(1)
        }
      )
    )
  })
})
