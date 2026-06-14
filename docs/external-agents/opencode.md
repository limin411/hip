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

| Field (中文) | Value |
| --- | --- |
| 名称 (Name) | `OpenCode` |
| 命令 (Command) | `node` |
| 参数 (Arguments) | `/ABSOLUTE/PATH/TO/hip/scripts/opencode-bridge.mjs --pure` |
| 协议 (Protocol) | **精简 / Thin** |
| 推送我配置的模型与密钥 (Push model+key) | **off** (recommended — see below) |
| 启用 (Enabled) | on |

Use the **absolute** path to `opencode-bridge.mjs`. Then start a **new conversation**,
pick **OpenCode** in the input-box agent switcher, and send a message.

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

- **Thin only:** output is shown as a plain assistant bubble. There are no per-tool cards /
  reasoning panels for OpenCode (that's the rich `--format json` adapter, a future
  enhancement). hip's git checkpoints still wrap each turn, so the diff/changes pane and
  revert-to-turn work at the file level.
- **Working directory:** OpenCode runs in the hip session's project directory and can read
  and edit files there (it's a coding agent). Use it on a project you intend it to act on.
- **Cancel:** stopping a turn kills the bridge process; the next turn respawns it.

## How it was tested

- Paid-free unit/integration tests drive the real bridge through hip's real
  `LoopAgentProvider` against a mock `opencode`
  ([`opencode-bridge.test.ts`](../../packages/sidecar/src/session/agents/opencode-bridge.test.ts)):
  thin framing, stateless default, opt-in `--continue`, args passthrough (`--pure`), and
  `-m provider/model` model push.
- A real end-to-end smoke test ran the bridge against the installed `opencode run --pure`
  and confirmed the reply is produced and correctly terminated with the `\x1e` sentinel.
