import { Match } from "effect"

import type { ChatId, LocalDateString } from "./brand.js"
import type { Pairing, Participant } from "./domain.js"
import type { ScheduleDecision } from "./schedule.js"
import type { IncomingUpdate } from "./updates.js"

export type LeaderboardEntry = {
  readonly chatId: ChatId
  readonly title: string | null
  readonly members: number
  readonly username?: string | undefined
  readonly inviteLink?: string | undefined
}

export type DirectPairingMessage = {
  readonly counterparts: ReadonlyArray<Participant>
  readonly isOrganizer: boolean
  readonly chatTitle: string | null
  readonly chatInviteLink: string | null
  readonly summaryLink: string | null
}

// CHANGE: define poll option labels
// WHY: keep poll response text configurable in one place
// QUOTE(TZ): "Yes! 🤗"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall o in options: o != ""
// PURITY: CORE
// INVARIANT: options length = 2
// COMPLEXITY: O(1)/O(1)
export const pollOptions: ReadonlyArray<string> = ["Yes! 🤗", "Not this time 💁🏽‍♂️"]

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

const formatContactName = (participant: Participant): string =>
  participant.lastName
    ? `${participant.firstName} ${participant.lastName}`
    : participant.firstName

const formatContactHandle = (participant: Participant): string =>
  participant.username ? `@${participant.username}` : "None"

const formatContactLine = (participant: Participant): string =>
  `${formatContactName(participant)} (${formatContactHandle(participant)})`

const formatOrganizerHandles = (counterparts: ReadonlyArray<Participant>): string => {
  if (counterparts.length === 0) {
    return "None"
  }
  return counterparts
    .map((participant) =>
      participant.username ? `@${participant.username}` : `user-${participant.id}`
    )
    .join(", ")
}

const formatOrganizerNoun = (counterparts: ReadonlyArray<Participant>): string =>
  counterparts.length === 1 ? "собеседнику" : "собеседникам"

const formatGroupLabel = (
  title: string | null,
  inviteLink: string | null,
  summaryLink: string | null
): string => {
  const normalizedLink = normalizeInviteLink(inviteLink ?? undefined)
  const label = title ? escapeHtml(title) : "без названия"
  const link = summaryLink ?? normalizedLink
  if (!link) {
    return title ? `«${label}»` : "(без названия)"
  }
  const anchorText = title ? escapeHtml(title) : "группа"
  return `«<a href="${escapeHtml(link)}">${anchorText}</a>»`
}

const formatGroupTitle = (
  title: string | null,
  inviteLink: string | null,
  summaryLink: string | null
): string => `Группа: ${formatGroupLabel(title, inviteLink, summaryLink)}`

const formatSummaryLinkLine = (summaryLink: string | null): string | null =>
  summaryLink
    ? `Итоги недели: <a href="${escapeHtml(summaryLink)}">ссылка</a>`
    : null

const formatDays = (days: number): string => (days === 1 ? "1 day" : `${days} days`)

const formatMembersCount = (members: number): string => members === 1 ? "1 member" : `${members} members`

const normalizeUsername = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  return /^\w+$/u.test(trimmed) ? trimmed : null
}

const normalizeInviteLink = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  return /^https?:\/\//.test(trimmed) ? trimmed : null
}

const formatLeaderboardLink = (entry: LeaderboardEntry): string | null => {
  const username = normalizeUsername(entry.username)
  if (username) {
    const url = `https://t.me/${username}`
    return `<a href="${url}">Join</a>`
  }
  const invite = normalizeInviteLink(entry.inviteLink)
  return invite ? `<a href="${escapeHtml(invite)}">Join</a>` : null
}

const leaderboardTitle = (entry: LeaderboardEntry): string => entry.title ?? `Chat ${entry.chatId}`

