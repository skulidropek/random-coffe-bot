import { Match } from "effect"

import type { Pairing, Participant } from "./domain.js"

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")

const displayHandle = (participant: Participant): string =>
  participant.username ? `@${participant.username}` : `user-${participant.id}`

const mention = (participant: Participant): string =>
  `<a href="tg://user?id=${participant.id}">${escapeHtml(displayHandle(participant))}</a>`

const formatPair = (pair: Pairing): string =>
  Match.value(pair).pipe(
    Match.when({ kind: "pair" }, (value) => `➪ ${mention(value.members[0])} x ${mention(value.members[1])}`),
    Match.when({ kind: "triple" }, (value) =>
      `➪ ${mention(value.members[0])} x ${mention(value.members[1])} x ${mention(value.members[2])}`),
    Match.exhaustive
  )

const formatStandalone = (participant: Participant): string => `➪ ${mention(participant)}`

// CHANGE: format the weekly poll question in English
// WHY: align bot UX with the requested Random Coffee wording
// QUOTE(TZ): "Сделай все сообщения на английском языке"
// REF: user-2026-01-09-english-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: question is stable
// PURITY: CORE
// INVARIANT: question is non-empty
// COMPLEXITY: O(1)/O(1)
export const formatPollQuestion = (): string => "Hi! Will you join Random Coffee next week? ☕️"

// CHANGE: format the summary message with computed pairs
// WHY: present a Random Coffee style summary in English
// QUOTE(TZ): "Пары для Unicorn Embassy | Georgia 🦄 составлены!"
// REF: user-2026-01-09-english-messages
// SOURCE: n/a
// FORMAT THEOREM: forall pairs: lines(summary(pairs)) = |pairs| + header
// PURITY: CORE
// INVARIANT: output is valid HTML when parse_mode=HTML
// COMPLEXITY: O(n)/O(n)
export const formatSummary = (
  chatTitle: string | null,
  pairs: ReadonlyArray<Pairing>,
  leftovers: ReadonlyArray<Participant>
): string => {
  const safeTitle = chatTitle ? escapeHtml(chatTitle) : "Random Coffee"
  const pairsBody = pairs.map((pair) => formatPair(pair)).join("\n")
  const leftoversBody = leftovers.map((participant) => formatStandalone(participant)).join("\n")
  const hasPairs = pairs.length > 0
  const hasLeftovers = leftovers.length > 0

  if (!hasPairs && !hasLeftovers) {
    return `Not enough participants for ${safeTitle} this week.`
  }

  if (!hasPairs && hasLeftovers) {
    return [
      `Not enough participants to make pairs for ${safeTitle} this week.`,
      "",
      "Signed up:",
      leftoversBody,
      "",
      "If you missed the poll but still want a meeting this week, please DM them."
    ].join("\n")
  }

  if (hasPairs && hasLeftovers) {
    return [
      `Pairs for ${safeTitle} are ready!`,
      "",
      "Find your match for this week below:",
      pairsBody,
      "",
      "No match this week:",
      leftoversBody,
      "If you missed the poll but still want a meeting this week, please DM them.",
      "",
      "DM your partner to agree on a convenient time and format ☕️"
    ].join("\n")
  }

  return [
    `Pairs for ${safeTitle} are ready!`,
    "",
    "Find your match for this week below:",
    pairsBody,
    "",
    "DM your partner to agree on a convenient time and format ☕️"
  ].join("\n")
}
