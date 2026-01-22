import type { ChatId, UserId } from "./brand.js"
import type { PendingProfileEdits, UserProfile, UserProfiles } from "./domain.js"

const profileKey = (userId: UserId): string => userId.toString()
const pendingKey = (chatId: ChatId): string => chatId.toString()

// CHANGE: normalize profile text input
// WHY: avoid storing empty or whitespace-only profiles
// QUOTE(TZ): "Профиль просто внутри бота делается Там текст и всё"
// REF: user-2026-01-21-profile-text
// SOURCE: n/a
// FORMAT THEOREM: forall t: normalize(t) = null ⇔ trim(t) = ""
// PURITY: CORE
// INVARIANT: non-null output is non-empty after trimming
// COMPLEXITY: O(n)/O(1)
export const normalizeProfileText = (text: string): string | null => {
  const trimmed = text.trim()
  return trimmed.length === 0 ? null : trimmed
}

// CHANGE: upsert a user profile into the profile map
// WHY: keep profile updates idempotent and keyed by user id
// QUOTE(TZ): n/a
// REF: user-2026-01-21-profile-text
// SOURCE: n/a
// FORMAT THEOREM: forall p: upsert(ps, p)[key(p)] = p
// PURITY: CORE
// INVARIANT: map contains at most one profile per user id
// COMPLEXITY: O(1)/O(n)
export const upsertProfile = (
  profiles: UserProfiles,
  profile: UserProfile
): UserProfiles => ({
  ...profiles,
  [profileKey(profile.userId)]: profile
})

// CHANGE: lookup a user profile by id
// WHY: allow formatting and pairing logic to reuse stored profiles
// QUOTE(TZ): "Профиль просто внутри бота делается Там текст и всё"
// REF: user-2026-01-21-profile-text
// SOURCE: n/a
// FORMAT THEOREM: forall ps,id: find(ps,id) = ps[key(id)] | undefined
// PURITY: CORE
// INVARIANT: returns undefined when profile is absent
// COMPLEXITY: O(1)/O(1)
export const findProfile = (
  profiles: UserProfiles,
  userId: UserId
): UserProfile | undefined => profiles[profileKey(userId)]

// CHANGE: mark a chat as awaiting profile input
// WHY: update profiles only after explicit user intent
// QUOTE(TZ): "Заполнить профиль и изменить описание это по сути одно и тоже"
// REF: user-2026-01-21-profile-edit-unify
// SOURCE: n/a
// FORMAT THEOREM: forall p,id: mark(p,id)[key(id)] = true
// PURITY: CORE
// INVARIANT: keys are unique per chat
// COMPLEXITY: O(1)/O(n)
export const markProfileEditPending = (
  pending: PendingProfileEdits,
  chatId: ChatId
): PendingProfileEdits => ({
  ...pending,
  [pendingKey(chatId)]: true
})

// CHANGE: clear the pending profile edit flag
// WHY: stop capturing messages after profile is saved
// QUOTE(TZ): "Заполнить профиль и изменить описание это по сути одно и тоже"
// REF: user-2026-01-21-profile-edit-unify
// SOURCE: n/a
// FORMAT THEOREM: forall p,id: key(id) not in clear(p,id)
// PURITY: CORE
// INVARIANT: other keys are preserved
// COMPLEXITY: O(n)/O(n)
export const clearProfileEditPending = (
  pending: PendingProfileEdits,
  chatId: ChatId
): PendingProfileEdits => {
  const key = pendingKey(chatId)
  const entries = Object.entries(pending).filter(([entryKey]) => entryKey !== key)
  return Object.fromEntries(entries)
}

// CHANGE: check if profile input is expected for a chat
// WHY: avoid overwriting profiles unless the user requested it
// QUOTE(TZ): "Заполнить профиль и изменить описание это по сути одно и тоже"
// REF: user-2026-01-21-profile-edit-unify
// SOURCE: n/a
// FORMAT THEOREM: forall p,id: isPending(p,id) -> key(id) in pending
// PURITY: CORE
// INVARIANT: returns false for missing keys
// COMPLEXITY: O(1)/O(1)
export const isProfileEditPending = (
  pending: PendingProfileEdits,
  chatId: ChatId
): boolean => pending[pendingKey(chatId)] === true
