import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { handleMessages } from "../../src/app/diagnostics.js"
import { ChatId, RngSeed } from "../../src/core/brand.js"
import type { BotState } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import { emptyChatState } from "../../src/core/state.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import type { ChatMemberStatus, MessageKeyboard } from "../../src/shell/telegram.js"
import type { MessageCall } from "./test-utils.js"
import {
  makeCallbackUpdate,
  makeMessageUpdate,
  makeParticipant,
  makeStateWithChat,
  makeTelegramStub
} from "./test-utils.js"

const runStart = (params: {
  readonly state: BotState
  readonly update: IncomingUpdate
  readonly memberStatus?: ChatMemberStatus
}) =>
  Effect.gen(function*(_) {
    const { messageCalls, messageWithKeyboardCalls, setMemberStatus, telegram } = makeTelegramStub()
    if (params.memberStatus) {
      setMemberStatus(params.memberStatus)
    }

    const next = yield* _(
      handleMessages(params.state, [params.update], telegram, "random_coffee_bot")
    )

    return {
      next,
      messageText: messageCalls[0]?.text ?? "",
      messageCalls,
      messageWithKeyboardCalls
    }
  })

type KeyboardButtonValue = string | { readonly text?: string | undefined } | null | undefined

const resolveButtonText = (value: KeyboardButtonValue): string | undefined =>
  typeof value === "string" ? value : value?.text

const resolveKeyboardRows = (keyboard: MessageKeyboard): ReadonlyArray<ReadonlyArray<KeyboardButtonValue>> =>
  "inline_keyboard" in keyboard ? keyboard.inline_keyboard : keyboard.keyboard

const runProfileCallback = (params: {
  readonly updateId: number
  readonly chatId: ChatId
  readonly data: string
  readonly seed: number
}) =>
  Effect.gen(function*(_) {
    const update = makeCallbackUpdate({
      updateId: params.updateId,
      chatId: params.chatId,
      data: params.data
    })
    const base = emptyState(RngSeed(params.seed))

    return yield* _(
      runStart({
        state: base,
        update
      })
    )
  })

const runCallbackText = (params: {
  readonly update: IncomingUpdate
  readonly seed: number
}): Effect.Effect<string> =>
  Effect.gen(function*(_) {
    const base = emptyState(RngSeed(params.seed))
    const { messageCalls } = yield* _(
      runStart({
        state: base,
        update: params.update
      })
    )
    return messageCalls[0]?.text ?? ""
  })

const expectProfileIntro = (messageCalls: ReadonlyArray<MessageCall>): void => {
  const intro = messageCalls[0]?.text ?? ""
  expect(intro.startsWith("Отлично! Вот, какие дальнейшие шаги тебя ждут:")).toBe(true)
}

const expectProfileWidget = (messageCalls: ReadonlyArray<MessageCall>): void => {
  const widget = messageCalls[1]
  expect(widget?.text.startsWith("Спасибо! ")).toBe(true)
}

