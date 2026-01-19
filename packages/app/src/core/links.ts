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