const sortLeaderboardEntries = (
  entries: ReadonlyArray<LeaderboardEntry>
): ReadonlyArray<LeaderboardEntry> => {
  const sorted = [...entries]
  sorted.sort((left, right) => {
    const byMembers = right.members - left.members
    if (byMembers !== 0) {
      return byMembers
    }
    return leaderboardTitle(left).localeCompare(leaderboardTitle(right), "en")
  })
  return sorted
}

const formatLeaderboardLine = (
  entry: LeaderboardEntry,
  index: number
): string => {
  const title = escapeHtml(leaderboardTitle(entry))
  const link = formatLeaderboardLink(entry)
  const suffix = link ? ` (${link})` : " (link unavailable)"
  return `${index + 1}. ${title} — ${formatMembersCount(entry.members)}${suffix}`
}

// CHANGE: format the admin-only command reply
// WHY: centralize user-facing command text in a single module
// QUOTE(TZ): "This command is available to chat admins only."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replyAdminOnly = (): string => "This command is available to chat admins only."

// CHANGE: format the /settopic reply for main chat
// WHY: centralize user-facing command text in a single module
// QUOTE(TZ): "Ok. Polls will be posted in the main chat."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replySetTopicMain = (): string => "Ok. Polls will be posted in the main chat."

// CHANGE: format the /settopic reply for the current topic
// WHY: centralize user-facing command text in a single module
// QUOTE(TZ): "Ok. Polls will be posted in this topic."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replySetTopicThread = (): string => "Ok. Polls will be posted in this topic."

// CHANGE: format the /setlink success reply
// WHY: confirm that the invite link was stored
// QUOTE(TZ): "должна быть ссылка на группу"
// REF: user-2026-01-18-leaderboard-link
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replySetLinkSaved = (): string => "Invite link saved."

// CHANGE: format the /setlink invalid input reply
// WHY: guide users to provide a valid Telegram link
// QUOTE(TZ): "должна быть ссылка на группу"
// REF: user-2026-01-18-leaderboard-link
// SOURCE: n/a
// FORMAT THEOREM: forall _: message contains example
// PURITY: CORE
// INVARIANT: reply includes example usage
// COMPLEXITY: O(1)/O(1)
export const replySetLinkInvalid = (): string => "Invalid link. Use: /setlink https://t.me/yourgroup"

// CHANGE: format the reply when a poll is already active
// WHY: keep user-facing command responses centralized
// QUOTE(TZ): "A poll is already active. Use /summary to close it."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replyPollAlreadyActive = (): string => "A poll is already active. Use /summary to close it."

// CHANGE: format the reply when a poll is already active with a summary date
// WHY: keep user-facing command responses centralized
// QUOTE(TZ): "A poll is already active. Results on YYYY-MM-DD."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall d: message contains d
// PURITY: CORE
// INVARIANT: summary date is preserved
// COMPLEXITY: O(1)/O(1)
export const replyPollAlreadyActiveWithDate = (
  summaryDate: LocalDateString
): string => `A poll is already active. Results on ${summaryDate}.`

// CHANGE: format the reply when the poll window is open
// WHY: keep user-facing command responses centralized
// QUOTE(TZ): "Poll window is open now. You can start a poll with /poll."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replyPollWindowOpen = (): string => "Poll window is open now. You can start a poll with /poll."

// CHANGE: format the reply with the next poll window date
// WHY: keep user-facing command responses centralized
// QUOTE(TZ): "Next poll window starts in N days (YYYY-MM-DD)."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall n,d: message contains n,d
// PURITY: CORE
// INVARIANT: days and date are preserved
// COMPLEXITY: O(1)/O(1)
export const replyNextPollWindow = (
  daysUntilStart: number,
  startDate: LocalDateString
): string => `Next poll window starts in ${formatDays(daysUntilStart)} (${startDate}).`

// CHANGE: format the reply when no chats are registered for a leaderboard
// WHY: explain why the leaderboard cannot be computed yet
// QUOTE(TZ): "список групп в которых используется бот"
// REF: user-2026-01-18-leaderboard
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const replyLeaderboardEmpty = (): string => "No registered group chats yet."

