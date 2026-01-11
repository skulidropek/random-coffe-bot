import type { UserId } from "./brand.js"
import type { Participant, ParticipantsById } from "./domain.js"

const participantKey = (id: UserId): string => id.toString()

// CHANGE: insert or replace a participant by id
// WHY: keep poll participants deterministic and keyed by user id
// QUOTE(TZ): "между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall p: upsert(ps, p)[key(p)] = p
// PURITY: CORE
// INVARIANT: resulting record contains exactly one entry per user id
// COMPLEXITY: O(1)/O(n)
export const upsertParticipant = (
  participants: ParticipantsById,
  participant: Participant
): ParticipantsById => ({
  ...participants,
  [participantKey(participant.id)]: participant
})

// CHANGE: remove a participant by id
// WHY: reflect vote retractions in the current poll set
// QUOTE(TZ): "между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall id: remove(ps, id) does not contain key(id)
// PURITY: CORE
// INVARIANT: entries other than the removed id are preserved
// COMPLEXITY: O(n)/O(n)
export const removeParticipant = (
  participants: ParticipantsById,
  userId: UserId
): ParticipantsById => {
  const key = participantKey(userId)
  const filtered = Object.entries(participants).filter(
    ([entryKey]) => entryKey !== key
  )
  return Object.fromEntries(filtered)
}

// CHANGE: list participants from record form
// WHY: provide a stable view for pairing and formatting
// QUOTE(TZ): "между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall ps: size(values(ps)) = size(keys(ps))
// PURITY: CORE
// INVARIANT: order is implementation-defined but deterministic for a given record
// COMPLEXITY: O(n)/O(n)
export const listParticipants = (
  participants: ParticipantsById
): ReadonlyArray<Participant> => Object.values(participants)
