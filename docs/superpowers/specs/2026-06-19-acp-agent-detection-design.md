# ACP Agent Detection + Wiring Claude Code / Codex / Kimi Code — Design

**Date:** 2026-06-19
**Branch:** feat/chat-code-surface-split (continuing)
**Status:** Approved design — pending implementation plan

## Goal

In 智能体管理, detect whether each supported ACP coding agent is installed on the
machine, surface install/added status on the provider picker, gate "add" on
"installed", and make Claude Code / Codex / Kimi Code real (addable) providers
alongside the existing OpenCode.

## Context

hip drives external coding agents over Zed's Agent Client Protocol (ACP — JSON-RPC
over stdio). Today only **OpenCode** is a real ACP provider (`opencode acp`); the
provider picker (`src/lib/acpPresets.ts`) lists Claude Code / Codex / Kimi Code as
`coming-soon` placeholders with no backend, and the OpenCode agent is *auto-injected*
as a builtin (`withBuiltinOpencode` in `src/store/agentsStore.ts`).

The ACP connect path already anticipates new providers: `buildAcpSpawn`
(`packages/sidecar/src/session/agents/acp-config.ts`) and `quirksFor`
(`packages/sidecar/src/session/agents/acp-quirks.ts`) both carry reserve-point
comments for `claude-code` / `codex` / `kimi-code`. The ACP provider/connection layer
(`acp-provider.ts`, `acp-connection.ts`) is already provider-generic.

## Research findings (adversarially verified, 2026-06-19)

| Provider | ACP | Detect binary | Launch | Auth |
|---|---|---|---|---|
| OpenCode *(existing)* | native | `opencode` | `opencode acp` | own auth.json |
| Kimi Code | **native** | `kimi` | `kimi acp` | own login |
| Claude Code | **adapter** | `claude-agent-acp` (legacy `claude-code-acp`) | `claude-agent-acp` | `ANTHROPIC_API_KEY` env |
| Codex | **adapter** | `codex-acp` | `codex-acp` | `OPENAI_API_KEY` env |

- Kimi Code speaks ACP natively (verified via a live `initialize` handshake against the
  installed CLI v0.16.0). npm package `@moonshot-ai/kimi-code`, bin `kimi`.
- Claude Code is **not** native — ACP is provided by the adapter package
  `@agentclientprotocol/claude-agent-acp` (renamed from the deprecated
  `@zed-industries/claude-code-acp`), which wraps the Claude Agent SDK and **bundles its
  own `claude` binary** — so a separately-installed `claude` CLI is NOT required. Running
  the `claude-agent-acp` bin with no args starts the ACP server over stdio.
- Codex is **not** native (the `codex` CLI has no `acp` subcommand) — ACP is provided by
  the adapter `@zed-industries/codex-acp` (bin `codex-acp`, v0.16.0, ships platform-specific
  native binaries). Self-contained; no separate `codex` CLI required.

## Locked decisions

1. **Global-install detection (uniform).** Detection is "is this preset's binary on
   PATH", the same for native and adapter providers. We do NOT probe `node`/`npx`, and we
   do NOT probe the underlying `claude`/`codex` CLIs (adapters are self-contained). The
   earlier "hybrid (npx fallback)" idea is dropped — global-only.
2. **Add is gated on install.** Only an `已安装` preset can be added. There is **no**
   `未安装 + 已添加` state. (If a runtime is uninstalled after adding — rare — the agent
   stays in the list and surfaces through the normal connect-error path; no special badge.)
3. **User-supplied keys (`用户自备`).** hip never sources API keys. For adapter presets that
   declare an `authEnvVar`, the editor offers one optional "API Key" field; if filled it is
   stored into the agent's `env[authEnvVar]` (plaintext in hip-agents.json — same posture as
   hip's existing `~/.hip/config/auth.json`); if empty, the agent relies on the user's
   ambient environment. No injection from hip's model-config provider store.
4. **Unify OpenCode.** Drop `withBuiltinOpencode` / `BUILTIN_OPENCODE`; all four providers
   go through the detect-and-add flow. Existing `opencode` agents in any saved config are
   preserved untouched.

## Status model

Two independent axes per preset:
- **Install** (machine): `已安装` / `未安装` — from detection (binary on PATH).
- **Add** (hip config): `已添加` / `未添加` — does an agent for this preset exist in config.