// CHANGE: format the reply when leaderboard data cannot be fetched
// WHY: disclose that some chats were skipped due to missing access
// QUOTE(TZ): "список групп в которых используется бот"
// REF: user-2026-01-18-leaderboard
// SOURCE: n/a
// FORMAT THEOREM: forall n: message contains n
// PURITY: CORE
// INVARIANT: skipped count is preserved
// COMPLEXITY: O(1)/O(1)
export const replyLeaderboardUnavailable = (skipped: number): string =>
  `Leaderboard is unavailable right now. Skipped ${skipped} chats due to missing access.`

// CHANGE: format a leaderboard message with group member counts
// WHY: let users discover communities by size
// QUOTE(TZ): "Типо Название, колво участников"
// REF: user-2026-01-18-leaderboard
// SOURCE: n/a
// FORMAT THEOREM: forall es: lines(format(es)) = |es| + header + note
// PURITY: CORE
// INVARIANT: entries are sorted by member count descending
// COMPLEXITY: O(n log n)/O(n)
export const formatLeaderboard = (
  entries: ReadonlyArray<LeaderboardEntry>,
  skipped: number
): string => {
  const sorted = sortLeaderboardEntries(entries)
  const header = "Group leaderboard (members):"
  const lines = sorted.map((entry, index) => formatLeaderboardLine(entry, index))
  const note = skipped > 0
    ? `Skipped ${skipped} chats due to missing access.`
    : null
  return [
    header,
    ...lines,
    ...(note ? [note] : [])
  ].join("\n")
}

// CHANGE: format the private /start reply message
// WHY: greet users and explain private chat capabilities
// QUOTE(TZ): "Если человек пишет боту в личку \"/start\" то он получает такое сообщение"
// REF: user-2026-01-19-private-start
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: reply contains onboarding steps
// COMPLEXITY: O(1)/O(1)
export const formatPrivateStartReply = (): string =>
  [
    "Привет!👋",
    "Я Random Coffee бот для групповых чатов 🤖",
    "",
    "Здесь я буду дублировать для тебя всех партнеров, подобранных в каждой группе, где ты подтвердил участие во встречах",
    "",
    "Также тут ты можешь заполнить и отредактировать свой профиль, чтобы я мог подключить умный алгоритм и лучше подбирать тебе пары. Если хочешь повысить точность подбора, жми кнопку \"Заполнить профиль\" ниже 👇",
    "",
    "А если хочешь добавить бот в свою группу, жми \"Я организатор\".  Подскажу, как это сделать."
  ].join("\n")

// CHANGE: label for the private "fill profile" button
// WHY: keep button labels centralized for reuse
// QUOTE(TZ): "кнопки"
// REF: user-2026-01-19-private-start
// SOURCE: n/a
// FORMAT THEOREM: forall _: label != ""
// PURITY: CORE
// INVARIANT: label is stable
// COMPLEXITY: O(1)/O(1)
export const privateStartProfileLabel = (): string => "Заполнить профиль"

// CHANGE: legacy label for the private profile button
// WHY: accept older button text sent before rename
// QUOTE(TZ): "Заполнить анкету"
// REF: user-2026-01-19-profile-flow
// SOURCE: n/a
// FORMAT THEOREM: forall _: label != ""
// PURITY: CORE
// INVARIANT: label is stable
// COMPLEXITY: O(1)/O(1)
export const privateStartProfileAliasLabel = (): string => "Заполнить анкету"

// CHANGE: label for the private "organizer" button
// WHY: keep button labels centralized for reuse
// QUOTE(TZ): "Я организатор"
// REF: user-2026-01-19-private-start
// SOURCE: n/a
// FORMAT THEOREM: forall _: label != ""
// PURITY: CORE
// INVARIANT: label is stable
// COMPLEXITY: O(1)/O(1)
export const privateStartOrganizerLabel = (): string => "Я организатор"

