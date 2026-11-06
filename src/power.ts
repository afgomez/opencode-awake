import { execFile, spawn, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

const CAFFEINATE = "/usr/bin/caffeinate"
const PMSET = "/usr/bin/pmset"
const SUDO = "/usr/bin/sudo"

export type Log = (message: string) => void

/**
 * Holds a `caffeinate` power assertion. The assertion prevents idle sleep and,
 * on AC power, system sleep. `-w` ties it to this process, so it is released
 * even if the OpenCode server dies without cleaning up.
 */
export class Caffeinate {
  private child: ChildProcess | undefined

  constructor(
    private readonly options: { display: boolean },
    private readonly log: Log,
  ) {}

  get held() {
    return this.child !== undefined
  }

  hold() {
    if (this.child) return
    const flags = this.options.display ? "-dims" : "-ims"
    const child = spawn(CAFFEINATE, [flags, "-w", String(process.pid)], { stdio: "ignore" })
    child.on("error", (error) => this.log(`caffeinate failed: ${error.message}`))
    child.on("exit", () => {
      if (this.child === child) this.child = undefined
    })
    this.child = child
  }

  release() {
    const child = this.child
    this.child = undefined
    child?.kill()
  }
}

/**
 * Disables sleep entirely with `pmset disablesleep`, which also keeps the Mac
 * awake with the lid closed on battery. `pmset` needs root, so this runs
 * `sudo -n` and requires a passwordless sudoers rule for pmset.
 *
 * A detached watchdog restores sleep if the OpenCode server exits without
 * releasing it.
 */
export class LidSleep {
  private owned = false
  private external = false
  private watchdog: ChildProcess | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private warned = false

  constructor(private readonly log: Log) {}

  /** Whether this instance disabled sleep and must restore it. */
  get active() {
    return this.owned
  }

  /** Whether sleep is disabled, by this instance or by someone else. */
  get effective() {
    return this.owned || this.external
  }

  enable() {
    return this.serial(async () => {
      if (this.owned) return
      // Someone else disabled sleep; leave it to them.
      this.external = await sleepDisabled()
      if (this.external) return
      try {
        await pmset("1")
      } catch (error) {
        if (!this.warned) {
          this.warned = true
          this.log(
            `cannot disable lid-closed sleep (${message(error)}). ` +
              `Allow it with a sudoers rule such as: ${process.env.USER ?? "<user>"} ALL=(root) NOPASSWD: ${PMSET} -a disablesleep *`,
          )
        }
        return
      }
      this.owned = true
      this.watchdog = spawn(
        "/bin/sh",
        [
          "-c",
          `while kill -0 ${process.pid} 2>/dev/null; do sleep 5; done; ${SUDO} -n ${PMSET} -a disablesleep 0`,
        ],
        { detached: true, stdio: "ignore" },
      )
      this.watchdog.unref()
    })
  }

  disable() {
    return this.serial(async () => {
      this.external = false
      if (!this.owned) return
      this.watchdog?.kill()
      this.watchdog = undefined
      try {
        await pmset("0")
        this.owned = false
      } catch (error) {
        this.log(`cannot restore sleep: ${message(error)}`)
      }
    })
  }

  /** Restores sleep after a previous server run that could not, for example after a reboot. */
  recover() {
    return this.serial(async () => {
      if (this.owned || !(await sleepDisabled())) return
      await pmset("0")
    })
  }

  private serial(task: () => Promise<void>) {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }
}

async function sleepDisabled() {
  const { stdout } = await run(PMSET, ["-g"])
  return /SleepDisabled\s+1/.test(stdout)
}

function pmset(value: "0" | "1") {
  return run(SUDO, ["-n", PMSET, "-a", "disablesleep", value])
}

function message(error: unknown) {
  if (error && typeof error === "object" && "stderr" in error && String(error.stderr).trim())
    return String(error.stderr).trim()
  return error instanceof Error ? error.message : String(error)
}
