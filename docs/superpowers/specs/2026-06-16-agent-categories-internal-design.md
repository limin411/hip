# 智能体管理 — three categories + internal managed agents

**Date:** 2026-06-16
**Status:** Design approved, ready for implementation plan
**Branch:** `feat/agent-categories-internal`

## Goal

Iterate the 智能体管理 (Agent Management) settings page and the dispatch runtime so that:

1. Agents are explicitly grouped into **three categories** — ACP-connected, CLI-connected, and a new **internal managed** kind created directly in the UI.
2. **Internal managed agents** carry a configured system prompt (persona), run on **hip's own built-in core loop**, are managed by hip's built-in supervisor, and are dispatched as sub-agents — exactly like the external sub-agents, through the same `dispatch_agent` tool and `AgentInvoker` seam.

This builds directly on the just-merged "hip as main agent, configured agents as sub-agents" work (the `dispatch_agent` tool, the `AgentInvoker` seam, the nested `SubAgentCard`, nested HITL).

## Decisions (locked)

1. **Internal agent capabilities** — per-agent **tool allow-list** (not a fixed full/read-only split).
2. **Internal agent model** — per-agent bound model (reusing the existing grouped picker), **falling back to the global active model** when unset.
3. **ACP/CLI scope** — beyond labeling, also add **generic ACP creation** (register arbitrary ACP agents from the UI, not just the seeded OpenCode).
4. **Allow-list granularity** — exposed in the editor as **four capability groups**, stored precisely as a `string[]` of tool names.
5. **Add flow** — the Add button opens a **3-item menu** (ACP / CLI / 内部) that opens the editor pre-set to that kind (rather than an in-editor category switcher).
6. **Config shape** — keep `AgentConfig` **flat with optional fields** (matching the existing per-kind-interpreted `AgentForm` pattern); no discriminated-union refactor.

## A. Categories & data model

`AgentConfig.kind` is the single source of category truth:

| Category | `kind` | Runtime |
|---|---|---|
| ACP | `'acp'` (legacy alias `'opencode'`) | `AcpAgentProvider` (external subprocess) |
| CLI | `'custom'` | `LoopAgentProvider` (external subprocess) |
| **Internal** | `'internal'` *(new)* | **hip's built-in ReAct loop** (no external process) |

**Protocol additions** (`packages/protocol/src/index.ts`):

- `AgentConfig.kind` gains `'internal'`.
- `AgentConfig.prompt?: string` — the persona system prompt. Required iff `kind === 'internal'`.
- `AgentConfig.allowedTools?: string[]` — the per-agent tool allow-list (internal only). `undefined` ⇒ the full default set (legacy-safe).
- `boundModel?` is reused for the internal agent's model (already exists).
- `command` / `args` / `transport` / `acceptsModelConfig` / `authMode` / `quirks` are **inert** for internal agents (carried as empty defaults; never read on the internal path).

**Derived helper** (`agentCategory(agent): 'acp' | 'cli' | 'internal'`) — the one place the **UI** computes a category for grouping/badges. Maps `kind`: `'acp'|'opencode' → 'acp'`, `'custom' → 'cli'`, `'internal' → 'internal'`. (The sidecar runtime keys off `kind` directly — it only needs internal-vs-external.)

## B. Internal agent runtime (sidecar) — the core

An internal agent is hip's existing depth-1 sub-agent (`runSubagent`), generalized to take a **custom system prompt + a chosen model + a filtered toolset**.

**`session.ts` dispatch wiring is unchanged.** `runTurn` already collects every enabled agent (kind-agnostic) into the `dispatch_agent` roster and routes delegation through `invoker.invoke(agentId, task, emit, signal, hooks)`. Internal agents flow through automatically. The nested trajectory (`role: 'subagent'`, `parentAgentId: 'supervisor'`), the `SubAgentCard`, and the grouping helpers all render internal agents with **no UI changes**.

The only sidecar seam touched is the **invoker**, which branches on kind:

```ts
// agents/invoker.ts (sketch)
async invoke(agentId, task, emit, signal, hooks) {
  const agent = readAgents().find(a => a.id === agentId && a.enabled)
  if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)
  if (agent.kind === 'internal') {
    const resolved = agent.boundModel ? resolveModel(agent) : null   // null → global active
    return runManagedAgent({
      resolved, cwd, prompt: agent.prompt ?? '', allowedTools: agent.allowedTools,
      task, emit, signal, childMaxSteps: CHILD_MAX_STEPS,
    })
  }
  // external (custom / acp) — UNCHANGED: createProvider + tee tokens → return text
  ...
}
```