// CHANGE: define button labels for private /start
// WHY: keep button text centralized alongside other user-facing strings
// QUOTE(TZ): "кнопки"
// REF: user-2026-01-19-private-start
// SOURCE: n/a
// FORMAT THEOREM: forall _: rows = 2
// PURITY: CORE
// INVARIANT: each row contains exactly one label
// COMPLEXITY: O(1)/O(1)
export const privateStartButtons = (): ReadonlyArray<ReadonlyArray<string>> => [
  [privateStartProfileLabel()],
  [privateStartOrganizerLabel()]
]

// CHANGE: format the profile flow intro message
// WHY: explain next steps before opening the profile widget
// QUOTE(TZ): "Отлично! Вот, какие дальнейшие шаги тебя ждут"
// REF: user-2026-01-19-profile-flow
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: steps are ordered
// COMPLEXITY: O(1)/O(1)
export const formatProfileIntroReply = (): string =>
  [
    "Отлично! Вот, какие дальнейшие шаги тебя ждут:",
    "",
    "1️⃣ Заполнение анкеты о себе",
    "2️⃣ По желанию Предвыбор интересных собеседников",
    "",
    "А в ближайший понедельник бот подберет тебе пару среди всех участников."
  ].join("\n")

// CHANGE: format the profile widget instruction message
// WHY: guide users to fill and submit the profile
// QUOTE(TZ): "Спасибо! \nВремя заполнить анкету"
// REF: user-2026-01-19-profile-flow
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: contains next step instructions
// COMPLEXITY: O(1)/O(1)
export const formatProfileWidgetReply = (): string =>
  [
    "Спасибо! ",
    "Время заполнить анкету 🪄",
    "",
    "Я буду присылать её твоим собеседникам каждую неделю.",
    "",
    "Скажу честно: лучше заполнить её подробно. Анкета — это первое впечатление о тебе. И с пустой или плохо заполненной анкетой вероятность встреч может снизиться ☝️",
    "Заполни анкету в этом чате — просто напиши о себе текстом.",
    "",
    "Изменить анкету можно, снова нажав кнопку «Заполнить профиль»."
  ].join("\n")

// CHANGE: format the profile saved confirmation reply
// WHY: confirm that the bot stored the profile text
// QUOTE(TZ): "Почему он не сохранил информацию об профиле?"
// REF: user-2026-01-21-profile-text
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: reply is a single confirmation block
// COMPLEXITY: O(1)/O(1)
export const formatProfileSavedReply = (): string =>
  [
    "Готово! Я сохранил твою анкету.",
    "Если захочешь изменить — нажми кнопку ниже.",
    "",
    "Если тебя устраивает твой профиль — можешь присоединяться к Random Coffee.",
    "Напиши /leaderboard, чтобы узнать активные чаты для участия."
  ].join("\n")

// CHANGE: label for the profile redo button after saving
// WHY: surface a clear action to re-open profile editing
// QUOTE(TZ): "Вот тут должна была появится кнопка \"Заполнить профиль заново\""
// REF: user-2026-01-22-profile-redo-button
// SOURCE: n/a
// FORMAT THEOREM: forall _: label != ""
// PURITY: CORE
// INVARIANT: label is stable
// COMPLEXITY: O(1)/O(1)
export const profileRedoLabel = (): string => "Заполнить профиль заново"

