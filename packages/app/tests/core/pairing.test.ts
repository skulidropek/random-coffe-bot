import { describe, expect, it } from "@effect/vitest"
import { Match } from "effect"

import { PairKey, RngSeed, UserId } from "../../src/core/brand.js"
import type { Pairing, Participant } from "../../src/core/domain.js"
import { pairParticipants, updateHistory } from "../../src/core/pairing.js"

const participant = (id: number, name: string): Participant => ({
  id: UserId(id),
  firstName: name
})

const flattenMembers = (pairs: ReadonlyArray<Pairing>): ReadonlyArray<Participant> =>
  pairs.flatMap((pair) =>
    Match.value(pair).pipe(
      Match.when({ kind: "pair" }, (value) => value.members),
      Match.when({ kind: "triple" }, (value) => value.members),
      Match.exhaustive
    )
  )

describe("pairParticipants", () => {
  it("keeps each participant at most once across pairs and leftovers", () => {
    const participants = [
      participant(1, "A"),
      participant(2, "B"),
      participant(3, "C"),
      participant(4, "D"),
      participant(5, "E")
    ]
    const result = pairParticipants(participants, {}, RngSeed(1))
    const members = [...flattenMembers(result.pairs), ...result.leftovers]
    const ids = members.map((member) => member.id.toString())
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(participants.length)
  })

  it("increments history counts", () => {
    const a = participant(1, "A")
    const b = participant(2, "B")
    const history = updateHistory({}, [
      { kind: "pair", members: [a, b] }
    ])
    expect(history[PairKey("1-2")]).toBe(1)
  })

  it("leaves one participant without a pair when odd", () => {
    const participants = [
      participant(1, "A"),
      participant(2, "B"),
      participant(3, "C")
    ]
    const result = pairParticipants(participants, {}, RngSeed(1))
    expect(result.leftovers.length).toBe(1)
    expect(result.pairs.length).toBe(1)
  })
})
