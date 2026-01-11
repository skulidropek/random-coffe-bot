import { Match } from "effect"

import type { RngSeed } from "./brand.js"
import { PairKey } from "./brand.js"
import type { PairHistory, Pairing, Participant } from "./domain.js"
import { randomInt, shuffle } from "./rng.js"

const keyFor = (a: Participant, b: Participant): PairKey => PairKey(a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`)

const historyCount = (
  history: PairHistory,
  a: Participant,
  b: Participant
): number => history[keyFor(a, b)] ?? 0

const incrementHistory = (
  history: PairHistory,
  a: Participant,
  b: Participant
): PairHistory => {
  const key = keyFor(a, b)
  const current = history[key] ?? 0
  return {
    ...history,
    [key]: current + 1
  }
}

const choosePartner = (
  current: Participant,
  candidates: ReadonlyArray<Participant>,
  history: PairHistory,
  seed: RngSeed
): { readonly partner: Participant; readonly seed: RngSeed } => {
  let minCount = Number.POSITIVE_INFINITY
  let best: ReadonlyArray<Participant> = []
  for (const candidate of candidates) {
    const count = historyCount(history, current, candidate)
    if (count < minCount) {
      minCount = count
      best = [candidate]
    } else if (count === minCount) {
      best = [...best, candidate]
    }
  }
  const picked = best.length > 1 ? randomInt(seed, best.length) : { value: 0, seed }
  const fallback = candidates[0]
  const partner = best[picked.value] ?? fallback ?? current
  return { partner, seed: picked.seed }
}

const removeById = (
  candidates: ReadonlyArray<Participant>,
  participant: Participant
): ReadonlyArray<Participant> => candidates.filter((candidate) => candidate.id !== participant.id)

type PairBuild = {
  readonly pairs: ReadonlyArray<Pairing>
  readonly remaining: ReadonlyArray<Participant>
  readonly seed: RngSeed
}

const buildPairs = (
  participants: ReadonlyArray<Participant>,
  history: PairHistory,
  seed: RngSeed
): PairBuild => {
  let remaining = participants
  let nextSeed = seed
  let pairs: ReadonlyArray<Pairing> = []

  while (remaining.length >= 2) {
    const current = remaining[0]
    if (!current) {
      return { pairs, remaining, seed: nextSeed }
    }
    const candidates = remaining.slice(1)
    const chosen = choosePartner(current, candidates, history, nextSeed)
    nextSeed = chosen.seed
    const pair: Pairing = { kind: "pair", members: [current, chosen.partner] }
    pairs = [...pairs, pair]
    remaining = removeById(candidates, chosen.partner)
  }

  return { pairs, remaining, seed: nextSeed }
}

// CHANGE: compute pairings with minimal repeat history
// WHY: bias matchmaking toward new pairs while remaining deterministic
// QUOTE(TZ): "желательно постоянно выбирать новую пару (Что бы меньше попадались те кто уже был)"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall p in pairs: members(p) subset participants
// PURITY: CORE
// INVARIANT: each participant appears in at most one pair
// COMPLEXITY: O(n^2)/O(n)
export const pairParticipants = (
  participants: ReadonlyArray<Participant>,
  history: PairHistory,
  seed: RngSeed
): {
  readonly pairs: ReadonlyArray<Pairing>
  readonly leftovers: ReadonlyArray<Participant>
  readonly seed: RngSeed
} => {
  if (participants.length < 2) {
    return { pairs: [], leftovers: participants, seed }
  }

  const shuffled = shuffle(participants, seed)
  const built = buildPairs(shuffled.items, history, shuffled.seed)

  return { pairs: built.pairs, leftovers: built.remaining, seed: built.seed }
}

const addPairHistory = (history: PairHistory, pair: Pairing): PairHistory =>
  Match.value(pair).pipe(
    Match.when({ kind: "pair" }, (value) => incrementHistory(history, value.members[0], value.members[1])),
    Match.when({ kind: "triple" }, (value) => {
      const withFirst = incrementHistory(history, value.members[0], value.members[1])
      const withSecond = incrementHistory(withFirst, value.members[0], value.members[2])
      return incrementHistory(withSecond, value.members[1], value.members[2])
    }),
    Match.exhaustive
  )

// CHANGE: update the pair history after a round is computed
// WHY: persist repeat counts to bias future pairings away from repeats
// QUOTE(TZ): "Что бы меньше попадались те кто уже был"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall p in pairs: history' = history + 1 for each pair in p
// PURITY: CORE
// INVARIANT: history counts only increase
// COMPLEXITY: O(n)/O(n)
export const updateHistory = (
  history: PairHistory,
  pairs: ReadonlyArray<Pairing>
): PairHistory => {
  let current = history
  for (const pair of pairs) {
    current = addPairHistory(current, pair)
  }
  return current
}