// CHANGE: format the organizer guide reply for private chats
// WHY: explain how to add the bot to a group
// QUOTE(TZ): "гайд как добавить бота в Группу"
// REF: user-2026-01-19-organizer-guide
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: reply lists steps in order
// COMPLEXITY: O(1)/O(1)
export const formatOrganizerGuideReply = (): string =>
  [
    "Как добавить бота в группу:",
    "1) Открой группу → Добавить участника → найди этого бота и добавь его.",
    "2) Сделай бота администратором и включи права отправки сообщений и опросов.",
    "3) Напиши в группе /start, чтобы бот начал работу.",
    "",
    "Админские команды в группе:",
    "/settopic — выбрать топик для опросов (или основной чат).",
    "/poll — запустить опрос прямо сейчас.",
    "/summary — завершить опрос и подвести итог.",
    "/nextpoll — узнать, когда следующий опрос.",
    "/setlink ссылка — добавить ссылку на группу для /leaderboard.",
    "/leaderboard — показать список групп по размеру.",
    "",
    "Если что-то не выходит — напиши сюда."
  ].join("\n")

// CHANGE: format the /start reply message
// WHY: keep user-facing bot text centralized
// QUOTE(TZ): "Random Coffee bot is active"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: reply has three lines
// COMPLEXITY: O(1)/O(1)
export const formatStartReply = (): string =>
  [
    "Random Coffee bot is active ✅",
    "Polls: Friday/Saturday. Results: Monday.",
    "Make sure the bot can send polls in this chat."
  ].join("\n")

// CHANGE: format the direct pairing message for private chats
// WHY: keep weekly pair notifications consistent across DMs
// QUOTE(TZ): "Твоя пара на эту неделю"
// REF: user-2026-01-20-direct-dm
// SOURCE: n/a
// FORMAT THEOREM: forall c in counterparts: message contains c
// PURITY: CORE
// INVARIANT: organizer block appears only when isOrganizer = true
// COMPLEXITY: O(n)/O(n)
export const formatDirectPairingMessage = (
  context: DirectPairingMessage
): string => {
  const summaryLine = formatSummaryLinkLine(context.summaryLink)
  if (context.counterparts.length === 0) {
    return [
      `На этой неделе тебе не досталась пара в группе ${
        formatGroupLabel(context.chatTitle, context.chatInviteLink, null)
      }.`,
      "Возможно, кто-то не успел проголосовать и напишет позже.",
      ...(summaryLine ? [summaryLine] : []),
      "",
      "Посмотреть и поменять фото или данные своего профиля ты можешь в /help"
    ].join("\n")
  }

  const counterpartLines = context.counterparts.map((participant) => formatContactLine(participant))
  const organizerBlock = context.isOrganizer
    ? [
      "‼️  Ты рандомно выбран организатором этой встречи",
      "Это значит, что на этой неделе ты пишешь первым! 😉",
      `Напиши ${formatOrganizerNoun(context.counterparts)} в Телеграм - ${formatOrganizerHandles(context.counterparts)} - сразу, чтобы не забыть.`,
      ""
    ]
    : []

  return [
    "Знакомься! 🎩",
    formatGroupTitle(context.chatTitle, context.chatInviteLink, null),
    ...(summaryLine ? [summaryLine] : []),
    "Твоя пара на эту неделю:",
    ...counterpartLines,
    "",
    "Чем занимается: None",
    "Зацепки для начала разговора: None",
    "",
    ...organizerBlock,
    "Посмотреть и поменять фото или данные своего профиля ты можешь в /help",
    "",
    "➪ Шпаргалка перед встречей"
  ].join("\n")
}

// CHANGE: format the "no updates" Telegram log line
// WHY: centralize log text
// QUOTE(TZ): "Telegram: no updates"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const logTelegramNoUpdates = (): string => "Telegram: no updates"

// CHANGE: format the Telegram updates count log line
// WHY: centralize log text
// QUOTE(TZ): "Telegram: received updates N"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall n: message contains n
// PURITY: CORE
// INVARIANT: count is preserved
// COMPLEXITY: O(1)/O(1)
export const logTelegramReceivedUpdates = (count: number): string => `Telegram: received updates ${count}`

