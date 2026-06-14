# Connecting OpenCode as an external agent

hip's **Custom CLI agent** (设置 → 智能体管理 → 添加智能体 → 自定义命令行智能体) speaks a
long-lived *turn-loop* over stdin/stdout. A tiny bridge adapts OpenCode to it:

- **Bridge:** [`scripts/opencode-bridge.mjs`](../../scripts/opencode-bridge.mjs)
  - **Rich mode** (recommended) drives a long-lived **`opencode serve`** and
    translates its HTTP + Server-Sent-Events bus — the same interface OpenCode's
    own TUI uses — into hip's rich events, so you see the **thinking, tool calls,
    and sub-agent scheduling** as they happen.
  - **Thin mode** drives a one-shot `opencode run` per turn and returns only the
    final answer text.

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

> **Want to see thinking?** Reasoning only exists if OpenCode's model is a *reasoning*
> model (e.g. `deepseek-reasoner`, `kimi-k2-thinking`). A plain chat model (e.g.
> `deepseek-chat`) produces no thinking to stream — you'll still get tools and the
> answer, just no 💭 panel. Select a reasoning model in OpenCode (or push one — see
> "Model" below).

## Two modes

- **Rich (`--rich`, 协议 Rich):** the bridge starts `opencode serve`, opens one
  session, subscribes to the `/event` SSE bus, and sends each turn with
  `prompt_async`. It maps OpenCode's streamed events to hip's rich events:
  - `message.part.updated` / `message.part.delta` on a **reasoning** part → the 💭
    thinking panel (streamed token-by-token);
  - **text** parts → the answer;
  - **tool** parts (incl. the `task` tool) → tool cards — this is how OpenCode's
    **sub-agent execution** shows up;
  - **subtask** parts → a `subagent:<name>` card announcing the **scheduling**;
  - `session.idle` → end of turn.

  (`step-start`/`step-finish`/file/patch parts are not surfaced — file changes still
  show in hip's diff pane via the per-turn git checkpoint.)
- **Thin (default, 协议 Thin):** the bridge runs plain `opencode run` and streams only
  the final text as one assistant bubble.

### Why rich mode does NOT use `opencode run --format json`

The obvious one-shot path (`opencode run --format json`) **cannot** deliver the thinking
stream, by design:

- it does **not** serialize reasoning/thinking content (OpenCode issue #7202 — reasoning
  shows in the TUI but is dropped from the JSON);
- it emits tool events only once a tool **completes** (no running/streaming state, and
  sub-agent internals aren't visible);
- it **buffers** its whole output and prints it at the end (no live streaming).

So rich mode talks to `opencode serve` instead, which streams everything the TUI gets.

### Why `--pure`

`--pure` runs OpenCode without external plugins/MCP. On a machine with plugins, a remote
MCP, and a large session DB, startup can otherwise stall badly (verified: a non-`--pure`
`opencode run` hung indefinitely). `--pure` keeps the server fast and the stream clean.
Drop it only if you specifically need your plugins/MCP inside hip.

## Conversation continuity

- **Rich mode is continuous *and* isolated by default.** The bridge keeps one
  `opencode serve` session alive for the whole hip conversation, so OpenCode remembers
  earlier turns — and because it's a *private* session, it never crosses into OpenCode
  usage you have running elsewhere. (Cancelling a turn restarts the bridge, which starts
  a fresh session; continuity resets at that point.)
- **Thin mode is stateless by default.** Add `--continue` to 参数 to carry context
  across turns, but ⚠️ thin `opencode run --continue` resumes OpenCode's *global last
  session*, so it can cross-contaminate with OpenCode you run in another terminal/TUI.
  Prefer rich mode if you want reliable, isolated continuity.

## Model: let OpenCode manage it (recommended)

Leave **推送模型 off**. OpenCode uses whatever model you configured with
`opencode auth login` / `~/.config/opencode/opencode.jsonc`. This is the most reliable path.
(Pick a reasoning model there if you want the thinking panel.)

### Pushing hip's model (advanced / experimental)

If you turn **推送模型 on** and bind a model, hip injects `HIP_PROVIDER`, `HIP_MODEL`,
`HIP_BASE_URL`, `HIP_API_KEY` into the bridge. In **rich** mode the bridge sends
`{ model: { providerID, modelID } }` with each prompt; in **thin** mode it adds
`-m "$HIP_PROVIDER/$HIP_MODEL"` to `opencode run`. For this to work:

- OpenCode must recognise that `provider/model` (the provider must be configured/authed in
  OpenCode), and
- the model id must match what OpenCode expects (hip catalog ids and OpenCode model ids can
  differ).

The bridge does **not** push hip's API key into OpenCode's provider auth — OpenCode
authenticates the selected provider itself. Treat model-push as experimental and verify it
against your OpenCode providers; if in doubt, leave it off.

## Notes & limitations

- **Rich-mode fidelity:** reasoning, text, tool, and sub-agent (`task`/`subtask`) cards are
  surfaced. The mapping is based on OpenCode 1.17.6's event/part shape and is best-effort
  across versions; unrecognised parts are skipped (text + reasoning always come through).
  File edits OpenCode makes are captured by hip's per-turn git checkpoint, so the
  diff/changes pane and revert-to-turn work regardless of mode.
- **Working directory:** OpenCode runs in the hip session's project directory and can read
  and edit files there (it's a coding agent). Use it on a project you intend it to act on.
- **Cancel:** stopping a turn kills the bridge (and the `opencode serve` it spawned); the
  next turn respawns it.

## How it was tested

- Paid-free integration tests drive the real bridge through hip's real `LoopAgentProvider`
  ([`opencode-bridge.test.ts`](../../packages/sidecar/src/session/agents/opencode-bridge.test.ts)):
  - thin: framing, stateless default, opt-in `--continue`, args passthrough (`--pure`),
    `-m provider/model` model push;
  - rich: against a mock `opencode serve`
    ([`mock-opencode-server.mjs`](../../packages/sidecar/src/session/agents/__fixtures__/mock-opencode-server.mjs))
    emitting OpenCode's real SSE shape — asserts reasoning streams, the `task` sub-agent
    tool shows as a card, the answer is correct, the user prompt is **not** echoed back
    (role-gated), one session is reused across turns, and model-push lands in the body.
- Real end-to-end: the bridge against the installed `opencode serve` with
  `deepseek-reasoner` streamed **91 reasoning events** plus the correct answer — i.e. the
  thinking process now reaches hip. (The server event schema was captured from the real
  binary's OpenAPI `/doc` to build the mapping.)