Note: the internal branch does **not** tee tokens. `runManagedAgent` streams every event through the supplied `emit` (live card) **and** returns the final assistant text (`lastAiText` of the loop), which is the correct "result to hand back to the supervisor" — distinct from the concatenation of all intermediate narration that token-teeing would produce.

**Two small extractions** keep this clean and avoid a circular import (`agents/` ← imports loop pieces from `session/`, which must not import `agents/invoker.ts`):

1. **`session/model-factory.ts`** *(new)* — lift `ReasoningChatOpenAI` and a `buildChatModel(resolved: {providerID, modelID, baseURL})` factory out of `session.ts`. `session.ts`'s `buildModel` re-uses it. No behavior change for existing sessions.

2. **`session/internal-runner.ts`** *(new)* — `runManagedAgent(args): Promise<string>`:
   - `model = buildChatModel(resolved ?? getActiveModel())`
   - `runner = new RealModelRunner(model)`
   - `tools = filterTools(buildTools(cwd, undefined, cwd), allowedTools)` — base + git, **no `task`/`dispatch_agent`** (depth-1).
   - `app = buildGraph(childMaxSteps)`
   - `app.invoke({ messages: [SystemMessage(buildManagedAgentPrompt({ cwd, persona, toolNames })), HumanMessage(task)], steps: 0, recentSigs: [], nudgedSig: undefined, status: 'running' }, { configurable: { ctx: { runner, tools, emit, summarizer } }, signal, recursionLimit: recursionLimit(childMaxSteps) })`
   - returns `lastAiText(final.messages)` (with the same `awaiting_user` handling as `runSubagent`: return partial text + open-question note, no escalation).
   - `summarizer`: a real summarizer over the global cheap model (extracted alongside `buildChatModel`, or `NOOP_SUMMARIZER` — compaction is unlikely within a single delegated task; **decision: reuse a shared `createSummarizer()` so long internal tasks compact correctly**).

**`buildManagedAgentPrompt({ cwd, persona, toolNames })`** (in `system-prompt.ts`): `IDENTITY` guard + a CHILD_BASE-style operating preamble that enumerates the agent's **actual** `toolNames` (so a read-only agent is told it cannot write) + `cwdBlock(cwd)` + `ANTI_PHANTOM` + the persona `prompt`. Git guidance is appended only when git tools are in `toolNames`.

`createAgentProvider` (index.ts) stays external-only; internal agents never reach it (handled in the invoker). If called with `kind: 'internal'` it throws (defensive).

## C. Tools & the per-agent allow-list

Built-in tool inventory (from `buildTools`): `read_file, ls, glob, grep` · `write_file, edit_file` · `write_todos` · `git_commit, git_create_branch, git_switch_branch` · (`task`, `dispatch_agent` — excluded for internal agents).

Stored precisely as `allowedTools: string[]`. The editor exposes **four capability groups**:

| Group | Tool names | Default |
|---|---|---|
| Read & search | `read_file, ls, glob, grep` | on |
| Edit files | `write_file, edit_file` | on |
| Plan | `write_todos` | on |
| Git | `git_commit, git_create_branch, git_switch_branch` | **off** |

`filterTools(tools, allowedTools)`: if `allowedTools` is `undefined`, keep all; else keep tools whose `name` ∈ `allowedTools`. A new internal agent defaults to Read & search + Edit files + Plan (Git off). The group ⇆ tool-name mapping is a **frontend** constant (`src/lib/agentTools.ts`); the sidecar only filters by name and never needs the mapping.

## D. Model binding

Reuse `groupModelOptions(catalog, config)` for the picker. The form stores a `boundModelKey` (`providerID/modelID`, `''` = none). `buildAgentDraft` maps it to `boundModel` (or omits it). At dispatch, unset `boundModel` ⇒ `getActiveModel()` (global active model).

## E. UI — settings page, editor, cards

**`AgentManagement.tsx`:** built-in **hip** card on top, then three labeled sections (`ACP` / `命令行` / `内部`) computed via `agentCategory`. Each section lists its agents; an empty section shows a one-line hint. The **Add** button opens a 3-item menu (`DropdownMenu`, `modal={false}`) → `ACP 智能体` / `命令行智能体` / `内部智能体`, each opening `AgentEditor` pre-set to that `kind`. (This also fixes the current gap where Add silently only created CLI agents.)