// CHANGE: format a single Telegram update log line
// WHY: centralize log text
// QUOTE(TZ): "Telegram: <details>"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall s: message contains s
// PURITY: CORE
// INVARIANT: detail is preserved
// COMPLEXITY: O(1)/O(1)
export const logTelegramUpdate = (detail: string): string => `Telegram: ${detail}`

// CHANGE: format the state snapshot log line
// WHY: centralize log text
// QUOTE(TZ): "State: chats=X pollIndex=Y updateOffset=Z"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall x,y,z: message contains x,y,z
// PURITY: CORE
// INVARIANT: counts are preserved
// COMPLEXITY: O(1)/O(1)
export const logStateSnapshot = (
  chatsCount: number,
  pollIndexCount: number,
  updateOffset: number
): string => `State: chats=${chatsCount} pollIndex=${pollIndexCount} updateOffset=${updateOffset}`

// CHANGE: format the schedule decision log line
// WHY: centralize log text
// QUOTE(TZ): "Schedule: chat=... decision=..."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall d: message contains d
// PURITY: CORE
// INVARIANT: decision text is preserved
// COMPLEXITY: O(1)/O(1)
export const logScheduleDecision = (
  chatId: ChatId,
  decision: ScheduleDecision
): string => `Schedule: chat=${chatId} decision=${formatDecision(decision)}`

const formatDecision = (decision: ScheduleDecision): string =>
  Match.value(decision).pipe(
    Match.when({ kind: "createPoll" }, (value) => `createPoll summary=${value.summaryDate}`),
    Match.when({ kind: "summarize" }, (value) => `summarize summary=${value.summaryDate}`),
    Match.when({ kind: "noop" }, () => "noop"),
    Match.exhaustive
  )

// CHANGE: format the "no registered group chats" warning
// WHY: centralize log text
// QUOTE(TZ): "No registered group chats. Waiting for updates from groups."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: message is stable
// COMPLEXITY: O(1)/O(1)
export const logNoRegisteredGroupChats = (): string => "No registered group chats. Waiting for updates from groups."

// CHANGE: format the poll-created log line
// WHY: centralize log text
// QUOTE(TZ): "Poll created for chat X with summary date Y"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall c,d: message contains c,d
// PURITY: CORE
// INVARIANT: chat id and date are preserved
// COMPLEXITY: O(1)/O(1)
export const logPollCreated = (
  chatId: ChatId,
  summaryDate: LocalDateString
): string => `Poll created for chat ${chatId} with summary date ${summaryDate}`

// CHANGE: format the poll pin failure log line
// WHY: report when the bot cannot pin the poll message
// QUOTE(TZ): "кидал в закреп свой опросник всегда"
// REF: user-2026-01-20-pin-poll
// SOURCE: n/a
// FORMAT THEOREM: forall c: message contains c
// PURITY: CORE
// INVARIANT: chat id is preserved
// COMPLEXITY: O(1)/O(1)
export const logPollPinFailed = (chatId: ChatId): string => `Poll pin failed for chat ${chatId}`

// CHANGE: format the summary pin failure log line
// WHY: report when the bot cannot pin the summary message
// QUOTE(TZ): "итоги тоже есть смысл кинуть в закреп"
// REF: user-2026-01-20-pin-summary
// SOURCE: n/a
// FORMAT THEOREM: forall c: message contains c
// PURITY: CORE
// INVARIANT: chat id is preserved
// COMPLEXITY: O(1)/O(1)
export const logSummaryPinFailed = (chatId: ChatId): string =>
  `Summary pin failed for chat ${chatId}`

// CHANGE: format the direct message failure log line
// WHY: record when the bot cannot DM a participant
// QUOTE(TZ): "если у бота есть чат с человеком"
// REF: user-2026-01-20-direct-dm
// SOURCE: n/a
// FORMAT THEOREM: forall c: message contains c
// PURITY: CORE
// INVARIANT: chat id is preserved
// COMPLEXITY: O(1)/O(1)
export const logDirectMessageFailed = (chatId: ChatId): string =>
  `Direct message failed for chat ${chatId}`