Picker card states & affordances:

| Install × Add | Badge | Action |
|---|---|---|
| `未安装` | `未安装` (muted) | not addable; show the exact install command (per preset) |
| `已安装` + `未添加` | `已安装` (success) | **`添加`** → opens the prefilled editor form |
| `已安装` + `已添加` | `已添加` | non-actionable (already in your list) |

The four status words the user asked for all appear: `已安装` / `未安装` on the install
axis, `已添加` when added, `未添加` = the addable (`已安装`-only) state. Detection results
are needed **only in the picker**; the added-agents list (AgentCard) is unchanged.

## Detection mechanism

- **Rust command** `which_binaries(names: Vec<String>) -> Result<HashMap<String, bool>, String>`
  in `src-tauri/src/lib.rs`, registered in the `invoke_handler` list. PATH lookup per name
  (split `$PATH`, check each dir for an executable file; on Windows also try PATHEXT — but
  this app targets macOS/darwin first, keep it POSIX-simple with a portable check). Sits
  alongside the existing config commands; always available, no sidecar dependency.
- **Frontend ipc** `src/ipc/detect.ts`: `detectBinaries(names: string[]): Promise<Record<string, boolean>>`
  wrapping `invoke('which_binaries', { names })`, mirroring the other `src/ipc/*Config.ts` wrappers.
- **detectionStore** (`src/store/detectionStore.ts`, zustand): holds the last detection map +
  a `refresh()` that probes the union of all preset detect-binaries. Called when the
  智能体管理 settings page mounts, with a manual "重新检测" refresh affordance in the picker.
