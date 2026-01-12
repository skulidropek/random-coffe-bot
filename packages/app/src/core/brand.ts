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

export {
  ChatId,
  LocalDateString,
  MessageId,
  PairKey,
  PollId,
  RngSeed,
  UserId
} from "./axioms.js"
