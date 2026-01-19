import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { handleCommands } from "../../src/app/commands.js"
import { ChatId, RngSeed } from "../../src/core/brand.js"
import { emptyState } from "../../src/core/domain.js"
import { replyLeaderboardEmpty, replySetLinkInvalid, replySetLinkSaved } from "../../src/core/text.js"
import { makeMessageUpdate, makeParticipant, makeStateStoreStub, makeTelegramStub } from "./test-utils.js"

const runCommand = (params: {
  readonly chatId: ChatId
  readonly updateId: number
  readonly chatType: "private" | "supergroup"
  readonly memberName: string
  readonly memberId: number
  readonly text: string
  readonly memberStatus?: "member" | "administrator"
  readonly seed: number
}) =>
  Effect.gen(function*(_) {
    const user = makeParticipant(params.memberId, params.memberName)
    const update = makeMessageUpdate({
      updateId: params.updateId,
      chatId: params.chatId,
      text: params.text,
      from: user,
      chatType: params.chatType
    })
    const state = emptyState(RngSeed(params.seed))
    const { messageCalls, setMemberStatus, telegram } = makeTelegramStub()
    if (params.memberStatus) {
      setMemberStatus(params.memberStatus)
    }
    const { setCalls, stateStore } = makeStateStoreStub(state)
    yield* _(
      handleCommands({
        state,
        updates: [update],
        telegram,
        stateStore,
        timeZone: "UTC"
      })
    )
    return { messageCalls, setCalls }
  })

const expectEmptyLeaderboardReply = (messageCalls: ReturnType<typeof makeTelegramStub>["messageCalls"]): void => {
  expect(messageCalls.length).toBe(1)
  expect(messageCalls[0]?.text).toBe(replyLeaderboardEmpty())
}

describe("leaderboard command", () => {
  it.effect("responds in private chats", () =>
    Effect.gen(function*(_) {
      const { messageCalls } = yield* _(
        runCommand({
          chatId: ChatId("123"),
          updateId: 42,
          chatType: "private",
          memberName: "User",
          memberId: 9,
          text: "/leaderboard",
          seed: 9
        })
      )
      expectEmptyLeaderboardReply(messageCalls)
    }))

  it.effect("responds in group chats without admin rights", () =>
    Effect.gen(function*(_) {
      const { messageCalls } = yield* _(
        runCommand({
          chatId: ChatId("-1000"),
          updateId: 43,
          chatType: "supergroup",
          memberName: "Member",
          memberId: 10,
          text: "/leaderboard",
          memberStatus: "member",
          seed: 10
        })
      )
      expectEmptyLeaderboardReply(messageCalls)
    }))

  it.effect("stores a valid invite link", () =>
    Effect.gen(function*(_) {
      const { messageCalls, setCalls } = yield* _(
        runCommand({
          chatId: ChatId("-2000"),
          updateId: 44,
          chatType: "supergroup",
          memberName: "Admin",
          memberId: 1,
          text: "/setlink https://t.me/test_group",
          seed: 11
        })
      )
      expect(setCalls.length).toBe(1)
      expect(setCalls[0]?.chats[ChatId("-2000")]?.inviteLink).toBe("https://t.me/test_group")
      expect(messageCalls[0]?.text).toBe(replySetLinkSaved())
    }))

  it.effect("rejects invalid links", () =>
    Effect.gen(function*(_) {
      const { messageCalls, setCalls } = yield* _(
        runCommand({
          chatId: ChatId("-2001"),
          updateId: 45,
          chatType: "supergroup",
          memberName: "Admin",
          memberId: 2,
          text: "/setlink not-a-link",
          seed: 12
        })
      )
      expect(setCalls.length).toBe(0)
      expect(messageCalls[0]?.text).toBe(replySetLinkInvalid())
    }))
})
