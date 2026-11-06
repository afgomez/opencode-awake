import { Plugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { AwakeRpc, type AwakeState } from "./rpc.ts"

const COFFEE = "\u{F0176}" // nf-md-coffee
const TEA = "\u{F0D9E}" // nf-md-tea
const POLL_INTERVAL = 30_000

export default Plugin.define({
  id: "opencode-awake.tui",
  setup(context) {
    const [state, setState] = createSignal<AwakeState>("idle")
    const awake = context.client.rpc(AwakeRpc)
    const controller = new AbortController()

    // RPC events are live only, so also resync when sessions start or stop and periodically.
    const refresh = () => {
      const location = context.location ?? context.data.location.default()
      awake
        .state({}, { location, signal: controller.signal })
        .then((result) => setState((result as { state: AwakeState }).state))
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL)

    const stops = [
      awake.events.on("changed", (event) => void setState(event.data.state as AwakeState), {
        signal: controller.signal,
      }),
      context.data.on("session.execution.started", refresh),
      context.data.on("session.execution.succeeded", refresh),
      context.data.on("session.execution.failed", refresh),
      context.data.on("session.execution.interrupted", refresh),
      // Right after the editor file label, which places the icon before the built-in
      // subagent, shell, and usage indicators on the right side of the footer.
      context.ui.slot({
        after: "prompt.footer.file",
        render: () => (
          <Show when={state() !== "idle"}>
            <text flexShrink={0} wrapMode="none" fg={context.theme.text.muted}>
              {state() === "lid" ? COFFEE : TEA}
            </text>
          </Show>
        ),
      }),
    ]

    return () => {
      controller.abort()
      clearInterval(timer)
      stops.forEach((stop) => stop())
    }
  },
})
