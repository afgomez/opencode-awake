# opencode-awake

An OpenCode V2 plugin that keeps your Mac awake while any session in the OpenCode server is running. When the last session finishes, the Mac can sleep again.

## How it works

The plugin follows the server's event stream. A session counts as running from `session.execution.started` (or a `busy` / `retry` status) until it succeeds, fails, is interrupted, goes idle, or is deleted.

While at least one session is running:

- **`caffeinate -ims`** holds power assertions that prevent idle sleep. On AC power, they also prevent system sleep. The assertion is tied to the server's PID, so it is released if the server dies.
- **`pmset -a disablesleep 1`** keeps the Mac awake with the lid closed, including on battery. This needs root (see below). A detached watchdog restores sleep if the server exits without cleaning up. If sleep was already disabled before the plugin ran, the plugin leaves that setting alone.

After the last session finishes, the plugin waits `graceMs` and then releases both. If a session sends no events for `staleMs`, the plugin assumes its end event was missed and stops counting it.

## Status icon

The TUI shows an icon under the prompt. It is the first item on the right side of the footer, before subagents, shells, and context usage:

- 󰅶 (`nf-md-coffee`): the Mac stays awake even with the lid closed.
- 󰶞 (`nf-md-tea`): the Mac stays awake with the lid open, but closing the lid may still put it to sleep.
- No icon: no session is running, so the Mac can sleep.

The icons need a [Nerd Font](https://www.nerdfonts.com/). The server part publishes its state through the `opencode-awake` RPC, which other clients can read too (`opencode-awake/rpc`).

## Install

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/path/to/opencode-awake"],
}
```

### Lid-closed support

`pmset disablesleep` needs root. The plugin runs it with `sudo -n`, so you need a passwordless sudoers rule. Run `sudo visudo -f /etc/sudoers.d/opencode-awake` and add:

```
youruser ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep *
```

Without this rule, the plugin logs a warning once and falls back to `caffeinate` only. With `caffeinate` only, the Mac may still sleep when you close the lid, especially on battery.

> A Mac with sleep disabled stays fully awake with the lid closed. Don't put it in a bag while an agent is running.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "/path/to/opencode-awake",
      "options": {
        "lidClosed": true, // use pmset disablesleep (default true)
        "display": false, // also keep the display awake (default false)
        "graceMs": 10000, // delay before allowing sleep (default 10s)
        "staleMs": 3600000, // forget silent sessions after this long (default 1h)
      },
    },
  ],
}
```

## Development

```sh
bun install
bun test
bun run typecheck
```