**`AgentEditor.tsx`:** the editor receives an initial `kind` (from the add menu or the edited agent). Category is fixed for the lifetime of the modal (no switching an existing agent's category). Branches:
- **internal**: name, description (when-to-use), **system prompt** (large textarea), model picker (with an explicit "使用全局模型" empty option), four capability toggles. Command/transport/auth hidden.
- **acp**: name, description, **editable** command/args (currently `readOnly` — unlock for generic ACP), transport (default `rich`), auth section (self/managed + model), optional `quirks` field.
- **cli (custom)**: unchanged (command/args/transport/model toggle).

**`AgentCard.tsx`:** a category badge (`ACP` / `命令行` / `内部`). Internal cards show the bound model (or `全局模型`) + a tool-group summary in place of the transport badge.

**`agentDraft.ts`:** `AgentForm` gains `prompt: string` and **four capability-group booleans** (`toolsRead`, `toolsEdit`, `toolsPlan`, `toolsGit`) rather than a raw name array — the UI binds to the booleans. `isAgentDraftValid`: internal requires `name` + non-empty `prompt` (command not required). `buildAgentDraft`: for internal, maps the four booleans → `allowedTools: string[]` (via `agentTools.ts`) and emits `{ kind:'internal', prompt, allowedTools, boundModel?, name, description, enabled }` with inert command/args/transport defaults; never sets auth/quirks. On edit, `allowedTools` is read back into the four booleans (a name present in any group ⇒ that group on; legacy `undefined` ⇒ all on).

## F. Generic ACP creation

The ACP editor branch already exists. Changes: make `command`/`args` editable for ACP; expose `quirks` as an optional field (default empty; an OpenCode quick-fill may pre-set `quirks:'opencode'`). The seeded built-in OpenCode agent remains as a pre-filled default users can keep, edit, or ignore.

## G. Testing (TDD, subagent-driven)

**Sidecar:**
- `runManagedAgent` returns the final assistant text and streams events via `emit`.
- `allowedTools` is enforced: a read-only agent's toolset contains no `write_file`/`edit_file`; an agent cannot mutate the workspace when Edit is off.
- model resolution: `boundModel` set ⇒ uses it; unset ⇒ global active model.
- `invoker.invoke` routes `kind:'internal'` to `runManagedAgent` and external kinds to the provider path.
- one end-to-end integration: supervisor `dispatch_agent` → internal loop → nested `agent:started`/`token`/`agent:finished` → final text returned into the supervisor's answer (reusing the `dispatch-harness`).

**Frontend:**
- `agentCategory` mapping for each kind incl. legacy `'opencode'`.
- `buildAgentDraft` / `isAgentDraftValid` for internal (prompt required; allowedTools mapping; no command).
- capability-group ⇆ tool-name mapping round-trips.
- `AgentManagement` groups agents into the correct sections.

**Paid-test safety:** keep new sidecar suites `describe.skipIf(!apiKey)` or fully mock the model runner (the dispatch-harness already injects a fake model). Never require live DeepSeek.

## H. Non-goals

- No discriminated-union refactor of `AgentConfig`.
- No per-tool (within-group) granularity — capability groups only.
- No nested delegation from internal agents (depth-1).
- No HITL modal for internal agents — hip's built-in tools execute directly, identical to the main agent (consistent, intentional).
- No change to `session.ts` dispatch wiring, the `SubAgentCard`, the grouping helpers, or nested HITL plumbing.

## I. File-touch summary

**Sidecar / protocol:**
- `packages/protocol/src/index.ts` — `kind` += `'internal'`; `prompt?`, `allowedTools?`.
- `packages/sidecar/src/session/model-factory.ts` *(new)* — `ReasoningChatOpenAI`, `buildChatModel`, `createSummarizer`.
- `packages/sidecar/src/session/internal-runner.ts` *(new)* — `runManagedAgent`, `filterTools`.
- `packages/sidecar/src/session/system-prompt.ts` — `buildManagedAgentPrompt`.
- `packages/sidecar/src/session/agents/invoker.ts` — branch on `kind:'internal'`.
- `packages/sidecar/src/session/session.ts` — re-use `model-factory` in `buildModel` (no behavior change).

**Frontend:**
- `src/lib/agentCategory.ts` *(new)* + `src/lib/agentTools.ts` *(new, group↔names)*.
- `src/lib/agentDraft.ts` — internal kind in form/validate/build.
- `src/components/account/AgentManagement.tsx` — sections + 3-item Add menu.
- `src/components/account/AgentEditor.tsx` — internal branch; editable ACP command/args + quirks.
- `src/components/account/AgentCard.tsx` — category badge + internal summary.
- `src/i18n/{en,zh-CN,zh-TW}.ts` — category labels, section headers, internal-editor strings, capability-group names, add-menu items.
