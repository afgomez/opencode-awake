import { Plugin } from "@opencode/plugin"
import { Awake, type AwakeOptions } from "./awake.ts"
import { AwakeRpc } from "./rpc.ts"

const ID = "opencode-awake"
const RECONNECT_DELAY = 1_000

interface Shared {
  awake: Awake
  refs: number
}

// The plugin loads once per location, but power assertions are system-wide, so every
// instance from this module shares one tracker. This lives in the module rather than on
// globalThis so that a reloaded module starts fresh instead of reusing stale code.
let current: Shared | undefined

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
  async setup(ctx) {
    if (process.platform !== "darwin") {
      log(`unsupported platform ${process.platform}, doing nothing`)
      return
    }

    const shared = (current ??= {
      awake: new Awake(options(ctx.options as Record<string, unknown>), log, {
        get: async () => (await ctx.storage.get("lidSleepDisabled")) === true,
        set: (value) => ctx.storage.set("lidSleepDisabled", value),
      }),
      refs: 0,
    })
    shared.refs++

    const release = async () => {
      if (--shared.refs > 0) return
      if (current === shared) current = undefined
      await shared.awake.dispose()
    }

    const rpc = await ctx.rpc
      .register(AwakeRpc, {
        state: async () => ({ state: shared.awake.state }),
      })
      .catch(async (error) => {
        await release()
        throw error
      })
    const unsubscribe = shared.awake.subscribe((state) => {
      rpc.events.emit("changed", { state }).catch((error) => log(`cannot publish state: ${error}`))
    })

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
      unsubscribe()
      await rpc.dispose()
      await release()
    }
  },
})