- **Pure helper** `presetInstalled(preset, detection): boolean` =
  `detection[preset.detectBin] === true` (Claude Code additionally OR's the legacy bin).
  TDD'd in isolation.

## Preset metadata (`src/lib/acpPresets.ts`)

Each `AcpPreset` gains the runtime metadata (replacing the `status`/`coming-soon` model;
all four are now real):

```ts
export interface AcpPreset {
  id: string                  // 'opencode' | 'kimi-code' | 'claude-code' | 'codex'
  name: string                // brand label, not localized
  icon: AcpPresetIcon
  detectBin: string           // primary binary to find on PATH
  legacyBin?: string          // claude-code: 'claude-code-acp'
  command: string             // baked into AgentConfig.command on add
  args: string[]              // baked into AgentConfig.args on add
  quirks: string              // runtime quirk-profile key (sidecar acp-quirks.ts)
  authEnvVar?: string         // 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'; undefined ⇒ no key field
  installCmd: string          // shown in the 未安装 state, e.g. 'npm i -g @zed-industries/codex-acp'
}
```

| id | detectBin | command | args | quirks | authEnvVar | installCmd |
|---|---|---|---|---|---|---|
| opencode | `opencode` | `opencode` | `['acp']` | `opencode` | — | (verify exact: `npm i -g opencode-ai` or brew) |
| kimi-code | `kimi` | `kimi` | `['acp']` | `kimi-code` | — | `npm i -g @moonshot-ai/kimi-code` |
| claude-code | `claude-agent-acp` (legacy `claude-code-acp`) | `claude-agent-acp` | `[]` | `claude-code` | `ANTHROPIC_API_KEY` | `npm i -g @agentclientprotocol/claude-agent-acp` |
| codex | `codex-acp` | `codex-acp` | `[]` | `codex` | `OPENAI_API_KEY` | `npm i -g @zed-industries/codex-acp` |

`CUSTOM_ACP_PRESET_ID` was already removed (prior commit 43f529c). The `status`/
`AcpPresetStatus` 'coming-soon' machinery is removed (all presets real).

**Open item for the plan:** verify OpenCode's exact global-install command and Kimi's
exact bin/package against the live registry before shipping the `installCmd` strings.

## Add flow

Picking an `已安装` preset advances to the editor form (existing picker→form step),
prefilled: `name` = preset.name, `command`/`args` from the preset (a pure
`bakeAgentDraft(preset)` builder — trivial now, no hybrid branching), `quirks` = preset.quirks.
For presets with `authEnvVar`, the form shows the optional "API Key" field; on save its value
(if non-empty) is written to `env[authEnvVar]`. `已添加` is matched by the agent's `quirks`
value equaling a preset id (already 1:1 with preset). Save persists via the existing
`agentsStore.addAgent` → `set_agents_config` path.

The `未安装` presets are non-clickable in the picker and render their `installCmd`
(copyable) instead of an add affordance.

## OpenCode unification + migration

Remove `withBuiltinOpencode` and `BUILTIN_OPENCODE` from `src/store/agentsStore.ts` and its
call sites. Existing saved `opencode` agents (which carry `quirks:'opencode'`) are read as
normal agents → show as `已添加`. Fresh installs start with zero ACP agents. (Verify whether
the old builtin was ever *persisted* vs injected-on-read; either way the result is correct —
a persisted disabled opencode agent simply shows as 已添加.)

## Sidecar wiring

- `acp-quirks.ts`: add profiles for `kimi-code`, `claude-code`, `codex`. Start at the safe
  `DEFAULTS` (`cancelReportsEndTurn:false`, `defaultModelIsBilled:false`) and refine with real
  testing later. (Plan: confirm whether `defaultModelIsBilled` is still consumed post
  model-rollback; if vestigial, note it.)
- `buildAcpSpawn` (`acp-config.ts`): **no launch logic needed** — it spawns the stored
  `agent.command`/`agent.args` verbatim and already merges `agent.env` (so the `用户自备`
  key flows through). The OpenCode-shaped comment is updated to reflect that all four
  presets bake concrete command/args at add-time.

## Architecture / files

- **Rust:** +1 command (`which_binaries`) + handler registration.
- **Frontend:** `src/ipc/detect.ts` (new); `src/store/detectionStore.ts` (new); pure helpers
  `presetInstalled` / `presetAdded` / `bakeAgentDraft` (new, TDD); `src/lib/acpPresets.ts`
  (metadata rewrite); `AcpProviderPicker.tsx` (states/badges/install-hint/add gating +
  refresh); `AgentEditor.tsx` (auth-key field for adapter presets; `pickPreset` bakes from
  preset); `agentsStore.ts` (drop builtin injection); i18n (zh-CN/zh-TW/en: status labels,
  install-hint label, auth-key label/placeholder, refresh label).
- **Sidecar:** `acp-quirks.ts` (+3 profiles); `acp-config.ts` (comment only).

## Error handling

- `which_binaries` errors (unlikely) → detectionStore surfaces "检测失败" and treats all as
  `未安装` (fail-closed: don't let a detection error make an unrunnable agent look addable).
- Adding requires `已安装`; the UI never offers add for `未安装`, so no runtime command is
  baked for a missing binary.
- Missing API key (adapter agents): the agent connects but the adapter errors at auth time;
  surfaced through the existing ACP connect-error path. The editor's auth-key field + the
  install/auth hint reduce this; we do not add a key-presence status.

## Testing

- Pure helpers: `presetInstalled` (native hit/miss; claude-code legacy-bin OR), `presetAdded`
  (matches by quirks/preset id), `bakeAgentDraft` (each preset → correct command/args/quirks/env).
- `acpPresets`: table integrity (unique ids, every preset has detectBin/command/installCmd;
  adapter presets have authEnvVar; native presets don't).
- Rust `which_binaries`: found vs not-found on a temp PATH (unit test in lib.rs).
- `agentsStore`: builtin no longer injected; existing opencode agent preserved.
- Verify paid-test-free (run exact file paths, or move `~/.hip/config/auth.json` aside).
- GUI acceptance via browser preview (mocked) for picker states; real `yarn tauri dev` for
  actual detection + a live add/connect of at least one adapter agent.

## Out of scope

- No npx-on-demand launch (global-install only).
- No hip-sourced API keys / key management UI beyond the per-agent `env` field.
- No "added-then-uninstalled" badge on the agent list.
- No auto-update / version checks of the adapter packages.
- Refining the three new quirk profiles beyond safe defaults (follow-up after real testing).

## Risks / open items

1. Exact `installCmd` strings (OpenCode pkg name; reconfirm Kimi pkg/bin) — verify in the plan.
2. New quirk profiles default to baseline; real-agent behavior (cancel semantics, etc.) may
   need tuning — acceptable for v1, flagged as follow-up.
3. Windows PATH/PATHEXT handling in `which_binaries` — target macOS first; keep the check
   portable but don't over-invest in Windows now.
