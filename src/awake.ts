import { Caffeinate, LidSleep, type Log } from "./power.ts"
import type { AwakeState } from "./rpc.ts"
import { SessionTracker, type SessionEvent } from "./tracker.ts"

export interface AwakeOptions {
  /** Also keep the Mac awake with the lid closed on battery, using `pmset disablesleep`. */
  readonly lidClosed: boolean
  /** Keep the display awake too. */
  readonly display: boolean
  /** Wait this long after the last session finishes before allowing sleep. */
  readonly graceMs: number
  /** Forget a session that has produced no events for this long. */
  readonly staleMs: number
}

export interface Flag {
  get(): Promise<boolean>
  set(value: boolean): Promise<void>
}

const PRUNE_INTERVAL = 60_000

/**
 * Keeps the Mac awake while any session is running. One instance is shared by
 * every plugin instance in the server process, because the plugin loads once per
 * location but power assertions are system-wide.
 */
export class Awake {
  readonly tracker = new SessionTracker()
  private readonly caffeinate: Caffeinate
  private readonly lid: LidSleep | undefined
  private graceTimer: ReturnType<typeof setTimeout> | undefined
  private readonly pruneTimer: ReturnType<typeof setInterval>
  private awake = false
  private current: AwakeState = "idle"
  private readonly listeners = new Set<(state: AwakeState) => void>()

  constructor(
    private readonly options: AwakeOptions,
    private readonly log: Log,
    private readonly lidFlag: Flag,
  ) {
    this.caffeinate = new Caffeinate({ display: options.display }, log)
    this.lid = options.lidClosed ? new LidSleep(log) : undefined
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL)
    this.pruneTimer.unref?.()
    void this.recover()
  }

  get state() {
    return this.current
  }

  /** Calls `listener` whenever the state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: AwakeState) => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  handle(event: SessionEvent) {
    if (this.tracker.apply(event)) this.sync()
  }

  prune(now = Date.now()) {
    const dropped = this.tracker.prune(this.options.staleMs, now)
    if (dropped.length === 0) return
    this.log(`forgetting silent sessions: ${dropped.join(", ")}`)
    this.sync()
  }

  async dispose() {
    clearInterval(this.pruneTimer)
    clearTimeout(this.graceTimer)
    await this.sleep()
  }

  private sync() {
    if (this.tracker.size > 0) {
      clearTimeout(this.graceTimer)
      this.graceTimer = undefined
      this.wake()
      return
    }
    if (!this.awake || this.graceTimer) return
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined
      if (this.tracker.size === 0) void this.sleep()
    }, this.options.graceMs)
  }

  private wake() {
    if (this.awake) return
    this.awake = true
    this.log(`keeping awake: ${this.tracker.ids().join(", ")}`)
    this.caffeinate.hold()
    this.notify()
    void this.disableLidSleep()
      .catch(this.fail)
      .finally(() => this.notify())
  }

  private async sleep() {
    if (!this.awake) return
    this.awake = false
    this.log("no running sessions, allowing sleep")
    this.caffeinate.release()
    this.notify()
    await this.restoreLidSleep().catch(this.fail)
  }

  private notify() {
    const state: AwakeState = !this.awake ? "idle" : this.lid?.effective ? "lid" : "awake"
    if (state === this.current) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }

  private async disableLidSleep() {
    if (!this.lid) return
    await this.lid.enable()
    if (this.lid.active) await this.lidFlag.set(true)
  }

  private async restoreLidSleep() {
    if (!this.lid) return
    await this.lid.disable()
    if (!this.lid.active) await this.lidFlag.set(false)
  }

  /** Restores sleep if a previous server run disabled it and never re-enabled it. */
  private async recover() {
    if (!this.lid || !(await this.lidFlag.get().catch(() => false))) return
    await this.lid
      .recover()
      .then(() => this.lidFlag.set(false))
      .catch(this.fail)
  }

  private readonly fail = (error: unknown) => {
    this.log(error instanceof Error ? error.message : String(error))
  }
}
