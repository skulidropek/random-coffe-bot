import type {
  ChatId as ChatIdBrand,
  LocalDateString as LocalDateStringBrand,
  MessageId as MessageIdBrand,
  PairKey as PairKeyBrand,
  PollId as PollIdBrand,
  RngSeed as RngSeedBrand,
  UserId as UserIdBrand
} from "./brand.js"

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: ensure ids are created explicitly and never mixed by accident
// QUOTE(TZ): "Его задача в том что бы просто между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n in Number: UserId(n) = n ∧ type(UserId(n)) = UserId
// PURITY: CORE
// INVARIANT: branding does not change runtime representation
// COMPLEXITY: O(1)/O(1)
export const UserId = (value: number): UserIdBrand => value as UserIdBrand

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: keep chat ids normalized as strings for stable storage keys
// QUOTE(TZ): "Его добавляют в группу"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: ChatId(s) = s
// PURITY: CORE
// INVARIANT: chat id string stays unchanged
// COMPLEXITY: O(1)/O(1)
export const ChatId = (value: string): ChatIdBrand => value as ChatIdBrand

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: treat poll identifiers as opaque values in the domain
// QUOTE(TZ): "создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: PollId(s) = s
// PURITY: CORE
// INVARIANT: poll id string stays unchanged
// COMPLEXITY: O(1)/O(1)
export const PollId = (value: string): PollIdBrand => value as PollIdBrand

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: keep message ids distinct from other numeric identifiers
// QUOTE(TZ): "создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n in Number: MessageId(n) = n
// PURITY: CORE
// INVARIANT: message id number stays unchanged
// COMPLEXITY: O(1)/O(1)
export const MessageId = (value: number): MessageIdBrand => value as MessageIdBrand

// CHANGE: provide constructors for RNG seeds
// WHY: make randomness explicit and deterministic in the core
// QUOTE(TZ): "желательно постоянно выбирать новую пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n in Number: RngSeed(n) = n
// PURITY: CORE
// INVARIANT: seed remains a number
// COMPLEXITY: O(1)/O(1)
export const RngSeed = (value: number): RngSeedBrand => value as RngSeedBrand

// CHANGE: provide constructors for pair keys
// WHY: persist history with stable normalized keys
// QUOTE(TZ): "Что бы меньше попадались те кто уже был"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: PairKey(s) = s
// PURITY: CORE
// INVARIANT: pair key stays unchanged
// COMPLEXITY: O(1)/O(1)
export const PairKey = (value: string): PairKeyBrand => value as PairKeyBrand

// CHANGE: provide constructors for local date strings
// WHY: keep schedule decisions explicit in persisted state
// QUOTE(TZ): "Создаёт опросник в пятницу/субботу а подводит итог в понедельник"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: LocalDateString(s) = s
// PURITY: CORE
// INVARIANT: local date string stays unchanged
// COMPLEXITY: O(1)/O(1)
export const LocalDateString = (value: string): LocalDateStringBrand => value as LocalDateStringBrand
