// CHANGE: parse and normalize Telegram chat invite links
// WHY: keep link validation in the functional core
// QUOTE(TZ): "должна быть ссылка на группу"
// REF: user-2026-01-18-leaderboard-link
// SOURCE: n/a
// FORMAT THEOREM: ∀s: parse(s)=l → l startsWith("https://t.me/")
// PURITY: CORE
// INVARIANT: only Telegram links or usernames are accepted
// COMPLEXITY: O(n)/O(1)
export const parseTelegramChatLink = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const username = parseTelegramUsername(trimmed)
  if (username) {
    return `https://t.me/${username}`
  }
  const path = parseTelegramUrlPath(trimmed)
  return path ? `https://t.me/${path}` : null
}

// CHANGE: build a Telegram message link for private supergroups
// WHY: allow deep-links to summary messages in direct notifications
// QUOTE(TZ): "ссылка на сообщение с итогами"
// REF: user-2026-01-20-summary-link
// SOURCE: n/a
// FORMAT THEOREM: forall id,msg: link(id,msg) startsWith("https://t.me/c/")
// PURITY: CORE
// INVARIANT: returns null when chat id cannot be mapped to t.me/c
// COMPLEXITY: O(1)/O(1)
export const formatTelegramMessageLink = (
  chatId: string,
  messageId: number,
  threadId?: number | null
): string | null => {
  if (!chatId.startsWith("-100")) {
    return null
  }
  const internalId = chatId.slice(4)
  if (!/^\d+$/.test(internalId)) {
    return null
  }
  const base = `https://t.me/c/${internalId}`
  if (threadId && threadId > 0) {
    return `${base}/${threadId}/${messageId}`
  }
  return `${base}/${messageId}`
}

const parseTelegramUsername = (value: string): string | null => {
  const username = value.startsWith("@") ? value.slice(1) : value
  return /^\w+$/u.test(username) ? username : null
}

const parseTelegramUrlPath = (value: string): string | null => {
  const match = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(.+)$/i.exec(value)
  const path = match?.[1]
  if (!path) {
    return null
  }
  const trimmed = trimTrailingSlashes(path)
  return trimmed || null
}

const trimTrailingSlashes = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") {
    end -= 1
  }
  return value.slice(0, end)
}
