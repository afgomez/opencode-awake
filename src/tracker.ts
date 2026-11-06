export interface SessionEvent {
  readonly type: string
  readonly data?: unknown
}

const START = new Set(["session.execution.started"])
const END = new Set([
  "session.idle",
  "session.deleted",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

function sessionID(event: SessionEvent): string | undefined {
  const data = event.data
  if (!data || typeof data !== "object") return
  const id = (data as { sessionID?: unknown }).sessionID
  return typeof id === "string" ? id : undefined
}

function statusType(event: SessionEvent): string | undefined {
  const status = (event.data as { status?: { type?: unknown } } | undefined)?.status
  return typeof status?.type === "string" ? status.type : undefined
}

/**
 * Tracks which sessions are running from the server event stream. Any event that
 * mentions a running session refreshes it, so sessions whose end event was missed
 * can be pruned after a period of silence.
 */
export class SessionTracker {
  private readonly running = new Map<string, number>()

  get size() {
    return this.running.size
  }

  ids() {
    return [...this.running.keys()]
  }

  /** Applies an event and reports whether the set of running sessions changed. */
  apply(event: SessionEvent, now = Date.now()): boolean {
    const id = sessionID(event)
    if (!id) return false

    if (START.has(event.type)) return this.add(id, now)
    if (END.has(event.type)) return this.running.delete(id)
    if (event.type === "session.status") {
      const type = statusType(event)
      if (type === "busy" || type === "retry") return this.add(id, now)
      if (type === "idle") return this.running.delete(id)
      return false
    }

    if (this.running.has(id)) this.running.set(id, now)
    return false
  }

  /** Drops sessions that have produced no events for `staleMs`. Returns the dropped IDs. */
  prune(staleMs: number, now = Date.now()): string[] {
    const dropped: string[] = []
    for (const [id, seen] of this.running) {
      if (now - seen < staleMs) continue
      this.running.delete(id)
      dropped.push(id)
    }
    return dropped
  }

  private add(id: string, now: number) {
    const added = !this.running.has(id)
    this.running.set(id, now)
    return added
  }
}
