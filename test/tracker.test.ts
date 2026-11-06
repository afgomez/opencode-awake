import { describe, expect, test } from "bun:test"
import { SessionTracker } from "../src/tracker.ts"

const event = (type: string, data: Record<string, unknown>) => ({ type, data })

describe("SessionTracker", () => {
  test("tracks execution start and end", () => {
    const tracker = new SessionTracker()
    expect(tracker.apply(event("session.execution.started", { sessionID: "ses_a" }))).toBe(true)
    expect(tracker.apply(event("session.execution.started", { sessionID: "ses_b" }))).toBe(true)
    expect(tracker.apply(event("session.execution.started", { sessionID: "ses_a" }))).toBe(false)
    expect(tracker.size).toBe(2)

    expect(tracker.apply(event("session.execution.succeeded", { sessionID: "ses_a" }))).toBe(true)
    expect(tracker.apply(event("session.execution.interrupted", { sessionID: "ses_b", reason: "user" }))).toBe(true)
    expect(tracker.size).toBe(0)
  })

  test("follows session status", () => {
    const tracker = new SessionTracker()
    tracker.apply(event("session.status", { sessionID: "ses_a", status: { type: "busy" } }))
    tracker.apply(event("session.status", { sessionID: "ses_b", status: { type: "retry" } }))
    expect(tracker.ids()).toEqual(["ses_a", "ses_b"])

    tracker.apply(event("session.status", { sessionID: "ses_a", status: { type: "idle" } }))
    tracker.apply(event("session.idle", { sessionID: "ses_b" }))
    expect(tracker.size).toBe(0)
  })

  test("deleted sessions stop running", () => {
    const tracker = new SessionTracker()
    tracker.apply(event("session.execution.started", { sessionID: "ses_a" }))
    expect(tracker.apply(event("session.deleted", { sessionID: "ses_a" }))).toBe(true)
    expect(tracker.size).toBe(0)
  })

  test("ignores unrelated events", () => {
    const tracker = new SessionTracker()
    expect(tracker.apply({ type: "config.updated" })).toBe(false)
    expect(tracker.apply(event("session.renamed", { sessionID: "ses_a" }))).toBe(false)
    expect(tracker.size).toBe(0)
  })

  test("prunes silent sessions and refreshes active ones", () => {
    const tracker = new SessionTracker()
    tracker.apply(event("session.execution.started", { sessionID: "ses_a" }), 0)
    tracker.apply(event("session.execution.started", { sessionID: "ses_b" }), 0)
    tracker.apply(event("session.reasoning.delta", { sessionID: "ses_b" }), 900)

    expect(tracker.prune(1000, 1000)).toEqual(["ses_a"])
    expect(tracker.ids()).toEqual(["ses_b"])
  })
})
