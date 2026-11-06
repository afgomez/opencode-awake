import { Rpc } from "@opencode/plugin/rpc"

/**
 * - `idle`: no session is running, the Mac may sleep.
 * - `awake`: kept awake with the lid open, but closing the lid may still sleep it.
 * - `lid`: kept awake even with the lid closed.
 */
export type AwakeState = "idle" | "awake" | "lid"

const state = {
  type: "object",
  properties: { state: { type: "string", enum: ["idle", "awake", "lid"] } },
  required: ["state"],
  additionalProperties: false,
} as const

export const AwakeRpc = Rpc.define({
  id: "opencode-awake",
  methods: {
    state: { input: { type: "object", additionalProperties: false }, output: state },
  },
  events: {
    changed: { schema: state },
  },
})
