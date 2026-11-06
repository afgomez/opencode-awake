import { Plugin } from "@opencode/plugin"
import { Awake, type AwakeOptions } from "./awake.ts"

const ID = "opencode-awake"
const SHARED = Symbol.for(`${ID}.shared`)
const RECONNECT_DELAY = 1_000

interface Shared {
  awake: Awake
  refs: number
}

const globals = globalThis as { [SHARED]?: Shared }

function log(message: string) {
  console.log(`[${ID}] ${message}`)
}

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function options(raw: Record<string, unknown>): AwakeOptions {
  return {
    lidClosed: raw.lidClosed !== false,
    display: raw.display === true,
    graceMs: number(raw.graceMs, 10_000),
    staleMs: number(raw.staleMs, 60 * 60_000),
  }
}

export default Plugin.define({
  id: ID,
  setup(ctx) {
    if (process.platform !== "darwin") {
      log(`unsupported platform ${process.platform}, doing nothing`)
      return
    }

    const shared = (globals[SHARED] ??= {
      awake: new Awake(options(ctx.options as Record<string, unknown>), log, {
        get: async () => (await ctx.storage.get("lidSleepDisabled")) === true,
        set: (value) => ctx.storage.set("lidSleepDisabled", value),
      }),
      refs: 0,
    })
    shared.refs++

    const controller = new AbortController()
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            shared.awake.handle(event)
          }
        } catch (error) {
          if (controller.signal.aborted) return
          log(`event stream failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY))
      }
    })()

    return async () => {
      controller.abort()
      if (--shared.refs > 0) return
      if (globals[SHARED] === shared) delete globals[SHARED]
      await shared.awake.dispose()
    }
  },
})