// CHANGE: format the poll-closed log line
// WHY: centralize log text
// QUOTE(TZ): "Poll was already closed for chat X"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall c: message contains c
// PURITY: CORE
// INVARIANT: chat id is preserved
// COMPLEXITY: O(1)/O(1)
export const logPollAlreadyClosed = (chatId: ChatId): string => `Poll was already closed for chat ${chatId}`

// CHANGE: format the summary sent log line
// WHY: centralize log text
// QUOTE(TZ): "Summary pairs sent for chat X"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall c: message contains c
// PURITY: CORE
// INVARIANT: chat id is preserved
// COMPLEXITY: O(1)/O(1)
export const logSummaryPairsSent = (chatId: ChatId): string => `Summary pairs sent for chat ${chatId}`

// CHANGE: format a participant log label
// WHY: centralize log text
// QUOTE(TZ): "participant id=... username=... name=..."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall p: message contains p.id
// PURITY: CORE
// INVARIANT: participant info is preserved
// COMPLEXITY: O(1)/O(1)
export const formatParticipantLog = (participant: Participant | undefined): string => {
  if (!participant) {
    return "participant=none"
  }
  const username = participant.username ? `@${participant.username}` : "-"
  const name = participant.lastName
    ? `${participant.firstName} ${participant.lastName}`
    : participant.firstName
  return `participant id=${participant.id} username=${username} name="${name}"`
}

// CHANGE: format a Telegram update log detail
// WHY: centralize log text
// QUOTE(TZ): "updateId=... | chatSeen ... | pollVote ... | message ..."
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall u: message contains u.updateId
// PURITY: CORE
// INVARIANT: update details are preserved
// COMPLEXITY: O(n)/O(n)
export const formatUpdateLog = (update: IncomingUpdate): string => {
  const parts: Array<string> = [`updateId=${update.updateId}`]
  if (update.chatSeen) {
    parts.push(
      `chatSeen chatId=${update.chatSeen.chatId} type=${update.chatSeen.chatType}`
    )
  }
  if (update.pollVote) {
    const options = `[${update.pollVote.optionIds.join(",")}]`
    parts.push(
      `pollVote pollId=${update.pollVote.pollId} ${
        formatParticipantLog(update.pollVote.participant)
      } options=${options}`
    )
  }
  if (update.message) {
    parts.push(
      `message chatId=${update.message.chatId} type=${update.message.chatType} text="${update.message.text}"`
    )
  }
  if (update.callbackQuery) {
    parts.push(
      `callback chatId=${update.callbackQuery.chatId} type=${update.callbackQuery.chatType} data="${update.callbackQuery.data}"`
    )
  }
  return parts.join(" | ")
}

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

// CHANGE: format a notice when a poll was already closed and no results exist
// WHY: explain manual summary when the poll message is missing
// QUOTE(TZ): "Скажи что он опросник уже был закрыт и итогов нету"
// REF: user-2026-01-16-stop-poll-closed
// SOURCE: n/a
// FORMAT THEOREM: forall _: message != ""
// PURITY: CORE
// INVARIANT: output is plain text safe for HTML parse mode
// COMPLEXITY: O(1)/O(1)
export const formatPollClosedNoResults = (): string => "The poll was already closed, so there are no results."

// CHANGE: centralize Telegram stopPoll closed message fragments
// WHY: keep external error message matching configurable in one place
// QUOTE(TZ): "poll has already been closed"
// REF: user-2026-01-16-messages
// SOURCE: n/a
// FORMAT THEOREM: forall m: fragment(m) != ""
// PURITY: CORE
// INVARIANT: fragments are lowercase
// COMPLEXITY: O(1)/O(1)
export const stopPollClosedMessageFragments: ReadonlyArray<string> = [
  "poll has already been closed",
  "poll to stop not found"
]

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
