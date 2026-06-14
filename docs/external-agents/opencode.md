# Connecting OpenCode as an external agent

hip's **Custom CLI agent** (设置 → 智能体管理 → 添加智能体 → 自定义命令行智能体) speaks a
long-lived *turn-loop* over stdin/stdout: it sends one prompt terminated by the `\x1e`
byte and reads the reply up to the next `\x1e`, keeping one process alive for the whole
conversation. OpenCode's `opencode run` is **one-shot** (prompt as an argument, run once,
exit), so it cannot be pointed at directly. A tiny bridge translates between the two:

- **Bridge:** [`scripts/opencode-bridge.mjs`](../../scripts/opencode-bridge.mjs) — loops on
  hip's protocol and drives a fresh `opencode run` per turn.

## Prerequisites

1. OpenCode installed and on `PATH` (`opencode --version`).
2. OpenCode already authenticated with a model: `opencode auth login` (the bridge lets
   OpenCode use its own configured model by default — see "Model" below).

## Register it (form values)

**Recommended — full stream (thinking, tool calls, sub-agent scheduling):**

| Field (中文) | Value |
| --- | --- |
| 名称 (Name) | `OpenCode` |
| 命令 (Command) | `node` |
| 参数 (Arguments) | `/ABSOLUTE/PATH/TO/hip/scripts/opencode-bridge.mjs --pure --rich` |
| 协议 (Protocol) | **丰富 / Rich** |
| 推送我配置的模型与密钥 (Push model+key) | **off** (recommended — see below) |
| 启用 (Enabled) | on |

**Minimal — final answer only:** drop `--rich` from 参数 and set 协议 to **精简 / Thin**.

Use the **absolute** path to `opencode-bridge.mjs`. Then start a **new conversation**,
pick **OpenCode** in the input-box agent switcher, and send a message.

## Two modes

- **Rich (`--rich`, 协议 Rich):** the bridge runs `opencode run --format json` and
  translates OpenCode's streamed *parts* into hip's rich events, so you see everything:
  `reasoning` → the thinking panel; the `task` tool and other tools → tool cards (this is
  how OpenCode's **sub-agent scheduling** shows up); `text` → the answer. (`step-start`/
  `step-finish`/file/patch parts are not surfaced — file changes still show in hip's diff
  pane via the per-turn git checkpoint.)
- **Thin (default, 协议 Thin):** the bridge runs plain `opencode run` and streams only the
  final text as one assistant bubble.

### Why `--pure`

On a machine with OpenCode plugins, a remote MCP, and a large session DB, a plain
`opencode run` can take a long time to start. `--pure` runs OpenCode without external
plugins, which makes each turn fast and keeps stdout clean. Drop it if you specifically
need your plugins/MCP inside hip. (Verified: with `--pure`, `opencode run "…PINGPONG…"`
returns promptly; without it, startup can stall on plugin/MCP/DB load.)

Any flag you put after the script in 参数 is forwarded to `opencode run` verbatim, e.g.
`… opencode-bridge.mjs --pure --agent build`. The one special flag is `--continue`
(below), which the bridge interprets itself.

## Conversation continuity

By default the bridge is **stateless** — every hip turn is an independent `opencode run`,
so OpenCode does not remember earlier turns in the conversation. This is the safe default.

To keep context across turns, add `--continue` to 参数:

```
/ABSOLUTE/PATH/TO/hip/scripts/opencode-bridge.mjs --pure --continue
```

⚠️ **Caveat:** `opencode run --continue` resumes OpenCode's *global last session*. If you
also run OpenCode elsewhere (another terminal, the TUI), those turns can cross into the
same session. Only enable `--continue` if hip is your only OpenCode usage. (A per-session
isolated continuity mode is a future enhancement — it needs OpenCode's `--format json`
session id, which is the "Plan B" rich adapter.)

## Model: let OpenCode manage it (recommended)

Leave **推送模型 off**. OpenCode uses whatever model you configured with
`opencode auth login` / `~/.config/opencode/opencode.jsonc`. This is the most reliable path.

### Pushing hip's model (advanced / experimental)

If you turn **推送模型 on** and bind a model, hip injects `HIP_PROVIDER`, `HIP_MODEL`,
`HIP_BASE_URL`, `HIP_API_KEY` into the bridge, and the bridge adds
`-m "$HIP_PROVIDER/$HIP_MODEL"` to `opencode run`. For this to work:

- OpenCode must recognise that `provider/model` (the provider must be configured/authed in
  OpenCode), and
- the model id must match what OpenCode expects (hip catalog ids and OpenCode model ids can
  differ).

The bridge does **not** push hip's API key into OpenCode's provider auth — OpenCode
authenticates the selected provider itself. Treat model-push as experimental and verify it
against your OpenCode providers; if in doubt, leave it off.

## Notes & limitations

- **Rich-mode fidelity:** reasoning, text, and tool/sub-agent (`task`) cards are surfaced.
  Tool-card field mapping is based on OpenCode 1.17.6's `--format json` part shape and is
  best-effort across versions; unrecognised parts are skipped (text + reasoning always come
  through). File edits OpenCode makes are captured by hip's per-turn git checkpoint, so the
  diff/changes pane and revert-to-turn work regardless of mode.
- **Working directory:** OpenCode runs in the hip session's project directory and can read
  and edit files there (it's a coding agent). Use it on a project you intend it to act on.
- **Cancel:** stopping a turn kills the bridge process; the next turn respawns it.

## How it was tested

- Paid-free integration tests drive the real bridge through hip's real `LoopAgentProvider`
  against a mock `opencode`
  ([`opencode-bridge.test.ts`](../../packages/sidecar/src/session/agents/opencode-bridge.test.ts)):
  thin framing, stateless default, opt-in `--continue`, args passthrough (`--pure`),
  `-m provider/model` model push, and **rich** mapping of real-shape `--format json` parts
  (reasoning + the `task` sub-agent tool + text) to hip rich events.
- Real end-to-end smoke tests ran the bridge against the installed `opencode`: a thin
  `--pure` reply correctly framed with `\x1e`, and a rich `--pure --rich` turn (the
  `--format json` schema was captured from the real binary to build the mapping).
