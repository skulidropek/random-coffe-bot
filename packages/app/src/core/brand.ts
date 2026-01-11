// CHANGE: introduce branded identifiers to keep domain ids distinct without unsafe casts
// WHY: enforce type-level separation of Telegram ids while keeping conversions local and axiomatic
// QUOTE(TZ): "Его задача в том что бы просто между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall x in IdDomain: brand(x) -> preserves(value(x))
// PURITY: CORE
// INVARIANT: brands are only created in this axiomatic module
// COMPLEXITY: O(1)/O(1)
export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type UserId = Brand<number, "UserId">
export type ChatId = Brand<string, "ChatId">
export type PollId = Brand<string, "PollId">
export type MessageId = Brand<number, "MessageId">
export type RngSeed = Brand<number, "RngSeed">
export type PairKey = Brand<string, "PairKey">
export type LocalDateString = Brand<string, "LocalDateString">

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: ensure ids are created explicitly and never mixed by accident
// QUOTE(TZ): "Его задача в том что бы просто между теми кто голосовал выбрать пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n in Number: UserId(n) = n ∧ type(UserId(n)) = UserId
// PURITY: CORE
// INVARIANT: branding does not change runtime representation
// COMPLEXITY: O(1)/O(1)
export const UserId = (value: number): UserId => value as UserId

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: keep chat ids normalized as strings for stable storage keys
// QUOTE(TZ): "Его добавляют в группу"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: ChatId(s) = s
// PURITY: CORE
// INVARIANT: chat id string stays unchanged
// COMPLEXITY: O(1)/O(1)
export const ChatId = (value: string): ChatId => value as ChatId

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: treat poll identifiers as opaque values in the domain
// QUOTE(TZ): "создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: PollId(s) = s
// PURITY: CORE
// INVARIANT: poll id string stays unchanged
// COMPLEXITY: O(1)/O(1)
export const PollId = (value: string): PollId => value as PollId

// CHANGE: provide constructors for branded identifiers at the boundary
// WHY: keep message ids distinct from other numeric identifiers
// QUOTE(TZ): "создаёт опросник раз в неделю"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n in Number: MessageId(n) = n
// PURITY: CORE
// INVARIANT: message id number stays unchanged
// COMPLEXITY: O(1)/O(1)
export const MessageId = (value: number): MessageId => value as MessageId

// CHANGE: provide constructors for RNG seeds
// WHY: make randomness explicit and deterministic in the core
// QUOTE(TZ): "желательно постоянно выбирать новую пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n in Number: RngSeed(n) = n
// PURITY: CORE
// INVARIANT: seed remains a number
// COMPLEXITY: O(1)/O(1)
export const RngSeed = (value: number): RngSeed => value as RngSeed

// CHANGE: provide constructors for pair keys
// WHY: persist history with stable normalized keys
// QUOTE(TZ): "Что бы меньше попадались те кто уже был"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: PairKey(s) = s
// PURITY: CORE
// INVARIANT: pair key stays unchanged
// COMPLEXITY: O(1)/O(1)
export const PairKey = (value: string): PairKey => value as PairKey

// CHANGE: provide constructors for local date strings
// WHY: keep schedule decisions explicit in persisted state
// QUOTE(TZ): "Создаёт опросник в пятницу/субботу а подводит итог в понедельник"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s in String: LocalDateString(s) = s
// PURITY: CORE
// INVARIANT: local date string stays unchanged
// COMPLEXITY: O(1)/O(1)
export const LocalDateString = (value: string): LocalDateString => value as LocalDateString
