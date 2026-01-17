import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import type { ChatType } from "../../src/core/domain.js"
import { isGroupChat, normalizeCommand } from "../../src/core/telegram-commands.js"
import { alphaString } from "./property-helpers.js"

describe("telegram-commands", () => {
  it("normalizeCommand removes bot suffix and arguments", () => {
    fc.assert(
      fc.property(alphaString, alphaString, alphaString, (command, bot, arg) => {
        const text = `/${command}@${bot} ${arg}`
        expect(normalizeCommand(text)).toBe(`/${command}`)
      })
    )
  })

  it("normalizeCommand removes arguments without a bot suffix", () => {
    fc.assert(
      fc.property(alphaString, alphaString, (command, arg) => {
        const text = `/${command} ${arg}`
        expect(normalizeCommand(text)).toBe(`/${command}`)
      })
    )
  })

  it("isGroupChat returns true only for group chats", () => {
    fc.assert(
      fc.property(fc.constantFrom<ChatType>("private", "group", "supergroup"), (chatType) => {
        const expected = chatType === "group" || chatType === "supergroup"
        expect(isGroupChat(chatType)).toBe(expected)
      })
    )
  })
})