describe("diagnostics", () => {
  it.effect("/start updates thread id for admins", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-800")
      const user = makeParticipant(10, "Admin")
      const update = makeMessageUpdate({
        updateId: 1,
        chatId,
        text: "/start",
        from: user,
        threadId: 777
      })
      const base = emptyState(RngSeed(10))

      const { messageText, next } = yield* _(
        runStart({
          state: base,
          update
        })
      )

      expect(messageText.startsWith("Random Coffee bot is active")).toBe(true)
      expect(next.chats[chatId]?.threadId).toBe(777)
    }))

  it.effect("/start denies non-admin users", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("-801")
      const user = makeParticipant(11, "Member")
      const update = makeMessageUpdate({
        updateId: 2,
        chatId,
        text: "/start",
        from: user,
        threadId: 999
      })
      const chat = { ...emptyChatState(RngSeed(11)), threadId: 123 }
      const base = makeStateWithChat(chatId, chat, RngSeed(11))

      const { messageText, next } = yield* _(
        runStart({
          state: base,
          update,
          memberStatus: "member"
        })
      )

      expect(messageText).toBe("This command is available to chat admins only.")
      expect(next.chats[chatId]?.threadId).toBe(123)
    }))

  it.effect("/start in private chat sends onboarding message with buttons", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("2001")
      const user = makeParticipant(42, "Private")
      const update = makeMessageUpdate({
        updateId: 3,
        chatId,
        text: "/start",
        from: user,
        chatType: "private"
      })
      const base = emptyState(RngSeed(12))

      const { messageWithKeyboardCalls } = yield* _(
        runStart({
          state: base,
          update
        })
      )

      const call = messageWithKeyboardCalls[0]
      expect(call?.text.startsWith("Привет!👋")).toBe(true)
      const rows = call?.keyboard ? resolveKeyboardRows(call.keyboard) : []
      expect(resolveButtonText(rows[0]?.[0])).toBe("Заполнить профиль")
      expect(resolveButtonText(rows[1]?.[0])).toBe("Я организатор")
    }))

  it.effect("callback buttons send private replies", () =>
    Effect.gen(function*(_) {
      const cases = [
        {
          updateId: 4,
          chatId: ChatId("2002"),
          data: "Я организатор",
          seed: 13,
          assert: (text: string) => {
            expect(text.startsWith("Как добавить бота в группу:")).toBe(true)
            expect(text.includes("/setlink")).toBe(true)
            expect(text.includes("<")).toBe(false)
          }
        }
      ]

      for (const item of cases) {
        const text = yield* _(
          runCallbackText({
            update: makeCallbackUpdate({
              updateId: item.updateId,
              chatId: item.chatId,
              data: item.data
            }),
            seed: item.seed
          })
        )
        item.assert(text)
      }
    }))

  it.effect("private profile text is stored only after profile flow", () =>
    Effect.gen(function*(_) {
      const chatId = ChatId("2006")
      const user = makeParticipant(99, "Profile")
      const base = emptyState(RngSeed(17))

      const { next: afterFlow } = yield* _(
        runStart({
          state: base,
          update: makeCallbackUpdate({
            updateId: 8,
            chatId,
            data: "Заполнить профиль"
          })
        })
      )

      const { messageCalls, messageWithKeyboardCalls, next } = yield* _(
        runStart({
          state: afterFlow,
          update: makeMessageUpdate({
            updateId: 9,
            chatId,
            text: "Привет",
            from: user,
            chatType: "private"
          })
        })
      )

      expect(next.profiles[user.id.toString()]?.text).toBe("Привет")
      expect(messageCalls.length).toBe(0)
      const savedCall = messageWithKeyboardCalls[0]
      expect(savedCall?.text.startsWith("Готово!")).toBe(true)
      const rows = savedCall?.keyboard ? resolveKeyboardRows(savedCall.keyboard) : []
      expect(resolveButtonText(rows[0]?.[0])).toBe("Заполнить профиль заново")
    }))

  it.effect("profile button callback sends profile flow messages", () =>
    Effect.gen(function*(_) {
      const { messageCalls, messageWithKeyboardCalls } = yield* _(
        runProfileCallback({
          updateId: 5,
          chatId: ChatId("2003"),
          data: "Заполнить профиль",
          seed: 14
        })
      )

      expectProfileIntro(messageCalls)
      expectProfileWidget(messageCalls)
      expect(messageWithKeyboardCalls.length).toBe(0)
    }))

  it.effect("legacy profile label callback is accepted", () =>
    Effect.gen(function*(_) {
      const { messageCalls, messageWithKeyboardCalls } = yield* _(
        runProfileCallback({
          updateId: 6,
          chatId: ChatId("2004"),
          data: "Заполнить анкету",
          seed: 15
        })
      )

      expectProfileIntro(messageCalls)
      expectProfileWidget(messageCalls)
      expect(messageWithKeyboardCalls.length).toBe(0)
    }))
})
