# External Agent Management — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming), ready for implementation planning
**Topic:** Integrate external, out-of-process agents (e.g. local OpenCode-cli, or a user's self-built agent) into hip, switchable from the input box before a conversation starts, with optional push of hip's configured model + key into the agent.

---

## 1. Goal

Let users register **external agents** that live outside hip — a local `opencode` CLI, or any custom CLI/script — and converse with them inside hip's normal UI.

Two explicit requirements from the request:

1. Users can **switch agents from the input box** to drive a conversation. Switching is allowed **only before the conversation starts** (i.e. while the session is still a draft).
2. If an external agent **supports configuring an LLM + API key**, the user can **push a model already configured in the Model Configuration page** into that agent.

The built-in hip agent remains the default and is unchanged in behavior.

---

## 2. Non-goals (explicitly deferred — YAGNI for v1)

- Auto-detecting installed agent binaries on `PATH`.
- Manifest-driven self-description (`hip-agent.json` / `--hip-describe`).
- HTTP/WS endpoint transport (v1 is subprocess-only).
- Inline per-chat model override in the picker (picker is agent-only; model is bound in Settings).
- History replay / OpenCode session-resume when reopening a committed session.
- HITL pause/resume for external agents.
- A "default agent" preference (new drafts always start on built-in hip).
- Multiple simultaneous agents in one session.

---

## 3. Decisions (resolved in brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| Integration depth | How much of hip's rich UI external agents get | **Two-tier**: universal *thin* pipe (any CLI works as a plain bubble) + optional *rich* JSON protocol (tool cards / reasoning / usage). OpenCode is the first rich adapter. |
| Transport + lifecycle | How hip runs/connects | **Subprocess, long-lived per session.** Spawn on commit, stream turns over stdin, dispose on close. |
| Model push | Delivering model+key to a foreign process | **Env injection + per-agent adapter remap.** Inject `HIP_*` env; adapter remaps to the agent's expected form. Keys never hit files or `ps`. |
| Registration | Adding agents + learning capabilities | **Curated adapters + custom entry.** OpenCode via built-in adapter; "Custom CLI agent" via a generic form. Capabilities are *declared*, not negotiated. |
| Settings layout | Agent Management UI | **Card list + editor drawer.** |
| Workspace | Relationship to git checkpoints/diff | **Shared cwd + auto checkpoint.** hip wraps each external-agent turn in a git checkpoint; git is the source of truth for the diff. |
| Input picker | What the composer pill controls | **Agent-only.** Model shown as read-only subtext; bound in Settings. Locks to a `via <agent> 🔒` badge once committed. |
| On reopen | Committed external-agent session reopened | **Respawn fresh + subtle notice.** No history replay in v1. |
| Interrupt | Stop control during an external turn | **Stop = abort the turn** (SIGINT → SIGKILL). No mid-turn pause/resume. |
| Default agent | New draft conversations | **Always built-in hip.** Opt into external per-draft. |

---

## 4. Architecture

### 4.1 The agent-provider seam (sidecar)

Today `Session.runTurn()` (`packages/sidecar/src/session/session.ts:684`) invokes the LangGraph ReAct graph (`graph.ts`) directly. The existing `ModelRunner` interface (`model-runner.ts:9-21`) only swaps the *model call* — too low for an external agent, which owns its own loop + tools + model. We add a higher seam:

```ts
// packages/sidecar/src/session/agent-provider.ts (new)
interface TurnInput {
  text: string
  // session context the provider needs (cwd is on the Session already)
}

interface AgentProvider {
  readonly id: string
  /** Run one turn. Stream incremental output through `emit` (hip's existing GraphEmit union). */
  runTurn(input: TurnInput, emit: (e: GraphEmit) => void, signal: AbortSignal): Promise<TurnResult>
  /** Tear down any long-lived resources (the child process). */
  dispose?(): Promise<void>
}
```

- **`BuiltinAgentProvider`** wraps the current graph. It is the default and produces **zero behavior change** for existing sessions.
- **`ExternalAgentProvider`** owns the child process and translates its output into `GraphEmit` events.

`Session` chooses the provider from `SessionConfig.agentId` (absent / `"builtin"` → `BuiltinAgentProvider`). `runTurn()` becomes a thin dispatch to `this.agentProvider.runTurn(...)`, preserving the existing `GraphEmit`/`ServerMessage` streaming path so the UI is agnostic to which provider ran.

The `ExternalAgentProvider` instance is created when the session **commits** (first message) and holds the long-lived child process; subsequent turns write to its stdin. `Session` disposal calls `dispose()`.

### 4.2 Two-tier I/O protocol

Declared per agent via `transport: 'thin' | 'rich'`.

**Turn framing over the persistent process.** Because the agent is long-lived per session (§4.7), turns are multiplexed over one stdin/stdout pair. The contract: hip writes one **turn request** to stdin per turn (a single line: the user text for thin; a `{"type":"user","text":...}` line for rich), and the agent signals end-of-turn with a **sentinel** — EOF-of-response for thin is ambiguous, so the agent must emit a trailing `\x1e` (record separator) line for thin, or a `{"type":"done"}` event for rich. hip blocks reading until the sentinel, then the process idles until the next turn. A purely one-shot CLI that exits after one response does **not** satisfy this contract; such agents are bridged by their **adapter** (the OpenCode adapter maps hip turns onto OpenCode's persistent session mode). Generic custom agents must implement the stdin turn-loop to be long-lived; a one-shot-only custom binary is out of scope for v1.

**Thin** — agent reads the prompt line from stdin and writes plain text to stdout, terminated by the `\x1e` sentinel:
- hip streams stdout as a single assistant message via `token:stream` until the sentinel.
- Process exit (the agent died) mid-turn, or a non-zero exit, → turn error (stderr tail surfaced).
- No tool cards / reasoning / usage (expected). Works with any CLI that implements the turn-loop, no adapter.

**Rich** — agent emits **newline-delimited JSON** on stdout, one event per line, mirroring `GraphEmit`:

```jsonc
{"type":"text","delta":"..."}
{"type":"reasoning","delta":"..."}
{"type":"tool_start","id":"t1","name":"edit_file","input":{...}}
{"type":"tool_end","id":"t1","output":"...","ok":true}
{"type":"usage","input":1234,"output":567}
{"type":"done"}
```

`ExternalAgentProvider` parses each line and re-emits hip's native events → full tool cards, reasoning panel, token usage. Malformed lines are tolerated (logged, skipped) so a stray `console.log` in the agent doesn't break the stream. The OpenCode adapter translates OpenCode's actual output into this schema.

> Note: even in rich mode, **file changes shown in the diff pane come from the git checkpoint**, not from `tool_*` events. `tool_*` events only render cards; git is the source of truth (§4.6).

### 4.3 Model + key injection

When an agent has `acceptsModelConfig === true` and a `boundModelId`, the sidecar (which already holds keys — injected at its own spawn per `src-tauri/src/sidecar.rs` + `HIP_PROVIDERS_PATH`) resolves the model and injects a **standard env contract** into the child:

```
HIP_API_KEY   = <resolved key for the bound model>
HIP_BASE_URL  = <provider baseURL>
HIP_MODEL     = <model id>
```

A **per-agent adapter** is two pure functions:

```ts
interface AgentAdapter {
  buildEnv(model: ResolvedModel, key: string): Record<string, string>  // remap HIP_* → agent's expected env
  buildArgs(spec: AgentSpec): string[]                                  // launch args
  parseLine?(line: string): GraphEmit | null                           // rich mode only
}
```

- **Generic custom agent**: identity `buildEnv` (just the `HIP_*` vars), no `parseLine` unless `transport === 'rich'` (then expects hip's JSON schema directly).
- **OpenCode adapter**: remaps to OpenCode's expected provider env, supplies `buildArgs` (e.g. `run`), and `parseLine` to translate OpenCode's output.

Keys are passed only via the child's environment — never written to disk, never in `argv`.

### 4.4 Data model

```ts
// packages/protocol/src/index.ts (additions)

type AgentTransport = 'thin' | 'rich'

interface AgentConfig {
  id: string                  // nanoid
  name: string                // display name
  kind: 'opencode' | 'custom' // selects the adapter; 'opencode' = curated
  command: string             // executable (path or PATH name)
  args: string[]              // static launch args
  transport: AgentTransport
  acceptsModelConfig: boolean
  boundModelId?: string       // references a model in hip-providers.json
  env?: Record<string, string> // advanced manual overrides
  enabled: boolean
}

interface AgentsConfig {
  agents: AgentConfig[]
}

// SessionConfig (protocol/index.ts:3-12) gains:
interface SessionConfig {
  // ...existing...
  agentId?: string            // undefined / 'builtin' => built-in hip agent
}
```

The built-in hip agent is **not** stored in `AgentsConfig`; it is a synthetic, always-present, non-editable entry surfaced by the UI and treated as the default by the sidecar.

### 4.5 Registry plumbing (mirror the providers pattern)

- Persist `AgentsConfig` to `~/.hip/config/hip-agents.json` (non-secret; same dir as `hip-providers.json`).
- Inject `HIP_AGENTS_PATH` into the sidecar at spawn (`src-tauri/src/sidecar.rs`), exactly as `HIP_PROVIDERS_PATH` is injected, so the sidecar can read the registry to spawn the chosen agent.
- UI edits via a new `agentsStore.ts` (mirrors `providersStore.ts`) + a config IPC to persist and signal reload.
- New IPC message `config:setAgent { agentId }` — **draft only**; handled in `session-manager.ts` alongside `config:setActiveModel`. Frozen into the session at commit.

### 4.6 Workspace + checkpoints

External agents edit files through their own tools, bypassing hip's tool dispatch. To keep hip's safety net consistent:

- The external agent runs in the **session cwd** (same project dir as the built-in agent).
- hip wraps each external-agent turn in a **git checkpoint** using `packages/sidecar/src/session/workspace-git.ts`: ensure a baseline, then snapshot after the turn completes. Because the agent's edits land on disk in cwd, the snapshot captures them.
- **git is the source of truth** for the diff/changes pane and revert-to-turn — these work identically for external agents, even in thin mode where no per-tool cards render.

### 4.7 Lifecycle & cancellation

```
draft (agentId chosen, no process)
  │  first message → commit
  ▼
spawn child (cwd, injected env)  ──► turn N: write stdin, stream stdout, checkpoint ──► (repeat)
  │  crash mid-turn → turn error (stderr tail); next turn respawns
  │  session close / switch away (n/a once committed) → dispose(): SIGINT → SIGKILL after grace
  ▼
reopen committed session → respawn fresh + subtle "agent restarted, earlier context not carried over" notice
```

- Spawning reuses the `execFile`/child-process pattern already used for git in `workspace-git.ts` (cwd / timeout / maxBuffer / env-override), extended to a long-lived streaming child.
- AbortSignal (stop button) → SIGINT, then SIGKILL after a grace timeout. The existing parent-watch covers orphan cleanup.

---

## 5. UI

### 5.1 Settings → Agent Management

- New `src/components/account/AgentManagement.tsx`, appended to the `PAGES` array in `src/components/account/SettingsPanel.tsx` as `{ id: 'agents', icon, labelKey: 'settings.agents', Component }`. Radix vertical tabs auto-route.
- i18n keys under `settings.agents.*` in `src/i18n/{en,zh-CN,zh-TW}.ts`.
- **Layout: card list + editor drawer.**
  - Built-in hip pinned as a non-editable card (shows it's the default).
  - Each registered agent is a compact row: name, `command · transport`, bound-model chip, enabled toggle.
  - "Add agent" → choose **OpenCode** (curated; prefills command/adapter/capabilities, user confirms/locates the binary) or **Custom CLI agent**.
  - Editor drawer fields: name, command, args, transport (thin/rich), `accepts model config` toggle, bound model (dropdown sourced from `providersStore`), enabled toggle, advanced env overrides.
- New `src/store/agentsStore.ts` mirrors `providersStore.ts` (load/persist via the config IPC).

### 5.2 Composer agent pill

- New `src/components/composer/AgentPicker.tsx`, rendered in the `leftSlot` of `InputBar.tsx`/`Composer.tsx`, beside `StylePicker`/`FolderPill`.
- **Draft** (`activeSessionId === null`): interactive pill + popover listing enabled agents (built-in + registered), each with its model shown as grey subtext. Selecting writes `SessionConfig.agentId` to the draft via `config:setAgent`.
- **Committed** (`activeSessionId !== null`): read-only `via <agent> 🔒` badge (same gating inverse as `StylePicker`'s `if (!activeId) return null`).
- The `agentId` is frozen into the session at commit in `src/domain/sessionService.sendMessage()` (`sessionService.ts:276-295`).
- Validation: if a selected agent has `acceptsModelConfig` but no `boundModelId`, block selection with a hint pointing to Settings.

---

## 6. Error handling

| Condition | Behavior |
|-----------|----------|
| Binary missing / not executable | Validation error at registration; clear turn-failure message if it only fails at spawn. |
| `acceptsModelConfig` on, no bound model | Block selection in the picker with a hint to Settings. |
| Child crash mid-turn | Turn error with stderr tail; process respawns on next turn. |
| Non-zero exit (thin) | Turn error; stderr surfaced. |
| Malformed rich JSON line | Logged and skipped; stream continues. |
| Stop pressed | Abort turn (SIGINT → SIGKILL). |

---

## 7. Testing

- **Sidecar unit** — `ExternalAgentProvider` driven by a **stub child script** that implements the stdin turn-loop + sentinel (one fixture echoes thin text, one emits rich JSON lines, and one stays alive across multiple turns): assert `GraphEmit` mapping, multi-turn over one process, env injection contains `HIP_*` + adapter remap, cancellation kills the process, exit-code / stderr error handling, malformed-line tolerance.
- **Adapter unit** — OpenCode `buildEnv` / `buildArgs` / `parseLine` as pure functions.
- **Checkpoint integration** — an external-agent turn that edits a file produces a git checkpoint whose diff captures the on-disk change; revert-to-turn restores.
- **UI** — `agentsStore` CRUD; Agent Management drawer (add OpenCode / custom, edit, enable); `AgentPicker` draft-only gating (interactive in draft, locked badge when committed); `SessionConfig.agentId` persistence + freeze-on-commit.
- **E2E (wdio, paid-free)** — register a fake "echo" custom agent, switch to it in a draft, send a message, observe the thin output bubble + a created checkpoint. (Per project convention, live-LLM paths are accepted via manual GUI; this fake-agent E2E uses no paid calls.)

---

## 8. File-change map

**New:**
- `packages/sidecar/src/session/agent-provider.ts` — `AgentProvider`, `BuiltinAgentProvider`, `ExternalAgentProvider`.
- `packages/sidecar/src/session/agent-adapters/` — `index.ts`, `opencode.ts`, `custom.ts`.
- `src/components/account/AgentManagement.tsx` + editor drawer.
- `src/components/composer/AgentPicker.tsx`.
- `src/store/agentsStore.ts`.
- Test fixtures: stub thin/rich child scripts.

**Modified:**
- `packages/protocol/src/index.ts` — `AgentConfig`, `AgentsConfig`, `AgentTransport`, `SessionConfig.agentId`, `config:setAgent` message.
- `packages/sidecar/src/session/session.ts` — `runTurn()` dispatches to the selected `AgentProvider`; provider lifecycle.
- `packages/sidecar/src/session/session-manager.ts` — handle `config:setAgent`; read `hip-agents.json`.
- `src-tauri/src/sidecar.rs` — inject `HIP_AGENTS_PATH`.
- `src/components/account/SettingsPanel.tsx` — append `agents` page.
- `src/components/composer/InputBar.tsx` / `Composer.tsx` — mount `AgentPicker` in `leftSlot`.
- `src/domain/sessionService.ts` — freeze `agentId` on commit.
- `src/i18n/{en,zh-CN,zh-TW}.ts` — `settings.agents.*` + picker strings.

---

## 9. Open questions

None outstanding — all forks and the three edge defaults (reopen, interrupt, default agent) were resolved in brainstorming.
