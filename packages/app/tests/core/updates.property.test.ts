import { describe, expect, it } from "@effect/vitest"
import { Match } from "effect"
import fc from "fast-check"

import { ChatId, LocalDateString, MessageId, PollId, RngSeed } from "../../src/core/brand.js"
import type { BotState } from "../../src/core/domain.js"
import { emptyState } from "../../src/core/domain.js"
import { ensureChat, startPoll } from "../../src/core/state.js"
import type { IncomingUpdate } from "../../src/core/updates.js"
import { applyUpdates } from "../../src/core/updates.js"
import { alphaString, participant } from "./property-helpers.js"

const localDate = LocalDateString("2026-01-19")

const expectMissingChat = (state: BotState, chatId: ChatId): void => {
  expect(state.chats[chatId]).toBeUndefined()
}

const expectEmptyParticipants = (state: BotState, chatId: ChatId): void => {
  expect(Object.keys(state.chats[chatId]?.participants ?? {})).toHaveLength(0)
}

const expectParticipant = (
  state: BotState,
  chatId: ChatId,
  user: ReturnType<typeof participant>
): void => {
  expect(state.chats[chatId]?.participants[user.id.toString()]).toEqual(user)
}

const buildStateWithPoll = (chatId: ChatId, pollId: PollId): BotState => {
  const base = ensureChat(emptyState(RngSeed(1)), chatId)
  return startPoll(base, chatId, {
    pollId,
    messageId: MessageId(1),
    chatId,
    summaryDate: localDate,
    threadId: null
  })
}

const withParticipant = (
  state: BotState,
  chatId: ChatId,
  user: ReturnType<typeof participant>
): BotState => {
  const chat = state.chats[chatId]
  if (!chat) {
    return state
  }
  return {
    ...state,
    chats: {
      ...state.chats,
      [chatId]: {
        ...chat,
        participants: {
          ...chat.participants,
          [user.id.toString()]: user
        }
      }
    }
  }
}

const applyPollVoteUpdate = (
  state: BotState,
  pollId: PollId,
  participantValue: ReturnType<typeof participant> | undefined,
  optionIds: ReadonlyArray<number>,
  updateId: number
): BotState =>
  applyUpdates(state, [
    {
      updateId,
      pollVote: { pollId, participant: participantValue, optionIds }
    }
  ])

type ChatSeenScenario = {
  readonly chatType: "private" | "group" | "supergroup"
  readonly title?: string
  readonly expectedTitle: string | null
  readonly expectChat: boolean
}

const chatSeenScenarios: ReadonlyArray<ChatSeenScenario> = [
  { chatType: "private", title: "Private", expectedTitle: null, expectChat: false },
  { chatType: "supergroup", title: "Group", expectedTitle: "Group", expectChat: true },
  { chatType: "group", expectedTitle: null, expectChat: true }
]

type PollCase =
  | { readonly tag: "missing-chat"; readonly hasIndex: boolean; readonly updateId: number }
  | { readonly tag: "no-participant" }
  | { readonly tag: "add-participant" }
  | { readonly tag: "remove-participant" }

const pollCases: ReadonlyArray<PollCase> = [
  { tag: "missing-chat", hasIndex: false, updateId: 3 },
  { tag: "missing-chat", hasIndex: true, updateId: 10 },
  { tag: "no-participant" },
  { tag: "add-participant" },
  { tag: "remove-participant" }
]

const runPollCase = (
  pollCase: PollCase,
  chatId: ChatId,
  pollId: PollId,
  user: ReturnType<typeof participant>
): void => {
  Match.value(pollCase).pipe(
    Match.when({ tag: "missing-chat" }, (value) => {
      const base = value.hasIndex
        ? { ...emptyState(RngSeed(1)), pollIndex: { [pollId]: chatId } }
        : emptyState(RngSeed(1))
      const next = applyPollVoteUpdate(base, pollId, user, [0], value.updateId)
      expectMissingChat(next, chatId)
    }),
    Match.when({ tag: "no-participant" }, () => {
      const base = buildStateWithPoll(chatId, pollId)
      const next = applyPollVoteUpdate(base, pollId, undefined, [0], 4)
      expectEmptyParticipants(next, chatId)
    }),
    Match.when({ tag: "add-participant" }, () => {
      const base = buildStateWithPoll(chatId, pollId)
      const next = applyPollVoteUpdate(base, pollId, user, [0], 5)
      expectParticipant(next, chatId, user)
    }),
    Match.when({ tag: "remove-participant" }, () => {
      const base = withParticipant(buildStateWithPoll(chatId, pollId), chatId, user)
      const next = applyPollVoteUpdate(base, pollId, user, [1], 6)
      expectEmptyParticipants(next, chatId)
    }),
    Match.exhaustive
  )
}

describe("updates", () => {
  it("applyUpdates keeps updateOffset when no updates", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (seed) => {
        const state = { ...emptyState(RngSeed(seed)), updateOffset: 5 }
        const next = applyUpdates(state, [])
        expect(next.updateOffset).toBe(5)
      })
    )
  })

  it("applyUpdates handles chatSeen metadata", () => {
    fc.assert(
      fc.property(alphaString, fc.constantFrom(...chatSeenScenarios), (chatRaw, scenario) => {
        const chatId = ChatId(chatRaw)
        const update: IncomingUpdate = {
          updateId: 1,
          chatSeen: {
            chatId,
            chatType: scenario.chatType,
            chatTitle: scenario.title
          }
        }
        const next = applyUpdates(emptyState(RngSeed(1)), [update])
        if (!scenario.expectChat) {
          expect(next.chats[chatId]).toBeUndefined()
          return
        }
        expect(next.chats[chatId]).not.toBeUndefined()
        expect(next.chats[chatId]?.title).toBe(scenario.expectedTitle)
      })
    )
  })

  it("applyUpdates uses message metadata to set chat title", () => {
    fc.assert(
      fc.property(alphaString, (chatRaw) => {
        const chatId = ChatId(chatRaw)
        const update: IncomingUpdate = {
          updateId: 2,
          message: {
            chatId,
            chatType: "group",
            text: "/start",
            from: participant(1, "A"),
            chatTitle: "Message Chat"
          }
        }
        const next = applyUpdates(emptyState(RngSeed(1)), [update])
        expect(next.chats[chatId]?.title).toBe("Message Chat")
      })
    )
  })

  it("applyUpdates handles poll vote cases", () => {
    fc.assert(
      fc.property(alphaString, alphaString, fc.constantFrom(...pollCases), (chatRaw, pollRaw, pollCase) => {
        const chatId = ChatId(chatRaw)
        const pollId = PollId(pollRaw)
        const user = participant(99, "Z")
        runPollCase(pollCase, chatId, pollId, user)
      })
    )
  })
})
