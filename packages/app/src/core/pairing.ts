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

export type PairingAssignment = {
  readonly participant: Participant
  readonly counterparts: ReadonlyArray<Participant>
  readonly isOrganizer: boolean
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

type OrganizerBuild = {
  readonly assignments: ReadonlyArray<PairingAssignment>
  readonly seed: RngSeed
}

const buildAssignments = (
  members: ReadonlyArray<Participant>,
  seed: RngSeed
): OrganizerBuild => {
  if (members.length === 0) {
    return { assignments: [], seed }
  }
  const picked = randomInt(seed, members.length)
  const organizer = members[picked.value] ?? members[0]
  const assignments = members.map((participant) => ({
    participant,
    counterparts: members.filter((candidate) => candidate.id !== participant.id),
    isOrganizer: organizer ? organizer.id === participant.id : false
  }))
  return { assignments, seed: picked.seed }
}

const assignOrganizersForPair = (
  pair: Pairing,
  seed: RngSeed
): OrganizerBuild =>
  Match.value(pair).pipe(
    Match.when({ kind: "pair" }, (value) => buildAssignments(value.members, seed)),
    Match.when({ kind: "triple" }, (value) => buildAssignments(value.members, seed)),
    Match.exhaustive
  )

// CHANGE: assign a random organizer for each pairing
// WHY: decide who starts the conversation in direct messages
// QUOTE(TZ): "Ты рандомно выбран организатором этой встречи"
// REF: user-2026-01-20-direct-dm
// SOURCE: n/a
// FORMAT THEOREM: forall p in pairs: exists o in members(p): isOrganizer(o)
// PURITY: CORE
// INVARIANT: each participant has exactly one assignment per pairing
// COMPLEXITY: O(n)/O(n)
export const assignOrganizers = (
  pairs: ReadonlyArray<Pairing>,
  seed: RngSeed
): OrganizerBuild => {
  let nextSeed = seed
  let assignments: ReadonlyArray<PairingAssignment> = []
  for (const pair of pairs) {
    const result = assignOrganizersForPair(pair, nextSeed)
    nextSeed = result.seed
    assignments = [...assignments, ...result.assignments]
  }
  return { assignments, seed: nextSeed }
}

// CHANGE: create assignments for participants without a counterpart
// WHY: notify solo participants after summary runs
// QUOTE(TZ): "если ты один то тебе сообщение тоже бы приходило"
// REF: user-2026-01-20-direct-dm-solo
// SOURCE: n/a
// FORMAT THEOREM: forall p in participants: counterparts(p) = []
// PURITY: CORE
// INVARIANT: isOrganizer is false for solo assignments
// COMPLEXITY: O(n)/O(n)
export const assignSoloParticipants = (
  participants: ReadonlyArray<Participant>
): ReadonlyArray<PairingAssignment> =>
  participants.map((participant) => ({
    participant,
    counterparts: [],
    isOrganizer: false
  }))

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
