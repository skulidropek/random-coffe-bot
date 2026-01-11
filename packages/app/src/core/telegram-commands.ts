import type { ChatType } from "./domain.js"

// CHANGE: centralize chat-type and command parsing helpers
// WHY: reuse consistent command normalization across app modules
// QUOTE(TZ): n/a
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall t: group(t) <-> t in {group, supergroup}
// PURITY: CORE
// INVARIANT: returns true only for group chats
// COMPLEXITY: O(1)/O(1)
export const isGroupChat = (chatType: ChatType): boolean => chatType === "group" || chatType === "supergroup"

// CHANGE: normalize telegram command tokens
// WHY: ignore bot username suffix and trailing arguments
// QUOTE(TZ): n/a
// REF: user-2026-01-09-commands
// SOURCE: n/a
// FORMAT THEOREM: forall s: normalize(s) = head(tokenize(s))
// PURITY: CORE
// INVARIANT: output contains no whitespace
// COMPLEXITY: O(n)/O(n)
export const normalizeCommand = (text: string): string => {
  const token = text.trim().split(/\s+/)[0] ?? ""
  return token.split("@")[0] ?? ""
}
