import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { handleMessages } from "../../src/app/diagnostics.js"
import { ChatId, RngSeed } from "../../src/core/brand.js"
import type { BotState } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import { emptyChatState } from "../../src/core/state.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import type { ChatMemberStatus } from "../../src/shell/telegram.js"
import { makeMessageUpdate, makeParticipant, makeStateWithChat, makeTelegramStub } from "./test-utils.js"

const runStart = (params: {
  readonly state: BotState
  readonly update: IncomingUpdate
  readonly memberStatus?: ChatMemberStatus
}) =>
  Effect.gen(function*(_) {
    const { messageCalls, setMemberStatus, telegram } = makeTelegramStub()
    if (params.memberStatus) {
      setMemberStatus(params.memberStatus)
    }

    const next = yield* _(handleMessages(params.state, [params.update], telegram, "random_coffee_bot"))

    return {
      next,
      messageText: messageCalls[0]?.text ?? ""
    }
  })

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
})
