# 智能体工具模型重构 + 对话权限模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 内部智能体内置工具默认全开、只配置 per-Skill + per-MCP-server;输入框新增 Claude-Desktop 式的每对话权限模式(仅对话/编辑目录内/完全放开),运行时门控 hip 自有文件/执行工具与沙箱并级联到子智能体。

**Architecture:** 两部分:(A) 智能体编辑器工具模型——`AgentConfig.allowedSkills/allowedMcpServers` 两字段取代 Slice 8 的 toggle/通配,运行时在 `buildTools` 输入处按需收窄 skills/mcp,内置工具+run_script+use_skill 一律放行;(B) per-session `permissionMode`('chat'|'edit'|'full',默认 'edit'=今天的行为)经 `BuildToolsOpts` 落到 mode-aware 文件解析器 + run_script 的 HITL/自动批准/禁用,并经 invoker 级联到内部子智能体。MCP 工具不受模式影响。

**Tech Stack:** React + TypeScript + Zustand + Radix(前端)/ Node sidecar(LangGraph + LangChain + vitest)/ @hip/protocol(path-mapped 源码,无 build 脚本)。

---

## 规格依据 & 决策

严格遵循已批准 spec:[`docs/superpowers/specs/2026-06-17-agent-tools-and-permission-modes-design.md`](../specs/2026-06-17-agent-tools-and-permission-modes-design.md)(8 条锁定决策)。共 23 个任务,分 4 个切片。承接 `feat/mcp-and-skills-config` 分支(取代其 Slice 8 工具门控)。

## 共享接口契约(贯穿所有任务)

- **协议**:`PermissionMode = 'chat'|'edit'|'full'`;`SessionConfig.permissionMode?`(undefined⇒'edit');`AgentConfig.allowedSkills?: string[]` / `allowedMcpServers?: string[]`(`allowedTools` 保留兼容,不再门控内置);`session:setPermissionMode`(client)/ `session:permissionMode`(server)。
- **sidecar**:`BuildToolsOpts.permissionMode`;chat 省略 write/edit + 不传 requestApproval;edit=现状;full un-jail + 自动批准 `() => ({kind:'allow_once'})`。`Session.setPermissionMode`、`InvokerExtras.permissionMode`、`RunManagedAgentArgs.permissionMode`;内部分支预过滤 skills→allowedSkills、mcpTools→allowedMcpServers,**移除 filterTools**。
- **前端**:`sessionService.setPermissionMode`、reducer `session:permissionMode`、`Draft.permissionMode`、`PermissionModePicker.tsx`(镜像 ModelPicker,已提交会话也可改)、InputBar leftSlot。AgentEditor:Skills 列表 + MCP 服务器列表 + 内置常开说明,移除旧 toggles;`AgentForm.allowedSkills/allowedMcpServers`。

## 推荐构建顺序

1. **切片 1(协议)** 先做,其它依赖类型。
2. **切片 2(sidecar)** 权限模式 + 内部工具运行时(集中改 sidecar 共享文件,按任务顺序)。
3. **切片 3(前端权限 UI)** 与 **切片 4(前端智能体编辑器)** 可并行(分别在 chat/ 与 account/,i18n 附加不冲突)。

> 迁移:老内部智能体的 `allowedTools` 里 `mcp__<id>__*` 通配 → 读取时派生 `allowedMcpServers`;`allowedSkills` 默认空(用户重选)。`permissionMode` 未设⇒'edit'。

---

## Slice 1: Protocol — PermissionMode + agent fields + messages

This slice extends `@hip/protocol` (`packages/protocol/src/index.ts`) with the `PermissionMode` type, the new `SessionConfig.permissionMode?` field, two new `AgentConfig` fields (`allowedSkills?` / `allowedMcpServers?` — keeping `allowedTools` but marking its internal-gating use deprecated), and the `session:setPermissionMode` (client) / `session:permissionMode` (server) messages. A new contract test guards the runtime shapes.

**Critical baseline correction baked into this slice:** vitest runs through esbuild, which **strips all TS types without checking them**. A type-only contract test therefore PASSES even when the types don't exist yet (the imported type names erase to nothing and the annotated literals are plain runtime values). So the real "RED" of TDD for a pure-type protocol change is **`tsc --noEmit` failing**, not vitest failing. Each task's RED step below is a genuine `yarn type-check` failure on a temporary type-assertion guard; the vitest contract file is the GREEN runtime-shape regression guard (mirroring the existing `acp-messages.test.ts` convention, whose own header documents this same limitation).

The protocol package has **no** build/test scripts of its own. Types are verified with root `yarn type-check` (the frontend tsconfig) and `yarn workspace @hip/sidecar type-check` (downstream). The single contract test runs via root `yarn vitest run <path>` — no paid LLM involved.

---

### Task 1: PermissionMode type + SessionConfig.permissionMode field (TDD)

**Files:**
- `packages/protocol/src/permissionMode.contract.test.ts` (NEW)
- `packages/protocol/src/index.ts` (EDIT)

- [ ] **Step 1 (write the RED type guard + the runtime contract test).** Create `packages/protocol/src/permissionMode.contract.test.ts` with EXACTLY this content. Note the `// @ts-expect-error` block near the top: that line is the genuine TDD RED — `tsc` will error there because `PermissionMode` does not exist yet, so `@ts-expect-error` finds nothing to suppress AND the import is unresolved. The `describe` blocks are the runtime-shape regression (these would pass even pre-impl, by design of esbuild — see header note):

```ts
import { describe, it, expect } from 'vitest'
import type { PermissionMode, SessionConfig } from './index.js'

// NOTE on coverage: vitest (esbuild) strips TS types, so the annotations in the `it` blocks below
// are NOT type-checked here — the type CONTRACT is enforced by `tsc` (root `yarn type-check` +
// the sidecar's `tsc --noEmit`). These runtime assertions guard the SHAPE: the three mode literals
// exist and permissionMode survives JSON serialization on SessionConfig (what the WS transport relies on).
//
// TYPE GUARD (checked only by tsc, NOT by vitest): the `satisfies` line below pins PermissionMode to
// exactly the three literals — if a fourth literal is added or one is removed/renamed, `tsc` fails.
const _modeGuard = (['chat', 'edit', 'full'] as const) satisfies readonly PermissionMode[]
void _modeGuard

describe('protocol: PermissionMode', () => {
  it('admits exactly the three mode literals', () => {
    const modes: PermissionMode[] = ['chat', 'edit', 'full']
    expect(modes).toEqual(['chat', 'edit', 'full'])
  })

  it('SessionConfig carries an optional permissionMode that round-trips', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
      permissionMode: 'full',
    }
    const round = JSON.parse(JSON.stringify(cfg)) as SessionConfig
    expect(round.permissionMode).toBe('full')
  })

  it('SessionConfig.permissionMode is optional (undefined ⇒ treated as edit by readers)', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
    }
    expect(cfg.permissionMode).toBeUndefined()
  })
})
```

- [ ] **Step 2 (run RED — confirm `tsc` FAILS).** Because vitest can't see types, prove RED via the type-checker, which is the real contract surface for a type-only change.

  Run: `yarn type-check`
  Expected: the run FAILS (non-zero exit) — `tsc` prints a diagnostic in `packages/protocol/src/permissionMode.contract.test.ts` such as `error TS2305: Module '"./index.js"' has no exported member 'PermissionMode'.` (and/or an error on the `satisfies readonly PermissionMode[]` guard line). Do NOT proceed until you see this failure.

  (Informational, optional — the vitest file by itself will report PASS even now because esbuild erases the missing types; that is expected and is NOT the RED signal. The RED signal is `tsc` above.)

- [ ] **Step 3 (GREEN — add the `PermissionMode` type).** In `packages/protocol/src/index.ts`, find the first line:

```ts
export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer' | 'worker' | 'subagent'
```

  Replace it with:

```ts
export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer' | 'worker' | 'subagent'

/**
 * Per-conversation permission mode (Claude-Desktop style), gating hip's own
 * file/exec tools and sandbox scope at runtime.
 *  - 'chat': read-only (read_file/ls/glob/grep + use_skill + MCP); NO write/edit/run_script; reads jailed to cwd.
 *  - 'edit': DEFAULT — write/edit inside cwd (no HITL), run_script HITL-gated; jailed to cwd.
 *  - 'full': write/edit/read any directory (un-jailed); run_script auto-approved. MCP available in all modes.
 * undefined on an existing SessionConfig ⇒ readers treat it as 'edit' (back-compat, no migration).
 */
export type PermissionMode = 'chat' | 'edit' | 'full'
```

- [ ] **Step 4 (GREEN — add the `permissionMode` field to `SessionConfig`).** In `packages/protocol/src/index.ts`, find:

```ts
  agentId?: string             // undefined / 'builtin' => built-in hip agent; else an AgentConfig.id
}
```

  Replace it with:

```ts
  agentId?: string             // undefined / 'builtin' => built-in hip agent; else an AgentConfig.id
  permissionMode?: PermissionMode  // per-conversation gate; undefined ⇒ treated as 'edit'
}
```

- [ ] **Step 5 (run GREEN — `tsc` now passes; the contract test passes).** Two commands.

  Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
  Expected: both exit 0 with no diagnostics printed (the `@ts-expect-error`/`satisfies` guard now resolves; downstream sidecar still type-checks).

  Run: `yarn vitest run packages/protocol/src/permissionMode.contract.test.ts`
  Expected: the run PASSES — output contains `✓ packages/protocol/src/permissionMode.contract.test.ts`, `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 6 (commit).**

  Run:
  ```
  git add packages/protocol/src/index.ts packages/protocol/src/permissionMode.contract.test.ts
  git commit -m "feat(protocol): add PermissionMode type + SessionConfig.permissionMode

Per-conversation permission gate ('chat'|'edit'|'full'); undefined => 'edit'.
Contract test guards the runtime shape; tsc guards the literal set.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: a commit is created on the current branch (`git commit` prints the new commit hash + summary).

---

### Task 2: AgentConfig.allowedSkills/allowedMcpServers + permission-mode messages (TDD)

**Files:**
- `packages/protocol/src/permissionMode.contract.test.ts` (EDIT — extend with agent-field + message cases + type guards)
- `packages/protocol/src/index.ts` (EDIT)

- [ ] **Step 1 (extend imports).** In `packages/protocol/src/permissionMode.contract.test.ts`, replace the import line:

```ts
import type { PermissionMode, SessionConfig } from './index.js'
```

  with:

```ts
import type {
  PermissionMode,
  SessionConfig,
  AgentConfig,
  ClientMessage,
  ServerMessage,
} from './index.js'
```

- [ ] **Step 2 (add the RED type guards + new runtime describe blocks).** In the SAME file, find the closing of the existing describe block:

```ts
  it('SessionConfig.permissionMode is optional (undefined ⇒ treated as edit by readers)', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
    }
    expect(cfg.permissionMode).toBeUndefined()
  })
})
```

  Replace it with (keep the test you found; append the type guards + two new describe blocks after its closing `})`):

```ts
  it('SessionConfig.permissionMode is optional (undefined ⇒ treated as edit by readers)', () => {
    const cfg: SessionConfig = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
    }
    expect(cfg.permissionMode).toBeUndefined()
  })
})

// TYPE GUARDS (checked only by tsc, NOT by vitest): these pin the new fields + message variants.
// Before impl, `yarn type-check` fails on these lines; after impl it passes.
const _agentGuard: Pick<AgentConfig, 'allowedSkills' | 'allowedMcpServers'> = {
  allowedSkills: ['pdf-tools'],
  allowedMcpServers: ['srv-1'],
}
void _agentGuard
const _setMsgGuard: Extract<ClientMessage, { type: 'session:setPermissionMode' }> = {
  type: 'session:setPermissionMode', sessionId: 's', permissionMode: 'chat',
}
void _setMsgGuard
const _echoMsgGuard: Extract<ServerMessage, { type: 'session:permissionMode' }> = {
  type: 'session:permissionMode', sessionId: 's', permissionMode: 'full',
}
void _echoMsgGuard

describe('protocol: AgentConfig skill/MCP allow-lists', () => {
  it('models an internal agent with allowedSkills + allowedMcpServers', () => {
    const a: AgentConfig = {
      id: 'helper', name: 'Helper', kind: 'internal', command: '', args: [],
      transport: 'rich', acceptsModelConfig: false, enabled: true,
      prompt: 'You help.',
      allowedSkills: ['pdf-tools'],
      allowedMcpServers: ['srv-1'],
    }
    const round = JSON.parse(JSON.stringify(a)) as AgentConfig
    expect(round.allowedSkills).toEqual(['pdf-tools'])
    expect(round.allowedMcpServers).toEqual(['srv-1'])
  })

  it('treats both allow-lists as optional (undefined ⇒ none)', () => {
    const a: AgentConfig = {
      id: 'bare', name: 'Bare', kind: 'internal', command: '', args: [],
      transport: 'rich', acceptsModelConfig: false, enabled: true, prompt: 'p',
    }
    expect(a.allowedSkills).toBeUndefined()
    expect(a.allowedMcpServers).toBeUndefined()
  })

  it('still admits the deprecated allowedTools field (back-compat)', () => {
    const a: AgentConfig = {
      id: 'legacy', name: 'Legacy', kind: 'internal', command: '', args: [],
      transport: 'rich', acceptsModelConfig: false, enabled: true, prompt: 'p',
      allowedTools: ['read_file', 'mcp__srv-1__*'],
    }
    expect(a.allowedTools).toEqual(['read_file', 'mcp__srv-1__*'])
  })
})

describe('protocol: permission-mode control-plane messages', () => {
  it('session:setPermissionMode (client) round-trips', () => {
    const m: ClientMessage = { type: 'session:setPermissionMode', sessionId: 's', permissionMode: 'chat' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'session:setPermissionMode' }>
    expect(rt.type).toBe('session:setPermissionMode')
    expect(rt.sessionId).toBe('s')
    expect(rt.permissionMode).toBe('chat')
  })

  it('session:permissionMode (server) round-trips', () => {
    const m: ServerMessage = { type: 'session:permissionMode', sessionId: 's', permissionMode: 'full' }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'session:permissionMode' }>
    expect(rt.type).toBe('session:permissionMode')
    expect(rt.sessionId).toBe('s')
    expect(rt.permissionMode).toBe('full')
  })
})
```

- [ ] **Step 3 (run RED — confirm `tsc` FAILS).** The new fields/messages don't exist yet, so the three `_…Guard` const declarations cannot type-check.

  Run: `yarn type-check`
  Expected: the run FAILS (non-zero exit) — `tsc` prints diagnostics in `packages/protocol/src/permissionMode.contract.test.ts`, e.g. `error TS2339: Property 'allowedSkills' does not exist on type 'AgentConfig'.` and/or `error TS2678: Type '"session:setPermissionMode"' is not comparable to type ...` (or `Extract<...>` collapsing to `never` so the object literal is not assignable). Do NOT proceed until you see this failure.

  (Informational: `yarn vitest run packages/protocol/src/permissionMode.contract.test.ts` would still report all tests PASS right now — esbuild erases the missing-member annotations — so vitest is NOT the RED signal here. `tsc` above is.)

- [ ] **Step 4 (GREEN — add `allowedSkills` / `allowedMcpServers` and deprecate `allowedTools`'s gating use).** In `packages/protocol/src/index.ts`, find:

```ts
  prompt?: string                     // internal only: the persona system prompt (required for kind 'internal')
  allowedTools?: string[]             // internal only: tool-name allow-list; undefined ⇒ full default set
  enabled: boolean
}
```

  Replace it with:

```ts
  prompt?: string                     // internal only: the persona system prompt (required for kind 'internal')
  /**
   * @deprecated No longer used to gate internal built-in tools (built-ins incl. run_script + use_skill
   * are always available to internal agents). Retained for back-compat with old hip-agents.json configs
   * AND as a one-time migration source: legacy `mcp__<id>__*` wildcards seed `allowedMcpServers` when that
   * field is undefined. New configs should set allowedSkills/allowedMcpServers instead.
   */
  allowedTools?: string[]
  /** internal only: Skill ids this agent may use (use_skill is restricted to these, and only these are
   *  advertised in its prompt). undefined/[] ⇒ none. */
  allowedSkills?: string[]
  /** internal only: MCP server ids whose tools this agent may use. undefined/[] ⇒ none. */
  allowedMcpServers?: string[]
  enabled: boolean
}
```

- [ ] **Step 5 (GREEN — add `session:setPermissionMode` to `ClientMessage`).** In `packages/protocol/src/index.ts`, find:

```ts
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
```

  Replace it with:

```ts
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:setPermissionMode'; sessionId: string; permissionMode: PermissionMode }
```

- [ ] **Step 6 (GREEN — add `session:permissionMode` to `ServerMessage`).** In `packages/protocol/src/index.ts`, find:

```ts
  | { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }
```

  Replace it with:

```ts
  | { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:permissionMode'; sessionId: string; permissionMode: PermissionMode }
```

- [ ] **Step 7 (run GREEN — types compile across root + sidecar).** The deprecated-comment + union additions must not break downstream consumers in this slice.

  Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
  Expected: both exit 0 with no diagnostics (the three `_…Guard` consts now resolve).

  Note on exhaustiveness: adding members to `ClientMessage` / `ServerMessage` does NOT force a `tsc` error unless a downstream `switch` has an explicit `never`-exhaustiveness assertion in its `default`. If `tsc` flags a new `never` / "not assignable to never" error in `packages/sidecar/src/session-manager.ts` or `src/domain/sessionStore.ts`, STOP — that handler is added in its own later slice; record the exact file+line and confirm it is only an unhandled-case widening (an exhaustiveness `default` you must extend later), not a regression introduced by this protocol slice. (If it is such a guard, the slice that adds the handler will satisfy it; do not patch it here.)

- [ ] **Step 8 (run GREEN — the full contract file passes at runtime).**

  Run: `yarn vitest run packages/protocol/src/permissionMode.contract.test.ts`
  Expected: the run PASSES — `✓ packages/protocol/src/permissionMode.contract.test.ts`, `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 9 (commit).**

  Run:
  ```
  git add packages/protocol/src/index.ts packages/protocol/src/permissionMode.contract.test.ts
  git commit -m "feat(protocol): add AgentConfig skill/MCP allow-lists + permission-mode messages

AgentConfig.allowedSkills?/allowedMcpServers? (allowedTools kept, internal-gating
use deprecated + a legacy mcp__<id>__* migration source). New session:setPermissionMode
(client) / session:permissionMode (server). Contract test + tsc type guards added.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: a commit is created (hash + summary printed).

---

Relevant absolute paths for this slice:
- Spec: `/Users/lijiamin/data/my-github/hip/docs/superpowers/specs/2026-06-17-agent-tools-and-permission-modes-design.md`
- Protocol source edited: `/Users/lijiamin/data/my-github/hip/packages/protocol/src/index.ts`
- New test: `/Users/lijiamin/data/my-github/hip/packages/protocol/src/permissionMode.contract.test.ts`
- Pattern references read: `/Users/lijiamin/data/my-github/hip/packages/protocol/src/mcpSkills.contract.test.ts`, `/Users/lijiamin/data/my-github/hip/packages/protocol/src/acp-messages.test.ts`, `/Users/lijiamin/data/my-github/hip/packages/protocol/src/agent-config.test.ts`

Baseline facts verified against the repo for this slice:
- `@hip/protocol/package.json` has NO scripts → verify types via root `yarn type-check` + `yarn workspace @hip/sidecar type-check`; both `type-check` scripts exist and are `tsc --noEmit`.
- Root has the `vitest` bin (`node_modules/.bin/vitest`), so `yarn vitest run <path>` runs a single file with no paid LLM.
- All anchor strings in the EDIT steps (the first `AgentRole` line; the `agentId?` line at end of `SessionConfig`; the `prompt?` / `allowedTools?` / `enabled` block in `AgentConfig`; the `session:setSystemPrompt` client line; the `session:systemPrompt` server line) exist verbatim in the current `index.ts` and are each unique.
- TDD correction (the one substantive fix vs. the draft): vitest/esbuild does not type-check, so a type-only contract file PASSES even before the types exist — the draft's "expect vitest to FAIL" RED steps were not achievable. RED is now a genuine `yarn type-check` failure driven by `satisfies` / `Extract<…>` / `Pick<…>` type guards added to the test file; the vitest round-trip assertions remain as the GREEN runtime-shape regression guard. This mirrors the existing `acp-messages.test.ts` header, which documents the same esbuild-strips-types caveat.

## Slice 2: Sidecar — permission-mode enforcement + internal-agent tool runtime + cascade + migration

This slice implements ALL sidecar changes for both features (agent tool-model refactor + conversation permission modes). It also seeds the protocol types both features depend on (the shared interface contract), since this sidecar slice must compile and test against them. Tasks are sequential; each anchors edits on shown code (line numbers may have shifted).

Baseline facts (verified against the real source 2026-06-17):
- `@hip/protocol` has NO build script → type-check via `yarn type-check` (root) + `yarn workspace @hip/sidecar type-check`.
- Single test file: `yarn vitest run <path>` (esbuild transpile-only — it does NOT cross-check workspace types).
- Sidecar tests live beside the source under `packages/sidecar/src/session/**`.
- `SessionConfig` currently has no `permissionMode`; `AgentConfig` (index.ts lines 48–66) has `allowedTools` but no `allowedSkills`/`allowedMcpServers`.
- `BuildToolsOpts` (tools.ts lines 69–76) currently has `mcpTools`, `skills`, `requestApproval` (no `permissionMode`).
- `internal-runner.ts` (lines 22–80) exports `filterTools` and calls `filterTools(buildTools(...), allowedTools)`; `RunManagedAgentArgs` carries `allowedTools`.
- `invoker.ts` `InvokerExtras`/`RunInternalArgs` (lines 17–40) have `mcpTools`/`skills`/`requestApproval` (no `permissionMode`); the default `runInternal` (line 55) forwards `allowedTools`; the internal branch (lines 64–70) forwards `agent.allowedTools` + extras unfiltered.
- `cwdBlock` is `(cwd) => string` (system-prompt.ts lines 35–42); `SystemPromptInput` (54–58) + `ManagedAgentPromptInput` (83–88) have no `permissionMode`.
- `Session` ctor is `(id, config, model?, store?, titleGenerator?, idleTimeoutMs?, runner?, summarizer?, invokerFactory?)` (session.ts 149–159); `usesEnvModel = !model && !runner`, so a session with an injected `runner` builds NO real model (paid-free).
- `session.ts` runTurn HITL closure + buildTools call + dispatch cascade live at lines 685–748; `setThinking` at 257–262; protocol import at line 1.
- `session-manager.ts` `session:setThinking` case at 107–115; `ensureSession` + `getSessionForTest` both exist.

> Contract reconciliation (load-bearing): `buildTools` registers `run_script` **iff `opts.requestApproval` is present** — it does NOT additionally suppress it by mode. The "chat ⇒ no run_script" semantic is realized by the CALLER (session.ts passes `requestApproval: undefined` in chat mode, which cascades into internal agents). Therefore the unit tests for chat-mode-no-run_script must OMIT `requestApproval` (mirroring the real chat path), NOT pass it and expect suppression.

---


### Task 3: tools.ts — `BuildToolsOpts.permissionMode` + mode-aware path resolver (full un-jail)

**Files:** `packages/sidecar/src/session/tools.ts`, `packages/sidecar/src/session/tools-mode.test.ts` (new)

- [ ] **Step 1:** Write the failing test. Create `packages/sidecar/src/session/tools-mode.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTools } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-toolsmode-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

describe('buildTools permissionMode — registration', () => {
  it("chat mode omits write_file and edit_file but keeps read_file/ls/glob/grep", () => {
    const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'chat' })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('edit_file')
    expect(names).toContain('read_file')
    expect(names).toContain('ls')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
  })

  it("edit mode registers write_file and edit_file", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'edit' }).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })

  it("full mode registers write_file and edit_file", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'full' }).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })

  it("default (no permissionMode) behaves like edit — write/edit present", () => {
    const names = buildTools(root, undefined, root, undefined, {}).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })

  it("an unknown permissionMode value falls back to edit (write/edit present)", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'bogus' as never }).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })
})

describe('buildTools permissionMode — path jail', () => {
  it("edit mode jails write_file to the project root (an absolute path outside root is mapped under root, not created at target)", async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const target = join(outside, 'escaped.txt')
      const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'edit' })
      const out = String(await byName(tools, 'write_file').invoke({ path: target, content: 'X' }))
      // edit treats `path` as relative-to-root; the absolute outside path is mapped under root, NOT created at `target`.
      expect(existsSync(target)).toBe(false)
      expect(out).not.toMatch(/Error/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("full mode writes to an absolute path OUTSIDE the project root as-is", async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const target = join(outside, 'escaped.txt')
      const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
      const out = String(await byName(tools, 'write_file').invoke({ path: target, content: 'HELLO FULL' }))
      expect(out).toMatch(/wrote/)
      expect(existsSync(target)).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('HELLO FULL')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("full mode reads an absolute file OUTSIDE the project root", async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const secret = join(outside, 'secret.txt')
      writeFileSync(secret, 'TOP SECRET', 'utf8')
      const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
      const out = String(await byName(tools, 'read_file').invoke({ path: secret }))
      expect(out).toBe('TOP SECRET')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("full mode resolves a relative path against cwd", async () => {
    const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
    const out = String(await byName(tools, 'write_file').invoke({ path: 'rel.txt', content: 'R' }))
    expect(out).toMatch(/wrote/)
    expect(readFileSync(join(root, 'rel.txt'), 'utf8')).toBe('R')
  })
})
```

- [ ] **Step 2:** Run the new test (expect FAIL — `permissionMode` not in `BuildToolsOpts`, resolver not mode-aware).

Run: `yarn vitest run packages/sidecar/src/session/tools-mode.test.ts`
Expected: FAIL — `chat` still contains `write_file`/`edit_file` (registration assertions fail), and full-mode write lands under `root` (not at `target`), so `existsSync(target)` is false and the read-outside case errors.

- [ ] **Step 3:** Add the `PermissionMode` import. In `packages/sidecar/src/session/tools.ts`, replace the protocol-type import line:

```ts
import type { SkillMeta } from '@hip/protocol'
```

with:

```ts
import type { SkillMeta, PermissionMode } from '@hip/protocol'
```

- [ ] **Step 4:** Add a mode-aware path resolver helper. Directly after the `realInSkill` function (it ends with its closing `}` near line 51), add:

```ts

/** Resolve a model-supplied path in 'full' (un-jailed) mode. Absolute paths are taken AS-IS; relative
 *  paths resolve against `cwd`. No symlink/escape check — 'full' is an explicit "all directories" grant. */
function resolveFull(cwd: string, p: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p)
}
```

- [ ] **Step 5:** Add `permissionMode` to `BuildToolsOpts`. Replace:

```ts
export interface BuildToolsOpts {
  /** Namespaced MCP tools (mcp__<server>__<tool>) merged onto hip's own loop. */
  mcpTools?: StructuredToolInterface[]
  /** Enabled skills — when non-empty, adds the use_skill tool. */
  skills?: SkillMeta[]
  /** When present, adds the HITL-gated run_script tool. */
  requestApproval?: ApprovalFn
}
```

with:

```ts
export interface BuildToolsOpts {
  /** Namespaced MCP tools (mcp__<server>__<tool>) merged onto hip's own loop. */
  mcpTools?: StructuredToolInterface[]
  /** Enabled skills — when non-empty, adds the use_skill tool. */
  skills?: SkillMeta[]
  /** When present, adds the HITL-gated run_script tool. */
  requestApproval?: ApprovalFn
  /** Conversation permission mode. 'chat' = read-only (no write/edit, reads jailed); 'edit' = DEFAULT
   *  (write/edit jailed to root); 'full' = file tools un-jailed (any absolute path). Defaults to 'edit'.
   *  Unknown values are treated as 'edit'. MCP tools + run_script gating are unaffected by mode. */
  permissionMode?: PermissionMode
}
```

- [ ] **Step 6:** Make `buildTools` mode-aware. Replace the head of `buildTools` (the signature + the `skillDirs` line) — currently:

```ts
export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
  opts: BuildToolsOpts = {},
): StructuredToolInterface[] {
  // Enabled-skill dirs (~/.hip/skills/<id>), DISJOINT from the project root. read_file may ALSO reach
  // bundled reference files under these (read-only); every other path stays jailed to `root` via real().
  const skillDirs = (opts.skills ?? []).map((s) => s.dir)
```

with:

```ts
export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
  opts: BuildToolsOpts = {},
): StructuredToolInterface[] {
  // Enabled-skill dirs (~/.hip/skills/<id>), DISJOINT from the project root. read_file may ALSO reach
  // bundled reference files under these (read-only); every other path stays jailed to `root` via real().
  const skillDirs = (opts.skills ?? []).map((s) => s.dir)
  // Mode (default + dirty-data → 'edit'). 'full' un-jails file paths; 'chat' is read-only.
  const mode: PermissionMode = opts.permissionMode === 'chat' || opts.permissionMode === 'full' ? opts.permissionMode : 'edit'
  const isFull = mode === 'full'
  const pathRoot = cwd ?? root
  /** Resolve a model path under the active mode: 'full' un-jails (absolute as-is, relative vs cwd);
   *  otherwise the symlink-guarded jail to `root`. */
  const resolvePath = (p: string): Promise<string> => (isFull ? Promise.resolve(resolveFull(pathRoot, p)) : real(root, p))
```

- [ ] **Step 7:** Route `write_file`/`read_file`/`edit_file`/`ls`/`grep` through `resolvePath`.

In `write_file`, replace:

```ts
        const abs = await real(root, p)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf8')
```

with:

```ts
        const abs = await resolvePath(p)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf8')
```

In `read_file`, replace the jailed branch (the skill bypass ABOVE it is untouched — it stays read-only in all modes):

```ts
      try {
        const abs = await real(root, p)
        return await fs.readFile(abs, 'utf8')
      } catch (err) {
```

with:

```ts
      try {
        const abs = await resolvePath(p)
        return await fs.readFile(abs, 'utf8')
      } catch (err) {
```

In `edit_file`, replace:

```ts
        const abs = await real(root, p)
        const cur = await fs.readFile(abs, 'utf8')
```

with:

```ts
        const abs = await resolvePath(p)
        const cur = await fs.readFile(abs, 'utf8')
```

In `ls`, replace:

```ts
        const abs = await real(root, p ?? '/')
```

with:

```ts
        const abs = await resolvePath(p ?? '/')
```

In `grep`, replace:

```ts
      await walk(await real(root, p ?? '/'))
```

with:

```ts
      await walk(await resolvePath(p ?? '/'))
```

(Leave `glob` as-is: it walks `root` directly and reports paths relative to `root` — it is a project-scoped finder; the un-jail only matters for explicit absolute path access via read/write/ls/grep.)

- [ ] **Step 8:** Omit `write_file`/`edit_file` in chat mode. The base array is currently:

```ts
  const base: StructuredToolInterface[] = [writeFile, readFile, editFile, ls, glob, grep, writeTodos]
```

Replace with:

```ts
  // 'chat' = read-only: drop write_file/edit_file. (read_file/ls/glob/grep + write_todos stay.)
  const base: StructuredToolInterface[] = mode === 'chat'
    ? [readFile, ls, glob, grep, writeTodos]
    : [writeFile, readFile, editFile, ls, glob, grep, writeTodos]
```

- [ ] **Step 9:** Run the new test (expect PASS).

Run: `yarn vitest run packages/sidecar/src/session/tools-mode.test.ts`
Expected: PASS — all cases green (chat omits write/edit, unknown falls back to edit, full un-jails write+read and resolves relative vs cwd, edit still jails).

- [ ] **Step 10:** Run the existing tools tests to confirm no regression (default-mode = today's behavior).

Run: `yarn vitest run packages/sidecar/src/session/tools.test.ts packages/sidecar/src/session/tools-skill-script.test.ts packages/sidecar/src/session/tools.dispatch.test.ts`
Expected: PASS — all existing tools tests still green (default mode unchanged; the `realInSkill` read-only bypass is untouched since it runs before `resolvePath`).

- [ ] **Step 11:** Commit.

Run: `git add packages/sidecar/src/session/tools.ts packages/sidecar/src/session/tools-mode.test.ts && git commit -m "feat(sidecar/tools): permissionMode — chat read-only, full un-jails file paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 4: system-prompt.ts — mode-aware cwdBlock + permissionMode params

**Files:** `packages/sidecar/src/session/system-prompt.ts`, `packages/sidecar/src/session/system-prompt.test.ts`

- [ ] **Step 1:** Add failing tests. Append to `packages/sidecar/src/session/system-prompt.test.ts` (after the last `describe` block closes, before the trailing newline):

```ts

describe('buildSystemPrompt permissionMode-aware cwd block', () => {
  it("edit mode (default) keeps the sandboxed-to-root wording", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', permissionMode: 'edit' })
    expect(s).toMatch(/sandboxed to it/i)
  })
  it("default (no permissionMode) keeps the sandboxed-to-root wording", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toMatch(/sandboxed to it/i)
  })
  it("chat mode says the agent is read-only and cannot write or run scripts", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', permissionMode: 'chat' })
    expect(s).toMatch(/read-only/i)
    expect(s).toMatch(/cannot write/i)
  })
  it("full mode says filesystem tools are NOT sandboxed and may read/write any directory", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', permissionMode: 'full' })
    expect(s).toMatch(/not sandboxed/i)
    expect(s).toMatch(/any directory/i)
  })
})

describe('buildManagedAgentPrompt permissionMode-aware cwd block', () => {
  it("threads chat mode into the managed-agent cwd block (read-only)", () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'], permissionMode: 'chat' })
    expect(p).toMatch(/read-only/i)
  })
  it("threads full mode into the managed-agent cwd block (not sandboxed)", () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'], permissionMode: 'full' })
    expect(p).toMatch(/not sandboxed/i)
  })
})
```

> Note: confirm `system-prompt.test.ts` already imports both `buildSystemPrompt` and `buildManagedAgentPrompt` from `./system-prompt.js`; if `buildManagedAgentPrompt` is not yet imported, add it to the existing import line before running.

- [ ] **Step 2:** Run (expect FAIL — `permissionMode` not accepted; cwdBlock not mode-aware).

Run: `yarn vitest run packages/sidecar/src/session/system-prompt.test.ts`
Expected: FAIL — the new cases find none of the mode-specific wording, and `permissionMode` is not a known property of the input objects.

- [ ] **Step 3:** Implement. In `packages/sidecar/src/session/system-prompt.ts`, add the import. Replace:

```ts
import type { SkillMeta } from '@hip/protocol'
```

with:

```ts
import type { SkillMeta, PermissionMode } from '@hip/protocol'
```

Replace the `cwdBlock` function:

```ts
function cwdBlock(cwd: string): string {
  return (
    `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
    'Address every path as an absolute path starting with `/`, relative to this root — ' +
    `e.g. write to \`/index.html\` (maps to \`${cwd}/index.html\`). ` +
    'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
  )
}
```

with:

```ts
function cwdBlock(cwd: string, permissionMode?: PermissionMode): string {
  if (permissionMode === 'full') {
    return (
      `Your working directory is the project root \`${cwd}\`. Filesystem tools are NOT sandboxed: you ` +
      'may read and write any directory on this machine. Prefer absolute paths; a relative or ' +
      `\`/\`-rooted path resolves against \`${cwd}\`. The user has explicitly granted full filesystem access.`
    )
  }
  if (permissionMode === 'chat') {
    return (
      `Your working directory is the project root \`${cwd}\`. You are in READ-ONLY mode: you cannot write ` +
      'or edit files and cannot run scripts (those tools are not available). Use read_file, ls, glob, and ' +
      'grep to inspect the project. Address every path as an absolute path starting with `/`, relative to ' +
      `this root — e.g. \`/index.html\` (maps to \`${cwd}/index.html\`). Never use a path outside this root.`
    )
  }
  return (
    `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
    'Address every path as an absolute path starting with `/`, relative to this root — ' +
    `e.g. write to \`/index.html\` (maps to \`${cwd}/index.html\`). ` +
    'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
  )
}
```

- [ ] **Step 4:** Thread `permissionMode` into `SystemPromptInput` + `buildSystemPrompt`. Replace:

```ts
export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
  skills?: SkillMeta[]
}

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional skills, user instructions). */
export function buildSystemPrompt({ cwd, userInstructions, skills }: SystemPromptInput): string {
  let base = `${IDENTITY}\n\n${BASE}\n\n${cwdBlock(cwd)}\n\n${GIT_GUIDANCE}\n\n${ANTI_PHANTOM}`
```

with:

```ts
export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
  skills?: SkillMeta[]
  permissionMode?: PermissionMode
}

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional skills, user instructions). */
export function buildSystemPrompt({ cwd, userInstructions, skills, permissionMode }: SystemPromptInput): string {
  let base = `${IDENTITY}\n\n${BASE}\n\n${cwdBlock(cwd, permissionMode)}\n\n${GIT_GUIDANCE}\n\n${ANTI_PHANTOM}`
```

- [ ] **Step 5:** Thread `permissionMode` into `ManagedAgentPromptInput` + `buildManagedAgentPrompt`. Replace:

```ts
export interface ManagedAgentPromptInput {
  cwd: string
  persona: string
  toolNames: string[]
  skills?: SkillMeta[]
}
```

with:

```ts
export interface ManagedAgentPromptInput {
  cwd: string
  persona: string
  toolNames: string[]
  skills?: SkillMeta[]
  permissionMode?: PermissionMode
}
```

Replace the function signature line:

```ts
export function buildManagedAgentPrompt({ cwd, persona, toolNames, skills }: ManagedAgentPromptInput): string {
```

with:

```ts
export function buildManagedAgentPrompt({ cwd, persona, toolNames, skills, permissionMode }: ManagedAgentPromptInput): string {
```

And replace the `parts` seed line:

```ts
  const parts = [IDENTITY, base, cwdBlock(cwd)]
```

with:

```ts
  const parts = [IDENTITY, base, cwdBlock(cwd, permissionMode)]
```

- [ ] **Step 6:** Run (expect PASS).

Run: `yarn vitest run packages/sidecar/src/session/system-prompt.test.ts`
Expected: PASS — all existing prompt tests plus the new mode-aware cases green (default/edit keep "sandboxed to it"; existing ordering tests still match because the edit-mode block still contains "working directory"; `childSystemPrompt` is unaffected — it still calls `cwdBlock(cwd)` with no mode).

- [ ] **Step 7:** Commit.

Run: `git add packages/sidecar/src/session/system-prompt.ts packages/sidecar/src/session/system-prompt.test.ts && git commit -m "feat(sidecar/system-prompt): mode-aware cwd block + permissionMode param

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 5: internal-runner.ts — `RunManagedAgentArgs.permissionMode`, drop `filterTools` + the allowedTools gate

**Files:** `packages/sidecar/src/session/internal-runner.ts`, `packages/sidecar/src/session/internal-runner.test.ts`

> Ordering note: after this task `runManagedAgent`/`RunManagedAgentArgs` no longer carry `allowedTools`, but `invoker.ts` still passes `allowedTools` to `runManagedAgent` (fixed in Task 6). Vitest uses esbuild (transpile-only, no cross-file type-check), so the internal-runner test runs green here; the workspace `yarn type-check` is intentionally NOT run until Task 6 closes the invoker side. Do NOT run a cross-workspace type-check or the invoker suite in this task.

- [ ] **Step 1:** Rewrite the test for the new runtime model (built-ins always on; mode controls write/edit; run_script gates on `requestApproval` presence; skills/mcp pre-filtered by the caller, NOT by `filterTools`). Replace the ENTIRE contents of `packages/sidecar/src/session/internal-runner.test.ts` with:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import { runManagedAgent } from './internal-runner.js'

const dirs: string[] = []
function tmp() { const d = mkdtempSync(join(tmpdir(), 'hip-internal-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = { token: (d) => tokens.push(d), reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
  return { emit, tokens }
}

/** A runner that ignores tools and emits a fixed final answer with no tool calls. */
class TextRunner implements ModelRunner {
  constructor(private readonly text: string) {}
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    opts.onText(this.text)
    return new AIMessage(this.text)
  }
}

/** A runner that records the tool names it was handed, then emits a fixed answer (no tool calls). */
function spyRunner(): { runner: ModelRunner; seen: () => string[] } {
  let names: string[] = []
  return {
    runner: { async run(_m, opts) { names = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') } },
    seen: () => names,
  }
}

describe('runManagedAgent', () => {
  it('runs the loop with the injected runner and returns the final text', async () => {
    const cwd = tmp()
    const { emit, tokens } = collectingEmit()
    const text = await runManagedAgent({
      resolved: null, cwd, prompt: 'You are a tester.',
      task: 'say hi', emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
    })
    expect(text).toBe('done')
    expect(tokens.join('')).toBe('done')
  })
})

describe('runManagedAgent built-in tools always on', () => {
  it("edit mode (default) grants the full built-in set incl. write_file/edit_file/write_todos", async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), 'hello', 'utf8')
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).toContain('read_file')
    expect(seen()).toContain('write_file')
    expect(seen()).toContain('edit_file')
    expect(seen()).toContain('write_todos')
  })

  it("chat mode drops write_file/edit_file (read-only); keeps read_file", async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', permissionMode: 'chat',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).not.toContain('write_file')
    expect(seen()).not.toContain('edit_file')
    expect(seen()).toContain('read_file')
  })

  it("chat mode with NO requestApproval (mirrors the real chat cascade) does not grant run_script", async () => {
    // In the live path session.ts passes requestApproval:undefined for chat, so run_script is never offered.
    // run_script gating is on requestApproval presence, NOT on mode — so we mirror the real cascade here.
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', permissionMode: 'chat',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).not.toContain('run_script')
  })
})

describe('runManagedAgent skills + run_script wiring (no allow-list gate anymore)', () => {
  it('grants use_skill whenever skills are supplied', async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      skills: [{ id: 'fmt', name: 'formatter', description: 'd', dir: cwd, hasScripts: false }],
    })
    expect(seen()).toContain('use_skill')
  })

  it('grants run_script whenever requestApproval is supplied', async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      requestApproval: async () => ({ kind: 'allow_once' }),
    })
    expect(seen()).toContain('run_script')
  })

  it('does not grant run_script when requestApproval is absent', async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).not.toContain('run_script')
  })
})
```

- [ ] **Step 2:** Run (expect FAIL — `permissionMode` not yet a `RunManagedAgentArgs` field, and chat mode still offers write_file/edit_file because the source still narrows via the absent `allowedTools` rather than the mode).

Run: `yarn vitest run packages/sidecar/src/session/internal-runner.test.ts`
Expected: FAIL — the chat-mode case still sees `write_file`/`edit_file` (mode not threaded into `buildTools`), and TS/esbuild surfaces `permissionMode` as an unrecognized arg in the chat cases.

- [ ] **Step 3:** Implement. Rewrite `packages/sidecar/src/session/internal-runner.ts` entirely (removes `filterTools` + its export, removes the `allowedTools` narrowing + field, threads `permissionMode`):

```ts
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit, GraphCtx } from './graph.js'
import { buildGraph } from './graph.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { buildManagedAgentPrompt } from './system-prompt.js'
import { lastAiText } from './subagent.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { getActiveModel } from '../config/providers.js'
import type { Summarizer } from './compaction.js'
import type { ResolvedModel } from './agents/registry.js'
import type { SkillMeta, PermissionMode } from '@hip/protocol'
import type { ApprovalFn } from './tools.js'

export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  task: string
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
  mcpTools?: StructuredToolInterface[]  // namespaced MCP tools, ALREADY narrowed to the agent's allowedMcpServers by the caller
  skills?: SkillMeta[]                  // skills ALREADY narrowed to the agent's allowedSkills by the caller (use_skill candidate)
  requestApproval?: ApprovalFn          // HITL closure threaded from the parent session (run_script); presence decides registration
  permissionMode?: PermissionMode       // cascaded from the parent conversation; default 'edit'
}

/**
 * Run an internal managed agent: hip's built-in ReAct loop with a custom persona prompt and a model of
 * the agent's choosing (or the global active model). Depth-1 (no task/dispatch). ALL built-in tools are
 * always granted (+ run_script when requestApproval is present, + use_skill when skills are present);
 * the per-agent narrowing already happened on the inputs (skills/mcpTools) at the caller. The permission
 * mode controls write/edit registration and the filesystem jail (see buildTools). Streams every event
 * through `emit` and returns the final assistant text.
 */
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const { resolved, cwd, prompt, task, emit, signal, childMaxSteps, mcpTools, skills, requestApproval, permissionMode } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools + skill/script/mcp extras (no task/dispatch closures → depth-1). No allow-list
  // narrowing: built-ins are always on; skills/mcp were pre-filtered by the caller; mode gates write/edit.
  const tools = buildTools(cwd, undefined, cwd, undefined, { mcpTools, skills, requestApproval, permissionMode })
  const toolNames = tools.map((t) => t.name)
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(buildManagedAgentPrompt({ cwd, persona: prompt, toolNames, skills, permissionMode })), new HumanMessage(task)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = final.pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
```

- [ ] **Step 4:** Run (expect PASS).

Run: `yarn vitest run packages/sidecar/src/session/internal-runner.test.ts`
Expected: PASS — built-ins always on in edit mode; chat mode drops write/edit; use_skill/run_script gate on skills/requestApproval presence; no run_script without requestApproval.

- [ ] **Step 5:** Commit (do NOT run `yarn type-check` here — the invoker still passes the now-removed `allowedTools` to `runManagedAgent`; that is fixed in Task 6. The vitest above is the verification for this task).

Run: `git add packages/sidecar/src/session/internal-runner.ts packages/sidecar/src/session/internal-runner.test.ts && git commit -m "feat(sidecar/internal-runner): always-on built-ins + permissionMode; drop filterTools

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 6: invoker.ts — `InvokerExtras.permissionMode` + internal-branch pre-filter (skills/mcp) + legacy migration

**Files:** `packages/sidecar/src/session/agents/invoker.ts`, `packages/sidecar/src/session/agents/invoker-extras.test.ts`, `packages/sidecar/src/session/agents/invoker.test.ts`

This task also restores a green workspace `yarn type-check` (it removes the last `allowedTools` reference that broke the invoker↔runManagedAgent boundary after Task 5).

- [ ] **Step 1:** Add failing tests. Replace the ENTIRE contents of `packages/sidecar/src/session/agents/invoker-extras.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import type { SkillMeta } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit } from '../graph.js'
import { createAgentInvoker, type RunInternalArgs } from './invoker.js'
import type { ApprovalFn } from '../tools.js'

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
const approval: ApprovalFn = async () => ({ kind: 'allow_once' })

const skills: SkillMeta[] = [
  { id: 'fmt', name: 'formatter', description: 'd', dir: '/s/fmt', hasScripts: true },
  { id: 'lint', name: 'linter', description: 'd', dir: '/s/lint', hasScripts: false },
]
function fakeMcp(name: string): StructuredToolInterface { return { name } as unknown as StructuredToolInterface }
const mcpTools: StructuredToolInterface[] = [fakeMcp('mcp__fs__read'), fakeMcp('mcp__fs__write'), fakeMcp('mcp__db__query')]

describe('AgentInvoker pre-filters extras for an internal agent', () => {
  it('narrows skills to agent.allowedSkills and mcpTools to agent.allowedMcpServers', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [
        { id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p', allowedSkills: ['fmt'], allowedMcpServers: ['fs'] } as never,
      ],
      runInternal: async (a) => { captured = a; return 'done' },
    })
    const text = await invoker.invoke('inner', 'do it', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval, permissionMode: 'full' })
    expect(text).toBe('done')
    expect(captured!.skills!.map((s) => s.id)).toEqual(['fmt'])
    expect(captured!.mcpTools!.map((t) => t.name)).toEqual(['mcp__fs__read', 'mcp__fs__write'])
    expect(captured!.requestApproval).toBe(approval)
    expect(captured!.permissionMode).toBe('full')
  })

  it('grants no skills/mcp when the agent has none configured', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [{ id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p' } as never],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    await invoker.invoke('inner', 't', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval })
    expect(captured!.skills).toEqual([])
    expect(captured!.mcpTools).toEqual([])
  })

  it('back-compat: derives allowedMcpServers from legacy allowedTools mcp__<id>__* when undefined', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [
        { id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p', allowedTools: ['read_file', 'mcp__db__*'] } as never,
      ],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    await invoker.invoke('inner', 't', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval })
    // allowedSkills undefined ⇒ none; allowedMcpServers undefined ⇒ derived from the db wildcard.
    expect(captured!.skills).toEqual([])
    expect(captured!.mcpTools!.map((t) => t.name)).toEqual(['mcp__db__query'])
  })

  it('tolerates being called without extras (back-compat)', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [{ id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p' } as never],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    const text = await invoker.invoke('inner', 't', noopEmit, new AbortController().signal)
    expect(text).toBe('ok')
    expect(captured!.skills).toBeUndefined()
    expect(captured!.mcpTools).toBeUndefined()
    expect(captured!.requestApproval).toBeUndefined()
    expect(captured!.permissionMode).toBeUndefined()
  })
})
```

- [ ] **Step 2:** Run (expect FAIL — `permissionMode` not in `InvokerExtras`/`RunInternalArgs`; no pre-filter, so captured skills/mcp are unfiltered).

Run: `yarn vitest run packages/sidecar/src/session/agents/invoker-extras.test.ts`
Expected: FAIL — `captured.skills` is the full 2-skill array (not narrowed), `captured.mcpTools` is the full 3-tool array, and `permissionMode` is not a known property.

- [ ] **Step 3:** Implement. Rewrite `packages/sidecar/src/session/agents/invoker.ts` entirely:

```ts
import type { AgentConfig, SkillMeta, PermissionMode } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ApprovalFn } from '../tools.js'
import type { GraphEmit } from '../graph.js'
import { runManagedAgent } from '../internal-runner.js'
import { CHILD_MAX_STEPS } from '../loop-control.js'
import { createAgentProvider } from './index.js'
import { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'

/** Per-turn capabilities the parent session threads into an internal sub-agent's loop. */
export interface InvokerExtras {
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
}

export interface AgentInvoker {
  invoke(agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks, extras?: InvokerExtras): Promise<string>
}

/** Args handed to the internal-loop runner (a seam so tests can stub the loop). skills/mcpTools are
 *  ALREADY narrowed to the agent's allowedSkills/allowedMcpServers before they reach here. */
export interface RunInternalArgs {
  agentId: string
  resolved: ResolvedModel | null
  cwd: string
  prompt: string
  task: string
  emit: GraphEmit
  signal: AbortSignal
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
}

export interface InvokerDeps {
  readAgents?: () => AgentConfig[]
  createProvider?: (agent: AgentConfig, cwd: string, model: ResolvedModel | null) => AgentProvider
  resolveModel?: (agent: AgentConfig) => ResolvedModel | null
  runInternal?: (args: RunInternalArgs) => Promise<string>
}

/** Parse server ids from legacy `allowedTools` wildcards of the form `mcp__<id>__*` (back-compat). */
function grantedMcpServerIdsFromLegacy(allowedTools?: string[]): string[] {
  if (!allowedTools) return []
  const ids: string[] = []
  for (const a of allowedTools) {
    const m = /^mcp__(.+)__\*$/.exec(a)
    if (m && !ids.includes(m[1])) ids.push(m[1])
  }
  return ids
}

/** Resolve the agent's effective MCP server allow-list: explicit allowedMcpServers, else (back-compat)
 *  the legacy allowedTools `mcp__<id>__*` wildcards, else []. */
function effectiveMcpServers(agent: AgentConfig): string[] {
  if (agent.allowedMcpServers !== undefined) return agent.allowedMcpServers
  return grantedMcpServerIdsFromLegacy(agent.allowedTools)
}

export function createAgentInvoker(cwd: string, deps: InvokerDeps = {}): AgentInvoker {
  const readAgents = deps.readAgents ?? readAgentsConfig
  const createProvider = deps.createProvider ?? createAgentProvider
  const resolveModel = deps.resolveModel ?? resolveAgentModel
  const runInternal = deps.runInternal ?? ((a: RunInternalArgs) =>
    runManagedAgent({
      resolved: a.resolved, cwd: a.cwd, prompt: a.prompt, task: a.task,
      emit: a.emit, signal: a.signal, childMaxSteps: CHILD_MAX_STEPS,
      mcpTools: a.mcpTools, skills: a.skills, requestApproval: a.requestApproval, permissionMode: a.permissionMode,
    }))
  return {
    async invoke(agentId, task, emit, signal, hooks, extras) {
      const agent = readAgents().find((a) => a.id === agentId && a.enabled)
      if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)

      if (agent.kind === 'internal') {
        // hip's own loop — no external provider, no token-teeing (runManagedAgent returns the final text).
        // Per-agent narrowing happens HERE on the inputs: built-ins are always on (no allowedTools gate);
        // only the skills/mcp tools the agent was granted are passed through. When extras are absent
        // (back-compat callers), skills/mcpTools stay undefined ⇒ runManagedAgent grants neither.
        const allowedSkills = agent.allowedSkills ?? []
        const serverIds = effectiveMcpServers(agent)
        const narrowedSkills = extras?.skills?.filter((s) => allowedSkills.includes(s.id))
        const narrowedMcp = extras?.mcpTools?.filter((t) => serverIds.some((id) => t.name.startsWith(`mcp__${id}__`)))
        return runInternal({
          agentId, resolved: resolveModel(agent), cwd, prompt: agent.prompt ?? '',
          task, emit, signal,
          mcpTools: narrowedMcp, skills: narrowedSkills,
          requestApproval: extras?.requestApproval, permissionMode: extras?.permissionMode,
        })
      }

      // Model rollback (spec §D): every agent reaching this line is external (the internal branch
      // returned above) and self-manages its own model — ACP & CLI agents never receive a hip model.
      // Mirrors session.ts (`const model = null`). resolveModel is left injectable for the internal
      // branch only; resolving here would be dead work that contradicts the UI promise.
      const model = null
      const provider = createProvider(agent, cwd, model)
      let text = ''
      // Tee token deltas so we can return the final text while still forwarding
      // every event to the caller's sink (the dispatch tool-card).
      const teed: GraphEmit = {
        token: (d) => { text += d; emit.token(d) },
        reasoning: emit.reasoning,
        toolStarted: emit.toolStarted,
        toolFinished: emit.toolFinished,
        usage: emit.usage,
      }
      try {
        await provider.runTurn(task, teed, signal, hooks)
        return text
      } finally {
        provider.dispose()
      }
    },
  }
}
```

- [ ] **Step 4:** Run (expect PASS).

Run: `yarn vitest run packages/sidecar/src/session/agents/invoker-extras.test.ts`
Expected: PASS — skills narrowed to `['fmt']`, mcp narrowed to the `fs` server tools, `permissionMode` forwarded, legacy wildcard derives the `db` server, no-extras stays undefined.

- [ ] **Step 5:** Fix the existing `invoker.test.ts` internal-agent test that asserts `allowedTools` round-trips through `RunInternalArgs` (that field is now gone). Open `packages/sidecar/src/session/agents/invoker.test.ts` and replace the test:

```ts
  it('routes an internal agent to runInternal with the resolved model + allowlist, returns its text', async () => {
    const seen: { agentId?: string; task?: string; resolved?: unknown; allowedTools?: string[]; prompt?: string } = {}
    const internalAgent: AgentConfig = {
      id: 'rev', name: 'Reviewer', kind: 'internal', command: '', args: [], transport: 'thin',
      acceptsModelConfig: false, enabled: true, prompt: 'review carefully', allowedTools: ['read_file'],
      boundModel: { providerID: 'p', modelID: 'm' },
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => ({ providerID: 'p', modelID: 'm', baseURL: 'u' }),
      createProvider: () => { throw new Error('internal must NOT build a provider') },
      runInternal: async (a) => { seen.agentId = a.agentId; seen.task = a.task; seen.resolved = a.resolved; seen.allowedTools = a.allowedTools; seen.prompt = a.prompt; a.emit.token('R'); return 'reviewed' },
    })
    const { emit, tokens } = collectingEmit()
    const text = await invoker.invoke('rev', 'do review', emit, new AbortController().signal)
    expect(text).toBe('reviewed')
    expect(tokens.join('')).toBe('R')
    expect(seen).toMatchObject({ agentId: 'rev', task: 'do review', resolved: { providerID: 'p', modelID: 'm', baseURL: 'u' }, allowedTools: ['read_file'], prompt: 'review carefully' })
  })
```

with (drops the retired `allowedTools` field; asserts the model + persona route through, which is the live behavior):

```ts
  it('routes an internal agent to runInternal with the resolved model + persona, returns its text', async () => {
    const seen: { agentId?: string; task?: string; resolved?: unknown; prompt?: string } = {}
    const internalAgent: AgentConfig = {
      id: 'rev', name: 'Reviewer', kind: 'internal', command: '', args: [], transport: 'thin',
      acceptsModelConfig: false, enabled: true, prompt: 'review carefully',
      boundModel: { providerID: 'p', modelID: 'm' },
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => ({ providerID: 'p', modelID: 'm', baseURL: 'u' }),
      createProvider: () => { throw new Error('internal must NOT build a provider') },
      runInternal: async (a) => { seen.agentId = a.agentId; seen.task = a.task; seen.resolved = a.resolved; seen.prompt = a.prompt; a.emit.token('R'); return 'reviewed' },
    })
    const { emit, tokens } = collectingEmit()
    const text = await invoker.invoke('rev', 'do review', emit, new AbortController().signal)
    expect(text).toBe('reviewed')
    expect(tokens.join('')).toBe('R')
    expect(seen).toMatchObject({ agentId: 'rev', task: 'do review', resolved: { providerID: 'p', modelID: 'm', baseURL: 'u' }, prompt: 'review carefully' })
  })
```

- [ ] **Step 6:** Run the full invoker suite + workspace type-check (now green again — the `allowedTools` boundary is gone).

Run: `yarn vitest run packages/sidecar/src/session/agents/invoker.test.ts packages/sidecar/src/session/agents/invoker-extras.test.ts`
Expected: PASS — both suites green.

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: both exit 0, no output (the Task 5 `allowedTools` mismatch is resolved; protocol additions + all threading compile).

- [ ] **Step 7:** Commit.

Run: `git add packages/sidecar/src/session/agents/invoker.ts packages/sidecar/src/session/agents/invoker-extras.test.ts packages/sidecar/src/session/agents/invoker.test.ts && git commit -m "feat(sidecar/invoker): pre-filter skills/mcp per agent + cascade permissionMode + legacy mcp migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 7: session.ts — runTurn mode → requestApproval construction + buildTools/system-prompt threading + cascade + setPermissionMode

**Files:** `packages/sidecar/src/session/session.ts`

This changes runtime wiring inside `runTurn` (the behavior is exercised end-to-end in Task 10). Here we make the structural change and verify it type-checks + the existing session suites stay green.

- [ ] **Step 1:** Add the `PermissionMode` import. Replace the protocol import line:

```ts
import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage, DiffBase, DiffFile, DiffState, Checkpoint, CommitLogEntry, CheckpointMode, Branch } from '@hip/protocol'
```

with:

```ts
import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage, DiffBase, DiffFile, DiffState, Checkpoint, CommitLogEntry, CheckpointMode, Branch, PermissionMode } from '@hip/protocol'
```

- [ ] **Step 2:** Compute the mode + branch `requestApproval` per mode. In `runTurn`, find the existing HITL closure block:

```ts
    const options = [
      { optionId: 'allow_once', name: '允许', kind: 'allow_once' },
      { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
    ]
    const requestApproval: ApprovalFn = (req) =>
      new Promise((resolve) => {
        const requestId = `run-script-${turnId}-${nextSeq()}`
        this.pendingPermissions.set(requestId, (choice) => {
          if ('cancelled' in choice) { resolve({ cancelled: true }); return }
          // Fail CLOSED: an unrecognized optionId must never approve (isApproved keys off
          // kind.startsWith('allow'), so echoing an 'allow'-prefixed bogus id would auto-approve).
          const kind = options.find((o) => o.optionId === choice.optionId)?.kind ?? 'reject_once'
          resolve({ kind })
        })
        send({
          type: 'permission:request',
          sessionId: this.id,
          turnId,
          requestId,
          tool: { title: req.title, kind: req.kind, content: req.content },
          options,
        })
      })
```

Replace it with (compute `mode`, define the real HITL closure, then pick the per-mode `requestApproval`):

```ts
    const options = [
      { optionId: 'allow_once', name: '允许', kind: 'allow_once' },
      { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
    ]
    // Conversation permission mode (default + dirty-data → 'edit'). Drives run_script approval AND the
    // file-tool jail/registration (threaded into buildTools below), and CASCADES into dispatched agents.
    const rawMode = this._config.permissionMode
    const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
    // Real HITL closure (edit mode): register a pending permission and resolve on the user's choice.
    const hitlApproval: ApprovalFn = (req) =>
      new Promise((resolve) => {
        const requestId = `run-script-${turnId}-${nextSeq()}`
        this.pendingPermissions.set(requestId, (choice) => {
          if ('cancelled' in choice) { resolve({ cancelled: true }); return }
          // Fail CLOSED: an unrecognized optionId must never approve (isApproved keys off
          // kind.startsWith('allow'), so echoing an 'allow'-prefixed bogus id would auto-approve).
          const kind = options.find((o) => o.optionId === choice.optionId)?.kind ?? 'reject_once'
          resolve({ kind })
        })
        send({
          type: 'permission:request',
          sessionId: this.id,
          turnId,
          requestId,
          tool: { title: req.title, kind: req.kind, content: req.content },
          options,
        })
      })
    // Per-mode run_script gate: chat ⇒ no run_script (undefined → buildTools omits it); edit ⇒ HITL;
    // full ⇒ auto-approve (resolve immediately, no permission:request, no modal). Cascades to dispatched agents.
    const requestApproval: ApprovalFn | undefined =
      mode === 'chat' ? undefined
      : mode === 'full' ? (() => Promise.resolve({ kind: 'allow_once' }))
      : hitlApproval
```

- [ ] **Step 3:** Thread `permissionMode` into `buildSystemPrompt`. Replace:

```ts
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt, skills })
```

with:

```ts
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt, skills, permissionMode: mode })
```

- [ ] **Step 4:** Thread `permissionMode` into the main `buildTools` call. Replace:

```ts
    const tools = buildTools(
      cwd,
      spawnSubagent,
      this._config.cwd,
      enabledAgents.length
        ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent }
        : undefined,
      { mcpTools: mcpManager.tools(), skills, requestApproval },
    )
```

with:

```ts
    const tools = buildTools(
      cwd,
      spawnSubagent,
      this._config.cwd,
      enabledAgents.length
        ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent }
        : undefined,
      { mcpTools: mcpManager.tools(), skills, requestApproval, permissionMode: mode },
    )
```

- [ ] **Step 5:** Cascade `permissionMode` into dispatched agents. In `dispatchAgent`, replace the invoker call:

```ts
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks, { mcpTools: mcpManager.tools(), skills, requestApproval })
```

with:

```ts
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks, { mcpTools: mcpManager.tools(), skills, requestApproval, permissionMode: mode })
```

> Note: `ApprovalFn | undefined` now flows into `InvokerExtras.requestApproval` (optional) and the `buildTools` opts (`requestApproval?`). Both already accept `undefined`, so chat mode (undefined) cascades correctly and internal agents in chat get no run_script.

- [ ] **Step 6:** Add `Session.setPermissionMode` (mirror `setThinking`). Directly after the existing `setThinking` method:

```ts
  /** Toggle the thinking (reasoner) model and rebuild the agent. NO-OP (returns false) while a turn is running. */
  setThinking(thinking: boolean): boolean {
    if (this.running) return false
    this._config = { ...this._config, thinking }
    this.buildAgent()
    return true
  }
```

add:

```ts

  /** Set the per-conversation permission mode. NO-OP (returns false) while a turn is running; the
   *  next runTurn picks it up (no agent rebuild needed — runTurn reads _config.permissionMode). */
  setPermissionMode(permissionMode: PermissionMode): boolean {
    if (this.running) return false
    this._config = { ...this._config, permissionMode }
    return true
  }
```

- [ ] **Step 7:** Verify types compile. (Carrying `draft.permissionMode` into `SessionConfig` on create is a frontend concern handled in another slice; no session.ts change is needed here.)

Run: `yarn workspace @hip/sidecar type-check`
Expected: exit 0, no output.

- [ ] **Step 8:** Run the session unit + a dispatch integration suite (no regression; default mode = today's wiring).

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts packages/sidecar/src/session/dispatch-internal.integration.test.ts`
Expected: PASS — existing behavior unchanged (mode defaults to 'edit', so `requestApproval` is the same HITL closure as before, and the dispatch cascade passes `permissionMode: 'edit'`).

- [ ] **Step 9:** Commit.

Run: `git add packages/sidecar/src/session/session.ts && git commit -m "feat(sidecar/session): runTurn permissionMode → requestApproval + buildTools + cascade; setPermissionMode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 8: Session.setPermissionMode unit tests (mirror setThinking)

**Files:** `packages/sidecar/src/session/session-unit.test.ts`

- [ ] **Step 1:** Add tests. In `packages/sidecar/src/session/session-unit.test.ts`, after the `describe('Session.setSystemPrompt', …)` block closes (the `})` on the line before `describe('Session message:complete agentRuns', …)`), add:

```ts

describe('Session.setPermissionMode', () => {
  it('returns true and updates config when idle', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-pm-idle', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    expect(session.setPermissionMode('full')).toBe(true)
    expect(session.config.permissionMode).toBe('full')
  })
  it('can set chat mode', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-pm-chat', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    expect(session.setPermissionMode('chat')).toBe(true)
    expect(session.config.permissionMode).toBe('chat')
  })
  it('returns false and leaves config unchanged while a turn is running', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-pm-running', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], permissionMode: 'edit' }, model)
    ;(session as unknown as { running: boolean }).running = true
    expect(session.setPermissionMode('full')).toBe(false)
    expect(session.config.permissionMode).toBe('edit')
  })
})
```

- [ ] **Step 2:** Run (expect PASS — `setPermissionMode` was added in Task 7).

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS — the three new cases plus all existing session-unit cases green.

- [ ] **Step 3:** Commit.

Run: `git add packages/sidecar/src/session/session-unit.test.ts && git commit -m "test(sidecar/session): Session.setPermissionMode unit tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 9: session-manager.ts — `session:setPermissionMode` handler (mirror setThinking)

**Files:** `packages/sidecar/src/session/session-manager.ts`, `packages/sidecar/src/session/session-manager-persist.test.ts`

- [ ] **Step 1:** Add tests. In `packages/sidecar/src/session/session-manager-persist.test.ts`, after the `session:setSystemPrompt echoes session:systemPrompt with the real state` test closes (its `})`), add (inside the same `describe('SessionManager persistence', …)` block, so `mgr`/`cfg`/`store`/`send`/`sent`/`getSessionForTest` are in scope):

```ts

  it('session:setPermissionMode persists permissionMode into the session config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' }, send)
    expect(JSON.parse(store.getSession('s1')!.config).permissionMode).toBe('full')
  })

  it('session:setPermissionMode echoes session:permissionMode with the real state', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'chat' }, send)
    const echo = sent.find((m) => m.type === 'session:permissionMode') as Extract<ServerMessage, { type: 'session:permissionMode' }>
    expect(echo).toMatchObject({ sessionId: 's1', permissionMode: 'chat' })
  })

  it('session:setPermissionMode echoes the default edit when the set is rejected mid-turn', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    // simulate a rejected set mid-turn: the session keeps its (undefined) mode → echo 'edit'.
    const s = mgr.getSessionForTest('s1')!
    ;(s as unknown as { running: boolean }).running = true
    sent = []
    mgr.handle({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' }, send)
    const echo = sent.find((m) => m.type === 'session:permissionMode') as Extract<ServerMessage, { type: 'session:permissionMode' }>
    expect(echo).toMatchObject({ sessionId: 's1', permissionMode: 'edit' })
  })
```

- [ ] **Step 2:** Run (expect FAIL — no `session:setPermissionMode` case in the handler switch; nothing persisted, no echo emitted).

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: FAIL — `permissionMode` not persisted (undefined), no `session:permissionMode` echo found.

- [ ] **Step 3:** Implement. In `packages/sidecar/src/session/session-manager.ts`, find the `session:setThinking` case:

```ts
      case 'session:setThinking': {
        const s = this.ensureSession(msg.sessionId)
        const applied = s.setThinking(msg.thinking)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        // Echo the session's REAL thinking state (true by default) so the client syncs to truth
        // even if the toggle was rejected mid-turn.
        send({ type: 'session:thinking', sessionId: msg.sessionId, thinking: s.config.thinking ?? true })
        break
      }
```

Add directly after it (before `case 'session:setSystemPrompt'`):

```ts
      case 'session:setPermissionMode': {
        const s = this.ensureSession(msg.sessionId)
        const applied = s.setPermissionMode(msg.permissionMode)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        // Echo the session's REAL mode (default 'edit') so the client syncs to truth even if the set
        // was rejected mid-turn.
        send({ type: 'session:permissionMode', sessionId: msg.sessionId, permissionMode: s.config.permissionMode ?? 'edit' })
        break
      }
```

- [ ] **Step 4:** Run (expect PASS).

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: PASS — persists 'full', echoes 'chat', and echoes the default 'edit' on a mid-turn rejection.

- [ ] **Step 5:** Commit.

Run: `git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-persist.test.ts && git commit -m "feat(sidecar/session-manager): session:setPermissionMode handler (persist + echo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 10: Integration — full-mode auto-approve + chat-mode read-only + edit-mode HITL through runTurn

**Files:** `packages/sidecar/src/session/session-permission-mode.integration.test.ts` (new)

This proves the end-to-end runTurn wiring: 'full' runs run_script with NO `permission:request` emitted; 'chat' never even exposes run_script/write_file/edit_file to the model; 'edit' offers all three.

- [ ] **Step 1:** Inspect the existing integration harness so the new test mirrors the model-runner/Session patterns (the `ModelRunner` injection seam + the send-collector Session pattern).

Run: `yarn vitest run packages/sidecar/src/session/dispatch-internal.integration.test.ts --reporter=dot`
Expected: PASS (baseline green) — read this file's setup to confirm the injected-`ModelRunner` + `new Session(..., runner)` pattern before writing the new test.

- [ ] **Step 2:** Write the integration test. Create `packages/sidecar/src/session/session-permission-mode.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, SessionConfig, PermissionMode } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'

let cwd: string
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'hip-pm-int-')) })
afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

/** A runner that on its FIRST call invokes one tool (by name, with the given args) for its side-effect,
 *  then finishes the turn with a text answer (no tool_calls). Records the tool names it was offered. */
class OneToolThenDone implements ModelRunner {
  public offered: string[][] = []
  constructor(private readonly toolName: string, private readonly args: Record<string, unknown>) {}
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.offered.push(opts.tools.map((t) => t.name))
    const target = opts.tools.find((t) => t.name === this.toolName)
    if (target) await target.invoke(this.args as never)
    opts.onText('done')
    return new AIMessage('done')
  }
}

// Session ctor: (id, config, model?, store?, titleGenerator?, idleTimeoutMs?, runner?). Passing a runner
// (and no model) means usesEnvModel === false → NO real model is built → paid-free.
function run(config: SessionConfig, runner: ModelRunner): Promise<ServerMessage[]> {
  const events: ServerMessage[] = []
  const session = new Session('pm-int', config, undefined, undefined, undefined, undefined, runner)
  return session.sendMessage('go', (m) => events.push(m)).then(() => events)
}

const base = (permissionMode?: PermissionMode): SessionConfig => ({
  llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, permissionMode,
})

describe('permission mode end-to-end through runTurn', () => {
  it('full mode runs run_script WITHOUT emitting a permission:request', async () => {
    const marker = join(cwd, 'full-marker.txt')
    const runner = new OneToolThenDone('run_script', { command: `touch ${marker}`, reason: 'integration probe' })
    const events = await run(base('full'), runner)
    // run_script was offered (full passes an auto-approve closure → buildTools registers it).
    expect(runner.offered[0]).toContain('run_script')
    // Auto-approve: no HITL modal was ever requested.
    expect(events.some((e) => e.type === 'permission:request')).toBe(false)
    // The script actually ran (auto-approved).
    expect(existsSync(marker)).toBe(true)
  })

  it('chat mode never offers run_script / write_file / edit_file to the model', async () => {
    const runner = new OneToolThenDone('read_file', { path: '/nope.txt' })
    await run(base('chat'), runner)
    expect(runner.offered[0]).not.toContain('run_script')
    expect(runner.offered[0]).not.toContain('write_file')
    expect(runner.offered[0]).not.toContain('edit_file')
    expect(runner.offered[0]).toContain('read_file')
  })

  it('edit mode (default) offers run_script (HITL-gated), write_file and edit_file', async () => {
    const runner = new OneToolThenDone('read_file', { path: '/nope.txt' })
    await run(base(), runner)
    expect(runner.offered[0]).toContain('run_script')
    expect(runner.offered[0]).toContain('write_file')
    expect(runner.offered[0]).toContain('edit_file')
  })
})
```

- [ ] **Step 3:** Run (expect PASS — the Task 7 runTurn wiring makes full auto-approve, chat read-only, edit HITL).

Run: `yarn vitest run packages/sidecar/src/session/session-permission-mode.integration.test.ts`
Expected: PASS — full runs the script with no `permission:request`; chat omits run_script/write_file/edit_file; edit offers all three.

> If the `OneToolThenDone` runner's direct `target.invoke(...)` side-effect does not drive the turn the way `dispatch-internal.integration.test.ts` constructs its runner (e.g. the loop expects a real tool_call), copy that file's exact `ModelRunner` shape (read in Step 1) and re-run. The assertions (offered tool names + no `permission:request` + marker file) stay identical — only the runner's mechanism for triggering the tool changes.

- [ ] **Step 4:** Commit.

Run: `git add packages/sidecar/src/session/session-permission-mode.integration.test.ts && git commit -m "test(sidecar): permission-mode end-to-end (full auto-approve, chat read-only, edit HITL)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: one commit created.

---

### Task 11: Full sidecar verification — type-check + paid-free test sweep

**Files:** none (verification only)

- [ ] **Step 1:** Type-check root + sidecar.

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: both exit 0, no output. (Confirms the protocol additions, the retired `filterTools`/`allowedTools`, and all threading compile cleanly across the workspace.)

- [ ] **Step 2:** Confirm nothing in the repo still references the retired `filterTools` (its only caller was internal-runner.ts, replaced in Task 5; its only test block was removed in Task 5).

Run: `grep -rn "filterTools" packages/sidecar/src`
Expected: NO matches. If any remain, remove them and re-run before proceeding.

- [ ] **Step 3:** Run the full sidecar test directory PAID-FREE. Move auth.json aside so no real-LLM suite fires (per the repo trap), run, then ALWAYS restore.

Run:
```
test -f ~/.hip/config/auth.json && mv ~/.hip/config/auth.json ~/.hip/config/auth.json.slice10bak || true
yarn vitest run packages/sidecar/src
RC=$?
test -f ~/.hip/config/auth.json.slice10bak && mv ~/.hip/config/auth.json.slice10bak ~/.hip/config/auth.json || true
exit $RC
```
Expected: all sidecar suites PASS (paid real-LLM suites self-skip with no key). 0 failures. auth.json restored.

- [ ] **Step 4:** Final status check / cleanup commit.

Run: `git status --porcelain`
Expected: empty (all work already committed). If Step 2 forced a cleanup edit, commit it:

Run: `git add -A && git commit -m "chore(sidecar): remove last filterTools reference

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
Expected: either "nothing to commit" or one cleanup commit.
```

I verified every anchor against the live source and corrected the draft's defects. Key fixes:

- **Contract violation removed (most important):** the draft's Task 5 chat-mode test passed `requestApproval` and asserted `run_script` was absent — but `buildTools` gates `run_script` solely on `requestApproval` presence (NOT on mode), so that test would FAIL. Split it into a contract-true case that omits `requestApproval` (mirroring the real chat cascade where session.ts passes `undefined`), with an explicit comment.
- **Ordering/type-check bug fixed:** after Task 5 drops `allowedTools` from `RunManagedAgentArgs`, `invoker.ts` still passes it → workspace `yarn type-check` is red until Task 6. The draft's Task 5 Step 5 wrongly ran the invoker suite and claimed PASS. Removed that, added an explicit "vitest is esbuild transpile-only; defer cross-workspace type-check to Task 6" note, and moved the green `yarn type-check` into Task 6 Step 6.
- **No-op/hand-wave removed:** Task 3 Step 3's "replace `import fs` with the same line (unchanged)" dead step was deleted; renumbered the real edits.
- **Anchors corrected to live source:** Task 7 split into import-first then HITL-block (matches session.ts line 1 + 685–707); Task 8 insertion point clarified ("before `Session message:complete agentRuns`"); Task 9 tests moved inside the `describe('SessionManager persistence')` block (so `mgr`/`cfg`/`getSessionForTest` are in scope).
- **Coverage hardened:** added an "unknown permissionMode → edit fallback" tools test; added `import buildManagedAgentPrompt` guard note for system-prompt.test.ts; tightened FAIL/PASS reasons; added the `ApprovalFn | undefined` flow note for the cascade.

Verified-correct and kept as-is: Task 10's `Session(id, config, undefined×4, runner)` ctor positions (runner is 7th arg → `usesEnvModel=false`, paid-free), the `read_file` skill-bypass-before-resolvePath ordering, the legacy `mcp__<id>__*` migration regex, and the invoker.test.ts replacement block (matches lines 99–117 exactly).

## Slice 3: Frontend — permission-mode composer UI + per-session plumbing

This slice wires the per-conversation **permission mode** (`'chat' | 'edit' | 'full'`) through the frontend: the sessionStore reducer, `sessionService.setPermissionMode`, the draft field + `configFromDraft` carry-through, a new `PermissionModePicker` composer chip (editable in committed sessions, unlike the locked `ModelPicker`), its placement in `InputBar`, and i18n in all three locales.

The protocol types/messages (`PermissionMode`, `SessionConfig.permissionMode`, `session:setPermissionMode`/`session:permissionMode`) are provided by **Slice 1 (Tasks 1-2)** — this slice depends on them being present (build order runs Slice 1 first). All anchors below were confirmed against the current files.

All commands run from the repo root `/Users/lijiamin/data/my-github/hip`. Single-file test command is `yarn vitest run <path>`. The full `yarn test` fires PAID suites unless `~/.hip/config/auth.json` is moved aside first — **this slice never runs the full suite; every test here is a pure store/service/logic test driven by `FakeTransport` or a direct reducer call, no model is hit.** Type-check is `yarn type-check` (root, covers `@hip/protocol` through the workspace import) and `yarn workspace @hip/sidecar type-check`; `@hip/protocol` has no build script.

---


### Task 12: sessionStore reducer — `case 'session:permissionMode'`

**Files:**
- `src/domain/sessionStore.test.ts` (add tests)
- `src/domain/sessionStore.ts` (add the reducer case)

- [ ] **Step 1:** Add failing tests. Insert these two `it(...)` blocks in `src/domain/sessionStore.test.ts` immediately **after** the existing `it('session:thinking flips config.thinking', ...)` block (which begins at line 275, inside the `describe('applyServerMessage', ...)` block). Use `baseSession()` (the file's existing helper, which makes a session with `id: 's1'`):

```ts
  it('session:permissionMode writes config.permissionMode', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'session:permissionMode', sessionId: 's1', permissionMode: 'full' }, 0)
    expect(next.sessions[0].config.permissionMode).toBe('full')
  })

  it('session:permissionMode for an unknown session is a no-op (same reference)', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'session:permissionMode', sessionId: 'nope', permissionMode: 'chat' }, 0)
    expect(next).toBe(s0)
  })
```

- [ ] **Step 2:** Run the test (expect FAIL — no reducer case yet).

```
yarn vitest run src/domain/sessionStore.test.ts
```

Expected: FAIL. With no `session:permissionMode` case the message hits `default: return state`, so `next.sessions[0].config.permissionMode` is `undefined` → first assertion fails with `expected undefined to be 'full'`. (The second assertion happens to pass because `default` returns the same `state`, but the suite is red on the first.)

- [ ] **Step 3:** Add the reducer case. In `src/domain/sessionStore.ts`, inside the `switch (msg.type)` of `applyServerMessage`, add this case immediately **after** the existing `case 'session:thinking':` block (which is at lines 242–243), mirroring it:

```ts
    case 'session:thinking':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, thinking: msg.thinking } }))

    case 'session:permissionMode':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, permissionMode: msg.permissionMode } }))
```

(`update` already short-circuits to the same `state` reference for an unknown sessionId — that is what makes the no-op test pass.)

- [ ] **Step 4:** Run the test (expect PASS).

```
yarn vitest run src/domain/sessionStore.test.ts
```

Expected: PASS — every test in the file green, including the two new `session:permissionMode` cases.

- [ ] **Step 5:** Commit.

```
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "$(cat <<'EOF'
feat(sessionStore): reduce session:permissionMode into config

Mirror the session:thinking case: write msg.permissionMode onto the
matching session's config; no-op (same reference) for unknown sessions.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: sessionService.setPermissionMode (mirror setThinking)

**Files:**
- `src/domain/sessionService.test.ts` (add a test)
- `src/domain/sessionService.ts` (add the method + type import)

- [ ] **Step 1:** Add a failing test. Insert this `it(...)` block in `src/domain/sessionService.test.ts` immediately **after** the existing `it('setSystemPrompt null clears config and sends null', ...)` block (which ends at line 115, inside `describe('SessionService', ...)`). The file's `beforeEach` seeds `useDomainStore` with one session `id: 's1'`, so the optimistic apply lands on `sessions[0]`:

```ts
  it('setPermissionMode optimistically sets config and sends session:setPermissionMode', () => {
    const t = new FakeTransport()
    new SessionService(t).setPermissionMode('s1', 'full')
    expect(useDomainStore.getState().sessions[0].config.permissionMode).toBe('full')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setPermissionMode', sessionId: 's1', permissionMode: 'full' })
  })
```

- [ ] **Step 2:** Run the test (expect FAIL — `setPermissionMode` does not exist).

```
yarn vitest run src/domain/sessionService.test.ts
```

Expected: FAIL — `new SessionService(t).setPermissionMode is not a function` (the method is missing), so the test errors out.

- [ ] **Step 3:** Add the method + the `PermissionMode` type import in `src/domain/sessionService.ts`.

First, add `PermissionMode` to the existing protocol type import on line 2. Change:

```ts
import type { ServerMessage, SessionConfig, DiffBase, CheckpointMode } from '@hip/protocol'
```

to:

```ts
import type { ServerMessage, SessionConfig, DiffBase, CheckpointMode, PermissionMode } from '@hip/protocol'
```

Then add the method immediately **after** the existing `setThinking(...)` method (which ends at line 182), mirroring it exactly:

```ts
  setThinking(id: string, thinking: boolean): void {
    useDomainStore.getState().apply({ type: 'session:thinking', sessionId: id, thinking }) // optimistic
    this.transport.send({ type: 'session:setThinking', sessionId: id, thinking })
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    useDomainStore.getState().apply({ type: 'session:permissionMode', sessionId: id, permissionMode: mode }) // optimistic
    this.transport.send({ type: 'session:setPermissionMode', sessionId: id, permissionMode: mode })
  }
```

- [ ] **Step 4:** Run the test (expect PASS).

```
yarn vitest run src/domain/sessionService.test.ts
```

Expected: PASS — every test in the file green, including the new `setPermissionMode` test.

- [ ] **Step 5:** Commit.

```
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "$(cat <<'EOF'
feat(sessionService): setPermissionMode (optimistic apply + send)

Mirror setThinking: optimistically apply session:permissionMode to the
store, then send session:setPermissionMode over the transport.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: draftStore.Draft.permissionMode + setPermissionMode action; configFromDraft carries it into session:create

**Files:**
- `src/store/draftStore.test.ts` (add tests)
- `src/store/draftStore.ts` (add field + action + type import)
- `src/domain/sessionService.configFromDraft.test.ts` (add tests)
- `src/domain/sessionService.ts` (`configFromDraft` carries `permissionMode`)

- [ ] **Step 1:** Add failing draftStore tests. Append this `describe(...)` block to the **end** of `src/store/draftStore.test.ts` (after the existing `describe('draftStore agentId', ...)` block, which begins at line 34). The file's `beforeEach(() => useDraftStore.setState({ draft: null }))` gives each test a clean slate:

```ts
describe('draftStore permissionMode', () => {
  it('setPermissionMode creates a draft if none and records the mode', () => {
    useDraftStore.getState().setPermissionMode('full')
    expect(useDraftStore.getState().draft?.permissionMode).toBe('full')
  })
  it('setPermissionMode preserves existing draft fields', () => {
    useDraftStore.getState().pickProject('/tmp/x')
    useDraftStore.getState().setPermissionMode('chat')
    const d = useDraftStore.getState().draft!
    expect(d.cwd).toBe('/tmp/x')
    expect(d.mode).toBe('project')
    expect(d.permissionMode).toBe('chat')
  })
  it('reset clears the draft (and with it permissionMode)', () => {
    useDraftStore.getState().setPermissionMode('edit')
    expect(useDraftStore.getState().draft?.permissionMode).toBe('edit')
    useDraftStore.getState().reset()
    expect(useDraftStore.getState().draft).toBeNull()
  })
})
```

- [ ] **Step 2:** Run the test (expect FAIL — `setPermissionMode` does not exist on the store).

```
yarn vitest run src/store/draftStore.test.ts
```

Expected: FAIL — `useDraftStore.getState().setPermissionMode is not a function`.

- [ ] **Step 3:** Add the field + action to `src/store/draftStore.ts`.

(a) Add a type import immediately **after** the existing imports (after line 3, `import { nanoid } from 'nanoid'`):

```ts
import { nanoid } from 'nanoid'
import type { PermissionMode } from '@hip/protocol'
```

(b) Add the `permissionMode` field to the `Draft` interface immediately **after** the `modelKey?` line (line 11):

```ts
  modelKey?: string            // 'providerID/modelID' chosen for this chat (locked at first send)
  permissionMode?: PermissionMode   // 'chat'|'edit'|'full' chosen for this chat; undefined ⇒ server default 'edit'
```

(c) Add the action signature to the `DraftStore` interface immediately **after** `setModelKey` (line 21):

```ts
  setModelKey: (modelKey: string) => void
  setPermissionMode: (permissionMode: PermissionMode) => void
```

(d) Add the action implementation in the store body immediately **after** the `setModelKey:` implementation (which ends at line 66), before `reset:`, mirroring `setModelKey`:

```ts
      setModelKey: (modelKey) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, modelKey } }
        }),
      setPermissionMode: (permissionMode) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, permissionMode } }
        }),
```

- [ ] **Step 4:** Run the draftStore test (expect PASS).

```
yarn vitest run src/store/draftStore.test.ts
```

Expected: PASS — every test green, including the new `draftStore permissionMode` block.

- [ ] **Step 5:** Add failing tests for `configFromDraft` carrying `permissionMode`. Append these two `it(...)` blocks inside the existing `describe('configFromDraft', ...)` in `src/domain/sessionService.configFromDraft.test.ts`, immediately **before** the closing `})` of the describe (after the last existing `it('never sets agentId …')` block):

```ts
  it('carries the draft permissionMode into the config', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', permissionMode: 'full' })
    expect(cfg.permissionMode).toBe('full')
  })
  it('omits permissionMode when the draft has none (server default applies)', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '' })
    expect(cfg.permissionMode).toBeUndefined()
  })
```

- [ ] **Step 6:** Run the test (expect FAIL — `configFromDraft` does not yet copy `permissionMode`).

```
yarn vitest run src/domain/sessionService.configFromDraft.test.ts
```

Expected: FAIL — `expected undefined to be 'full'` on the first new assertion (the field is dropped by the current `configFromDraft`).

- [ ] **Step 7:** Thread `permissionMode` through `configFromDraft` in `src/domain/sessionService.ts`. Replace the existing function (currently lines 351–359):

```ts
/** Build the committed SessionConfig from the current draft (project cwd + chosen model). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const base: SessionConfig =
    draft?.mode === 'project' && draft.cwd ? { ...DEFAULT_CONFIG, cwd: draft.cwd } : DEFAULT_CONFIG
  if (!draft?.modelKey) return base
  const { catalog, config } = useProvidersStore.getState()
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...base, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}
```

with:

```ts
/** Build the committed SessionConfig from the current draft (project cwd + chosen model + permission mode). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const base: SessionConfig =
    draft?.mode === 'project' && draft.cwd ? { ...DEFAULT_CONFIG, cwd: draft.cwd } : DEFAULT_CONFIG
  const withMode: SessionConfig = draft?.permissionMode ? { ...base, permissionMode: draft.permissionMode } : base
  if (!draft?.modelKey) return withMode
  const { catalog, config } = useProvidersStore.getState()
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...withMode, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}
```

- [ ] **Step 8:** Run the test (expect PASS).

```
yarn vitest run src/domain/sessionService.configFromDraft.test.ts
```

Expected: PASS — every test green, including the two new `permissionMode` cases. (`createSession` already sends `{ type: 'session:create', id, config: enriched }` where `enriched = { ...configFromDraft(draft), language }`, so the draft's permission mode now rides into `session:create` — no `createSession`/`sendMessage` change is needed.)

- [ ] **Step 9:** Type-check (verifies the new `@hip/protocol` import in draftStore + the function change).

```
yarn type-check
```

Expected: exits 0, no type errors.

- [ ] **Step 10:** Commit.

```
git add src/store/draftStore.ts src/store/draftStore.test.ts src/domain/sessionService.ts src/domain/sessionService.configFromDraft.test.ts
git commit -m "$(cat <<'EOF'
feat(draft): permissionMode field + carry it into session:create

Add Draft.permissionMode and a setPermissionMode action (mirror
setModelKey), and thread it through configFromDraft so a draft's chosen
permission mode lands in the new SessionConfig on first send.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: PermissionModePicker.tsx — pure logic + component (mirror ModelPicker; editable in committed sessions)

**Files:**
- `src/components/chat/PermissionModePicker.logic.test.ts` (NEW)
- `src/components/chat/PermissionModePicker.tsx` (NEW)

- [ ] **Step 1:** Write the failing pure-logic test. Create `src/components/chat/PermissionModePicker.logic.test.ts` (the `.js` import extension matches the project's ESM/`ModelPicker.logic.test.ts` convention of importing the pure exports without pulling React/i18n into the node test):

```ts
import { describe, it, expect } from 'vitest'
import { PERMISSION_MODES, resolvePermissionMode } from './PermissionModePicker.js'

describe('PermissionModePicker logic', () => {
  it('exposes the three modes in chat→edit→full order', () => {
    expect(PERMISSION_MODES).toEqual(['chat', 'edit', 'full'])
  })
  it('resolves an explicit mode as-is', () => {
    expect(resolvePermissionMode('full')).toBe('full')
    expect(resolvePermissionMode('chat')).toBe('chat')
    expect(resolvePermissionMode('edit')).toBe('edit')
  })
  it('defaults undefined to edit (back-compat)', () => {
    expect(resolvePermissionMode(undefined)).toBe('edit')
  })
  it('treats an unknown/dirty value as edit (safe default)', () => {
    expect(resolvePermissionMode('garbage' as never)).toBe('edit')
  })
})
```

- [ ] **Step 2:** Run the test (expect FAIL — the module does not exist yet).

```
yarn vitest run src/components/chat/PermissionModePicker.logic.test.ts
```

Expected: FAIL — module resolution error: `Failed to load url ./PermissionModePicker.js` / cannot find module `./PermissionModePicker`.

- [ ] **Step 3:** Create the component `src/components/chat/PermissionModePicker.tsx`. It mirrors `ModelPicker.tsx` (separate Zustand selectors to avoid per-render object churn, `DropdownMenu modal={false}`, `ComposerChip` trigger) but is **editable in committed sessions** — it reads the draft for a new conversation and `useActiveSession().config.permissionMode` for a committed one, and writes via `sessionService.setPermissionMode` (committed) or `setDraftMode` (draft). The chip is `active` only when the mode is not the neutral `'edit'` default:

```tsx
import { useTranslation } from 'react-i18next'
import { ShieldCheck, Check } from 'lucide-react'
import type { PermissionMode } from '@hip/protocol'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { cn } from '@/lib/utils'

/** Pure: the three modes in display order. */
export const PERMISSION_MODES: readonly PermissionMode[] = ['chat', 'edit', 'full'] as const

/** Pure: normalize a stored/draft value to one of the three modes. undefined / dirty ⇒ 'edit'. */
export function resolvePermissionMode(mode: PermissionMode | undefined): PermissionMode {
  return mode === 'chat' || mode === 'edit' || mode === 'full' ? mode : 'edit'
}

export function PermissionModePicker() {
  const { t } = useTranslation()
  // Separate selectors (matching ModelPicker) avoid a new object each render / useShallow.
  const draftMode = useDraftStore((s) => s.draft?.permissionMode)
  const setDraftMode = useDraftStore((s) => s.setPermissionMode)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  // Committed session reads its config; a new-conversation draft reads the draft.
  // Both are editable here (unlike ModelPicker, which locks the model in a committed session).
  const current = activeId && session
    ? resolvePermissionMode(session.config.permissionMode)
    : resolvePermissionMode(draftMode)

  const choose = (mode: PermissionMode) => {
    if (activeId && session) sessionService.setPermissionMode(activeId, mode)
    else setDraftMode(mode)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip active={current !== 'edit'} title={t('chat.permission.label')} data-testid="permission-chip">
          <ShieldCheck size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[140px] truncate">{t(`chat.permission.modes.${current}`)}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PERMISSION_MODES.map((mode) => (
          <DropdownMenuItem key={mode} onSelect={() => choose(mode)} className="flex-col items-start gap-0.5">
            <div className="flex items-center gap-2">
              <Check size={14} className={cn('shrink-0', current === mode ? 'opacity-100' : 'opacity-0')} />
              <span>{t(`chat.permission.modes.${mode}`)}</span>
            </div>
            <span className="pl-6 text-meta text-ink-tertiary">{t(`chat.permission.desc.${mode}`)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4:** Run the logic test (expect PASS).

```
yarn vitest run src/components/chat/PermissionModePicker.logic.test.ts
```

Expected: PASS — all assertions green. (`PERMISSION_MODES` and `resolvePermissionMode` are pure exports, importable without instantiating React/i18n, matching the `ModelPicker.logic.test.ts` pattern.)

- [ ] **Step 5:** Type-check (verifies the JSX + the new protocol import + that `DropdownMenuItem`/`ComposerChip` props line up; `ComposerChip` forwards `title`/`data-testid`/`active` via its `React.ButtonHTMLAttributes` spread).

```
yarn type-check
```

Expected: exits 0, no type errors.

- [ ] **Step 6:** Commit.

```
git add src/components/chat/PermissionModePicker.tsx src/components/chat/PermissionModePicker.logic.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): PermissionModePicker composer chip (editable any time)

Mirror ModelPicker (modal={false} dropdown, ComposerChip trigger) but
stay editable in committed sessions: write the draft for a new chat, or
sessionService.setPermissionMode for a committed one. Three modes
chat/edit/full with descriptions; default + dirty values resolve to edit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: InputBar leftSlot — render PermissionModePicker next to ModelPicker

**Files:**
- `src/components/chat/InputBar.tsx`

- [ ] **Step 1:** Edit `src/components/chat/InputBar.tsx`.

(a) Add the import for `PermissionModePicker` immediately **after** the `ModelPicker` import (line 3). Change:

```ts
import { ModelPicker } from './ModelPicker'
```

to:

```ts
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
```

(b) Change the `leftSlot` prop on the `<Composer>` (line 30) from:

```tsx
          leftSlot={<ModelPicker />}
```

to render both pickers side by side (the Composer's existing `leftSlot` row spaces them with its flex gap):

```tsx
          leftSlot={<><ModelPicker /><PermissionModePicker /></>}
```

- [ ] **Step 2:** Type-check (UI-only change; no new test — verify it compiles).

```
yarn type-check
```

Expected: exits 0, no type errors.

- [ ] **Step 3:** Build sanity (confirms the new component + JSX bundle cleanly end-to-end).

```
yarn build
```

Expected: `tsc && vite build` completes with no errors and a `dist/` bundle is produced.

- [ ] **Step 4:** Commit.

```
git add src/components/chat/InputBar.tsx
git commit -m "$(cat <<'EOF'
feat(chat): show PermissionModePicker beside ModelPicker in the composer

Render <ModelPicker/> and <PermissionModePicker/> together in the
Composer leftSlot.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: i18n — `chat.permission.*` (label, mode names, descriptions) in en / zh-CN / zh-TW

**Files:**
- `src/i18n/en.ts`
- `src/i18n/zh-CN.ts`
- `src/i18n/zh-TW.ts`

The existing `chat.permission` object holds the HITL-modal strings (`title` / `intro` / `fromSubagent`). The picker keys (`label`, `modes.*`, `desc.*`) are added to that **same** object so they live under `chat.permission.*` as the contract requires, without disturbing the existing keys. `en` is the `as const` resource that drives i18n typing, so all three locales must carry the **identical** nested key shape — they are added in lockstep below.

- [ ] **Step 1:** Edit `src/i18n/en.ts`. Replace the existing `permission` block (lines 41–45) with the extended version:

```ts
      permission: {
        title: 'Permission required',
        intro: 'The agent is requesting to perform this action:',
        fromSubagent: 'Requested by sub-agent {{name}}',
        label: 'Permission mode for this conversation',
        modes: {
          chat: 'Chat only',
          edit: 'Edit files',
          full: 'Full access',
        },
        desc: {
          chat: 'Read-only — can read and search files, but not write or run scripts',
          edit: 'Read and edit files inside the project folder; scripts ask first',
          full: 'Read and write any directory; scripts run without asking',
        },
      },
```

- [ ] **Step 2:** Edit `src/i18n/zh-CN.ts`. Replace the existing `permission` block (lines 41–45) with:

```ts
      permission: {
        title: '需要授权',
        intro: '智能体请求执行以下操作：',
        fromSubagent: '来自子智能体 {{name}} 的请求',
        label: '本对话的权限模式',
        modes: {
          chat: '仅对话',
          edit: '编辑目录内文件',
          full: '完全放开',
        },
        desc: {
          chat: '只读 —— 可读取与搜索文件，但不能写入或运行脚本',
          edit: '可读取并编辑项目目录内的文件；运行脚本会逐次确认',
          full: '可读写任意目录；运行脚本不再确认',
        },
      },
```

- [ ] **Step 3:** Edit `src/i18n/zh-TW.ts`. Replace the existing `permission` block (lines 41–45) with:

```ts
      permission: {
        title: '需要授權',
        intro: '智能體請求執行以下操作：',
        fromSubagent: '來自子智能體 {{name}} 的請求',
        label: '本對話的權限模式',
        modes: {
          chat: '僅對話',
          edit: '編輯目錄內檔案',
          full: '完全放開',
        },
        desc: {
          chat: '唯讀 —— 可讀取與搜尋檔案，但不能寫入或執行腳本',
          edit: '可讀取並編輯專案目錄內的檔案；執行腳本會逐次確認',
          full: '可讀寫任意目錄；執行腳本不再確認',
        },
      },
```

- [ ] **Step 4:** Type-check. The `en` resource is `as const` and drives the i18n typing; adding the same nested keys to all three locales keeps them aligned, and this also confirms the `t('chat.permission.modes.${current}')` / `t('chat.permission.desc.${mode}')` template usage in the picker resolves against the new keys.

```
yarn type-check
```

Expected: exits 0, no type errors.

- [ ] **Step 5:** Re-run the picker logic test to confirm the file set still loads (it doesn't read i18n, but this is a cheap guard against an accidental break in the picker module).

```
yarn vitest run src/components/chat/PermissionModePicker.logic.test.ts
```

Expected: PASS — all assertions green.

- [ ] **Step 6:** Commit.

```
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "$(cat <<'EOF'
feat(i18n): chat.permission.* mode label + names + descriptions (3 locales)

Extend the existing chat.permission object with label, modes.{chat,edit,
full} and desc.{chat,edit,full} for the PermissionModePicker, in en /
zh-CN / zh-TW.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Notes for the implementer

- **Protocol prerequisite:** this slice depends on the permission-mode protocol types/messages landed by **Slice 1 (Tasks 1-2)** — the build order runs Slice 1 first, so they are already present.
- **Picker editability vs. ModelPicker lock:** `ModelPicker` renders a **locked, disabled** chip for committed sessions. `PermissionModePicker` deliberately does **not** lock — in a committed session it stays an interactive dropdown and calls `sessionService.setPermissionMode(activeId, mode)`; in a draft it calls `setDraftMode(mode)`. This is the one intentional divergence from the ModelPicker pattern (per contract).
- **Chip `active` state:** `'edit'` is the neutral default, so the chip is highlighted (`active`) only for `'chat'` or `'full'` — `current !== 'edit'`. A committed session with no stored `permissionMode` resolves to `'edit'` (back-compat) → unhighlighted.
- **`chat.permission.*` namespace:** the picker strings are nested inside the pre-existing `chat.permission` object (which already had `title`/`intro`/`fromSubagent` for the HITL modal). This satisfies the contract's `chat.permission.*` requirement and avoids a second top-level key. The `as const` typing on `en` means all three locales must carry identical key shapes — Task 17 adds them in lockstep.
- **`session:create` carries the mode:** `createSession` forwards `{ ...config, language }` (where `config = configFromDraft(draft)`) into `{ type: 'session:create', id, config: enriched }`; Task 14 makes `configFromDraft` copy `draft.permissionMode`, so no `SessionService.createSession`/`sendMessage` change is needed.
- **No paid LLM:** every test in this slice is a pure store/service/logic test driven by `FakeTransport` or a direct reducer call. None hits a model. The full `yarn test` is never run here.
- **Out of scope (other slices):** sidecar enforcement (`BuildToolsOpts.permissionMode`, `buildTools` mode-awareness, `session.ts runTurn`, `Session.setPermissionMode`, `session-manager.ts` `session:setPermissionMode` case, `system-prompt.ts` cwdBlock, invoker/internal-runner cascade) and the agent-tool-model rework (`agentTools.ts`, `agentDraft.ts`, `AgentEditor.tsx`) are **not** part of this frontend-composer slice.
- **Relevant absolute paths:** `/Users/lijiamin/data/my-github/hip/packages/protocol/src/index.ts`, `/Users/lijiamin/data/my-github/hip/src/domain/sessionStore.ts`, `/Users/lijiamin/data/my-github/hip/src/domain/sessionStore.test.ts`, `/Users/lijiamin/data/my-github/hip/src/domain/sessionService.ts`, `/Users/lijiamin/data/my-github/hip/src/domain/sessionService.test.ts`, `/Users/lijiamin/data/my-github/hip/src/domain/sessionService.configFromDraft.test.ts`, `/Users/lijiamin/data/my-github/hip/src/store/draftStore.ts`, `/Users/lijiamin/data/my-github/hip/src/store/draftStore.test.ts`, `/Users/lijiamin/data/my-github/hip/src/components/chat/PermissionModePicker.tsx` (new), `/Users/lijiamin/data/my-github/hip/src/components/chat/PermissionModePicker.logic.test.ts` (new), `/Users/lijiamin/data/my-github/hip/src/components/chat/InputBar.tsx`, and `/Users/lijiamin/data/my-github/hip/src/i18n/{en,zh-CN,zh-TW}.ts`.

## Slice 4: Frontend — agent editor tool model (per-skill + per-MCP-server, built-ins always on)

This slice retires the group-toggle / MCP-wildcard tool model from the **frontend** agent editor and replaces it with two explicit fields — `allowedSkills` and `allowedMcpServers` — while built-in tools (read/write/edit/plan/git/run_script/use_skill) are always available to internal agents. It depends on the **protocol slice** having added `AgentConfig.allowedSkills?: string[]` and `AgentConfig.allowedMcpServers?: string[]`. All sidecar enforcement/migration is covered by the sidecar slices; here we only touch `src/lib/agentTools.ts`, `src/lib/agentDraft.ts`, `src/components/account/AgentEditor.tsx`, and the three i18n locales.

Anchor every edit on the shown code — line numbers may have shifted. Run single tests with `yarn vitest run <path>`. Do **not** run the full `yarn test` (it fires paid LLM suites unless `~/.hip/config/auth.json` is moved aside first). Type-check the workspace with `yarn type-check` (there is no `build` script for `@hip/protocol`; types are verified via `yarn type-check`).

**Verified baseline facts (do not re-derive):**
- `AgentConfig` (`packages/protocol/src/index.ts:48`) currently has `prompt?` and `allowedTools?` but **NOT** `allowedSkills`/`allowedMcpServers`. Task 18 below fail-fasts if the protocol slice has not landed.
- The retired symbols (`TOOL_GROUPS`, `ToolGroup`, `ToolGroups`, `DEFAULT_TOOL_GROUPS`, `groupsToToolNames`, `toolNamesToGroups`, `mcpServerWildcard`) are referenced **only** in `src/lib/agentTools.ts`, `src/lib/agentDraft.ts`, `src/components/account/AgentEditor.tsx`, and the two `*.test.ts` files — all touched here. No other `src/` file references them.
- `SkillMeta` has `{ id, name, description, dir, hasScripts }`; `McpServerConfig` has `{ id, name, transport, ... , enabled }`. `useSkillsStore()` exposes `{ skills, load }`; `useMcpServersStore()` exposes `{ servers, load }`.
- The `t()` key type source-of-truth is **`zh-CN`** (`src/i18n/i18next.d.ts` → `resources: typeof zhCN`). All three locales are `as const` and must stay structurally identical, or `t('settings.agents.toolBuiltinNote')` etc. will not type-check.

---

### Task 18: Prerequisite gate — confirm the protocol fields landed (fail-fast)

This slice's type-check (Task 21/54) cannot pass until `AgentConfig.allowedSkills?`/`allowedMcpServers?` exist. Verify the dependency first so the executor stops cleanly instead of mid-slice.

**Files:** (none — verification only)

- [ ] **Step 1:** Confirm the two protocol fields exist on `AgentConfig`.

  Run: `grep -n "allowedSkills\|allowedMcpServers" packages/protocol/src/index.ts`
  Expected: **two matches**, e.g.
  ```
  allowedSkills?: string[]
  allowedMcpServers?: string[]
  ```
  If there is **no output**, the protocol slice has not landed — **STOP** and sequence it before this slice. Do not proceed; the frontend `buildAgentDraft` internal branch and `AgentEditor` form seeding both reference these fields and will not type-check without them.

- [ ] **Step 2:** Confirm `allowedTools?` is still present (kept for back-compat migration).

  Run: `grep -n "allowedTools" packages/protocol/src/index.ts`
  Expected: at least one match (`allowedTools?: string[]`). `grantedMcpServerIds` reads it for the back-compat seed.

---

### Task 19: Slim `agentTools.ts` to the `grantedMcpServerIds` migration helper + `BUILTIN_TOOL_NAMES`

Retire `TOOL_GROUPS`, `ToolGroup`, `ToolGroups`, `DEFAULT_TOOL_GROUPS`, `groupsToToolNames`, `toolNamesToGroups`, `mcpServerWildcard`. Keep only `grantedMcpServerIds` (back-compat migration of legacy `allowedTools` `mcp__<id>__*` wildcards) and add a `BUILTIN_TOOL_NAMES` constant for prompt/display use.

**Files:**
- `src/lib/agentTools.ts`
- `src/lib/agentTools.test.ts`

- [ ] **Step 1:** Replace the **whole** test file `src/lib/agentTools.test.ts` (it currently imports the old API and will be made to fail by the new import of `BUILTIN_TOOL_NAMES`):

```ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_TOOL_NAMES, grantedMcpServerIds } from './agentTools'

describe('BUILTIN_TOOL_NAMES', () => {
  it('lists every always-on built-in tool an internal agent has', () => {
    expect(BUILTIN_TOOL_NAMES).toEqual([
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'write_todos',
      'git_commit',
      'git_create_branch',
      'git_switch_branch',
      'run_script',
      'use_skill',
    ])
  })
})

describe('grantedMcpServerIds (legacy migration helper)', () => {
  it('parses granted server ids from a legacy allow-list', () => {
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__*', 'use_skill', 'mcp__db__*'])).toEqual(['fs', 'db'])
  })
  it('returns [] for undefined or no wildcard entries', () => {
    expect(grantedMcpServerIds(undefined)).toEqual([])
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__read'])).toEqual([])
  })
})
```

- [ ] **Step 2:** Run the test, expect FAIL.

  Run: `yarn vitest run src/lib/agentTools.test.ts`
  Expected: FAIL — the suite errors on import, `BUILTIN_TOOL_NAMES` is not exported by the (still old) `agentTools.ts` (`SyntaxError: ... does not provide an export named 'BUILTIN_TOOL_NAMES'`, or a "No test suite found"-style import error).

- [ ] **Step 3:** Replace the **whole** `src/lib/agentTools.ts` with the slimmed version:

```ts
/** Built-in tools every internal agent always has. No per-tool gating remains; this list is for
 *  display / prompt-building only. (Permission-mode gating of write/edit/run_script happens in the
 *  sidecar per conversation, not per agent.) */
export const BUILTIN_TOOL_NAMES = [
  'read_file',
  'ls',
  'glob',
  'grep',
  'write_file',
  'edit_file',
  'write_todos',
  'git_commit',
  'git_create_branch',
  'git_switch_branch',
  'run_script',
  'use_skill',
] as const

/** Back-compat ONLY: parse a legacy `allowedTools` array and return the serverIds that were granted
 *  via `mcp__<id>__*` wildcards. Used once when seeding the editor / reading an old internal agent
 *  whose `allowedMcpServers` is still undefined. New configs use `allowedMcpServers` directly. */
export function grantedMcpServerIds(names: string[] | undefined): string[] {
  if (!names) return []
  const out: string[] = []
  for (const n of names) {
    const m = /^mcp__(.+)__\*$/.exec(n)
    if (m) out.push(m[1])
  }
  return out
}
```

- [ ] **Step 4:** Run the test, expect PASS.

  Run: `yarn vitest run src/lib/agentTools.test.ts`
  Expected: PASS — both `describe` blocks green (3 tests).

- [ ] **Step 5:** Commit.

  Run: `git add src/lib/agentTools.ts src/lib/agentTools.test.ts && git commit -m "$(printf 'refactor(agentTools): retire group/wildcard model; keep grantedMcpServerIds + BUILTIN_TOOL_NAMES\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`
  Expected: a commit is created. (`agentDraft.ts` / `AgentEditor.tsx` still import the deleted symbols — they are fixed in Tasks 20 and 54; `yarn type-check` is intentionally NOT run until Task 22, because a single-file `yarn vitest run` only loads the file under test plus its direct imports and does not type-check the whole graph.)

---

### Task 20: `agentDraft.ts` — drop `tools*`/`mcpServerIds`, add `allowedSkills`/`allowedMcpServers`

`AgentForm` loses `toolsRead/toolsEdit/toolsPlan/toolsGit/toolsSkill/toolsScript/mcpServerIds` and gains `allowedSkills: string[]` + `allowedMcpServers: string[]`. The internal branch of `buildAgentDraft` outputs those two fields and **no** `allowedTools`. `isAgentDraftValid` is unchanged (internal needs name + prompt only).

**Files:**
- `src/lib/agentDraft.ts`
- `src/lib/agentDraft.test.ts`

- [ ] **Step 1:** Replace the **whole** test file `src/lib/agentDraft.test.ts`. (The current file imports `TOOL_GROUPS` from `./agentTools` — now deleted — and uses the old form shape, so it must be fully rewritten.) Write:

```ts
import { describe, it, expect } from 'vitest'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from './agentDraft'

const base: AgentForm = {
  name: 'Claude Code',
  kind: 'custom',
  command: 'claude',
  args: '--loop --json',
  transport: 'rich',
  acceptsModelConfig: false,
  boundModelKey: '',
  authMode: 'opencode-self',
  enabled: true,
  prompt: '',
  allowedSkills: [],
  allowedMcpServers: [],
}

describe('isAgentDraftValid', () => {
  it('requires name and command', () => {
    expect(isAgentDraftValid(base)).toBe(true)
    expect(isAgentDraftValid({ ...base, name: '  ' })).toBe(false)
    expect(isAgentDraftValid({ ...base, command: '' })).toBe(false)
  })
  it('custom agents never require a model (rollback)', () => {
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: '' })).toBe(true)
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: false, boundModelKey: '' })).toBe(true)
  })
  it('acp agents never require a model regardless of legacy authMode (rollback)', () => {
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'hip-managed', boundModelKey: '' })).toBe(true)
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'opencode-self', boundModelKey: '' })).toBe(true)
  })
})

describe('buildAgentDraft', () => {
  it('trims fields and whitespace-splits args', () => {
    const d = buildAgentDraft({ ...base, name: '  X ', command: '  bin ', args: '  --a   --b ' })
    expect(d).toMatchObject({ name: 'X', kind: 'custom', command: 'bin', args: ['--a', '--b'], enabled: true })
  })
  it('empty args → []', () => {
    expect(buildAgentDraft({ ...base, args: '   ' }).args).toEqual([])
  })
  it('custom agents never emit a boundModel, even when a key is set (rollback)', () => {
    expect(buildAgentDraft({ ...base, acceptsModelConfig: false, boundModelKey: 'anthropic/x' }).boundModel).toBeUndefined()
    expect(buildAgentDraft({ ...base, acceptsModelConfig: true, boundModelKey: 'openrouter/meta/llama-3' }).boundModel).toBeUndefined()
  })
  it('acp: no model pushed, acceptsModelConfig false, no authMode field (rollback)', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'opencode-self', quirks: 'opencode', boundModelKey: 'anthropic/x' })
    expect(d).toMatchObject({ kind: 'acp', quirks: 'opencode', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
    expect('authMode' in d).toBe(false)
  })
  it('acp ignores a legacy hip-managed selection: still no model, no authMode (rollback)', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'hip-managed', quirks: 'opencode', boundModelKey: 'anthropic/claude-opus-4' })
    expect(d).toMatchObject({ kind: 'acp', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
    expect('authMode' in d).toBe(false)
  })
  it('non-acp forms do not emit an authMode field', () => {
    expect('authMode' in buildAgentDraft({ ...base, kind: 'custom' })).toBe(false)
  })
  it('carries a trimmed description, omitting it when blank', () => {
    expect(buildAgentDraft({ ...base, description: '  edits code  ' }).description).toBe('edits code')
    expect(buildAgentDraft({ ...base, description: '   ' }).description).toBeUndefined()
  })
  it('external (custom/acp) drafts never emit allowedSkills / allowedMcpServers', () => {
    const d = buildAgentDraft({ ...base, allowedSkills: ['s1'], allowedMcpServers: ['m1'] })
    expect('allowedSkills' in d).toBe(false)
    expect('allowedMcpServers' in d).toBe(false)
  })
})

const internalBase: AgentForm = {
  name: 'Reviewer', kind: 'internal', command: '', args: '', transport: 'thin',
  acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self', enabled: true,
  prompt: 'You review code.', allowedSkills: [], allowedMcpServers: [],
}

describe('internal agents', () => {
  it('requires a name and a non-empty prompt (command not required)', () => {
    expect(isAgentDraftValid(internalBase)).toBe(true)
    expect(isAgentDraftValid({ ...internalBase, prompt: '   ' })).toBe(false)
    expect(isAgentDraftValid({ ...internalBase, command: '' })).toBe(true) // command irrelevant for internal
  })
  it('builds an internal draft: prompt + allowedSkills/allowedMcpServers, NO allowedTools, inert command/args', () => {
    const d = buildAgentDraft({ ...internalBase, allowedSkills: ['code-review'], allowedMcpServers: ['fs'] })
    expect(d).toMatchObject({
      kind: 'internal',
      prompt: 'You review code.',
      command: '',
      args: [],
      transport: 'thin',
      acceptsModelConfig: false,
      allowedSkills: ['code-review'],
      allowedMcpServers: ['fs'],
    })
    expect('allowedTools' in d).toBe(false)
    expect(d.boundModel).toBeUndefined()
  })
  it('empty skill/mcp selections emit empty arrays (explicit none)', () => {
    const d = buildAgentDraft(internalBase)
    expect(d).toMatchObject({ allowedSkills: [], allowedMcpServers: [] })
    expect('allowedTools' in d).toBe(false)
  })
  it('copies the arrays (does not alias the form arrays)', () => {
    const skills = ['a']
    const mcp = ['b']
    const d = buildAgentDraft({ ...internalBase, allowedSkills: skills, allowedMcpServers: mcp })
    expect(d.allowedSkills).toEqual(['a'])
    expect(d.allowedSkills).not.toBe(skills)
    expect(d.allowedMcpServers).not.toBe(mcp)
  })
  it('binds a model when a key is chosen', () => {
    const d = buildAgentDraft({ ...internalBase, boundModelKey: 'anthropic/claude-opus-4' })
    expect(d.boundModel).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
  })
})
```

- [ ] **Step 2:** Run the test, expect FAIL.

  Run: `yarn vitest run src/lib/agentDraft.test.ts`
  Expected: FAIL — `agentDraft.ts` still imports `groupsToToolNames`/`mcpServerWildcard` from the now-slimmed `agentTools.ts` (resolution error), and even past that the new `AgentForm` fields `allowedSkills`/`allowedMcpServers` are absent while the old `toolsRead`/`mcpServerIds` are still required, so the test objects do not type/run.

- [ ] **Step 3:** Replace the **whole** `src/lib/agentDraft.ts`. Note the **import line changes**: the old `import { groupsToToolNames, mcpServerWildcard } from './agentTools'` is removed entirely (the file no longer imports from `agentTools`):

```ts
import type { AgentConfig, AgentAuthMode } from '@hip/protocol'

export interface AgentForm {
  name: string
  description?: string
  kind: AgentConfig['kind']
  command: string
  args: string
  transport: AgentConfig['transport']
  acceptsModelConfig: boolean
  boundModelKey: string
  authMode: AgentAuthMode
  quirks?: string
  // internal-only fields:
  prompt: string
  allowedSkills: string[]      // skill ids this internal agent may use (use_skill restricted to these)
  allowedMcpServers: string[]  // MCP server ids whose tools this internal agent may use
  enabled: boolean
}

export function isAgentDraftValid(form: AgentForm): boolean {
  if (form.kind === 'internal') {
    return form.name.trim() !== '' && form.prompt.trim() !== ''
  }
  // Model rollback: external agents (acp + custom) self-manage — a model is never required.
  return form.name.trim() !== '' && form.command.trim() !== ''
}

function parseBoundModel(key: string): AgentConfig['boundModel'] {
  if (key === '') return undefined
  const slash = key.indexOf('/')
  return { providerID: key.slice(0, slash), modelID: key.slice(slash + 1) }
}

export function buildAgentDraft(form: AgentForm): Omit<AgentConfig, 'id'> {
  if (form.kind === 'internal') {
    return {
      name: form.name.trim(),
      description: (form.description ?? '').trim() || undefined,
      kind: 'internal',
      command: '',
      args: [],
      transport: 'thin',
      acceptsModelConfig: false,
      prompt: form.prompt.trim(),
      // Built-in tools are always available; only per-agent skill/MCP grants are configured here.
      // NO allowedTools is emitted — the sidecar no longer gates built-ins by an allow-list.
      allowedSkills: [...form.allowedSkills],
      allowedMcpServers: [...form.allowedMcpServers],
      boundModel: parseBoundModel(form.boundModelKey),
      enabled: form.enabled,
    }
  }

  // Model rollback: external agents (acp + custom) self-manage. We never push a model, so
  // acceptsModelConfig is always false and no boundModel/authMode is emitted (legacy fields stay
  // inert in the type for back-compat with already-saved configs).
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig: false,
    ...(form.quirks ? { quirks: form.quirks } : {}),
    enabled: form.enabled,
  }
}
```

- [ ] **Step 4:** Run the test, expect PASS.

  Run: `yarn vitest run src/lib/agentDraft.test.ts`
  Expected: PASS — all `describe` blocks green, including the `allowedSkills`/`allowedMcpServers` output, the array-copy (`not.toBe`) assertions, and every `'allowedTools' in d === false` / `'allowedSkills' in d === false` (external) assertion.

- [ ] **Step 5:** Commit. (`AgentEditor.tsx` still uses the old form fields — fixed in Task 22 — so `yarn type-check` is not run yet.)

  Run: `git add src/lib/agentDraft.ts src/lib/agentDraft.test.ts && git commit -m "$(printf 'refactor(agentDraft): internal AgentForm uses allowedSkills + allowedMcpServers (no allowedTools)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`
  Expected: a commit is created.

---

### Task 21: i18n — remove dead tool-toggle keys, add built-in note + Skills-section keys (en + zh-CN + zh-TW)

Remove `toolsHint/toolRead/toolReadDesc/toolEdit/toolEditDesc/toolPlan/toolPlanDesc/toolGit/toolGitDesc/toolSkill/toolSkillDesc/toolScript/toolScriptDesc`. Add `toolBuiltinNote`, `toolSkillsSection`, `toolSkillsSectionDesc`, `toolSkillsEmpty`. Repurpose `sectionTools`. Keep `toolMcpServers`, `toolMcpServersDesc`, `toolMcpServersEmpty`. All three locales must change identically — `zh-CN` is the `t()` type source (`i18next.d.ts`), and `en`/`zh-TW` must stay structurally identical to it.

**Files:**
- `src/i18n/en.ts`
- `src/i18n/zh-CN.ts`
- `src/i18n/zh-TW.ts`

- [ ] **Step 1:** In `src/i18n/en.ts`, replace the block (currently lines ~348–364) from `sectionTools` through `toolMcpServersEmpty`. Find:

```ts
        sectionTools: 'Available tools',
        toolsHint: 'Choose what this agent is allowed to do',
        toolRead: 'Read & search',
        toolReadDesc: 'read_file, ls, glob, grep',
        toolEdit: 'Edit files',
        toolEditDesc: 'write_file, edit_file',
        toolPlan: 'Plan',
        toolPlanDesc: 'write_todos',
        toolGit: 'Git',
        toolGitDesc: 'git_commit, git_create_branch, git_switch_branch',
        toolSkill: 'Run skills',
        toolSkillDesc: 'use_skill',
        toolScript: 'Run scripts',
        toolScriptDesc: 'run_script',
        toolMcpServers: 'MCP servers',
        toolMcpServersDesc: 'Grant this agent every tool from the chosen servers',
        toolMcpServersEmpty: 'No MCP servers configured yet',
```

Replace with:

```ts
        sectionTools: 'Tools & capabilities',
        toolBuiltinNote: 'Built-in tools (read/write, planning, git, run scripts) are always available. The permission mode of each conversation controls what can actually be written or run.',
        toolSkillsSection: 'Skills',
        toolSkillsSectionDesc: 'Grant this agent specific installed skills (use_skill is restricted to these)',
        toolSkillsEmpty: 'No skills installed yet',
        toolMcpServers: 'MCP servers',
        toolMcpServersDesc: 'Grant this agent every tool from the chosen servers',
        toolMcpServersEmpty: 'No MCP servers configured yet',
```

- [ ] **Step 2:** In `src/i18n/zh-CN.ts`, find:

```ts
        sectionTools: '可用工具',
        toolsHint: '勾选该智能体可以使用的能力',
        toolRead: '读取与搜索',
        toolReadDesc: 'read_file、ls、glob、grep',
        toolEdit: '编辑文件',
        toolEditDesc: 'write_file、edit_file',
        toolPlan: '计划',
        toolPlanDesc: 'write_todos',
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
        toolSkill: '运行技能',
        toolSkillDesc: 'use_skill',
        toolScript: '运行脚本',
        toolScriptDesc: 'run_script',
        toolMcpServers: 'MCP 服务器',
        toolMcpServersDesc: '授予该智能体所选服务器的全部工具',
        toolMcpServersEmpty: '尚未配置任何 MCP 服务器',
```

Replace with:

```ts
        sectionTools: '工具与能力',
        toolBuiltinNote: '内置工具（读写、规划、git、运行脚本）始终可用。能写入或执行什么由每个对话的权限模式控制。',
        toolSkillsSection: '技能',
        toolSkillsSectionDesc: '授予该智能体指定的已安装技能（use_skill 仅限这些）',
        toolSkillsEmpty: '尚未安装任何技能',
        toolMcpServers: 'MCP 服务器',
        toolMcpServersDesc: '授予该智能体所选服务器的全部工具',
        toolMcpServersEmpty: '尚未配置任何 MCP 服务器',
```

- [ ] **Step 3:** In `src/i18n/zh-TW.ts`, find:

```ts
        sectionTools: '可用工具',
        toolsHint: '勾選該智能體可以使用的能力',
        toolRead: '讀取與搜尋',
        toolReadDesc: 'read_file、ls、glob、grep',
        toolEdit: '編輯檔案',
        toolEditDesc: 'write_file、edit_file',
        toolPlan: '計畫',
        toolPlanDesc: 'write_todos',
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
        toolSkill: '執行技能',
        toolSkillDesc: 'use_skill',
        toolScript: '執行指令稿',
        toolScriptDesc: 'run_script',
        toolMcpServers: 'MCP 伺服器',
        toolMcpServersDesc: '授予該智能體所選伺服器的全部工具',
        toolMcpServersEmpty: '尚未設定任何 MCP 伺服器',
```

Replace with:

```ts
        sectionTools: '工具與能力',
        toolBuiltinNote: '內建工具（讀寫、規劃、git、執行指令稿）始終可用。能寫入或執行什麼由每個對話的權限模式控制。',
        toolSkillsSection: '技能',
        toolSkillsSectionDesc: '授予該智能體指定的已安裝技能（use_skill 僅限這些）',
        toolSkillsEmpty: '尚未安裝任何技能',
        toolMcpServers: 'MCP 伺服器',
        toolMcpServersDesc: '授予該智能體所選伺服器的全部工具',
        toolMcpServersEmpty: '尚未設定任何 MCP 伺服器',
```

- [ ] **Step 4:** Verify all dead keys are gone from all three locales and the new keys exist in all three.

  Run: `grep -rn "toolsHint\|toolRead\|toolEdit\|toolPlan\|toolGit\|toolSkillDesc\|toolScript" src/i18n/`
  Expected: **no output** (every dead key removed in all three files).

  Run: `grep -c "toolBuiltinNote\|toolSkillsSection\|toolSkillsSectionDesc\|toolSkillsEmpty" src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts`
  Expected: each file reports `4` (all four new keys present in each locale).

- [ ] **Step 5:** Commit. (Type-check is deferred until Task 22 wires the new keys + form into the editor; the new `t('settings.agents.toolBuiltinNote')` calls don't exist yet, and the editor still references removed keys, so a type-check now would still fail on the editor.)

  Run: `git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts && git commit -m "$(printf 'i18n(agents): drop per-tool toggle keys; add built-in note + skills-section keys (en/zh-CN/zh-TW)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`
  Expected: a commit is created.

---

### Task 22: `AgentEditor.tsx` — replace tool toggles with built-in note + per-skill + per-MCP-server lists

The internal "tools" section becomes: an info line (`toolBuiltinNote`), a Skills section (one `ToolToggle` per installed skill from `useSkillsStore`, checked ⇔ `form.allowedSkills.includes(skill.id)`), and the existing MCP-servers section (one `ToolToggle` per `useMcpServersStore` server, checked ⇔ `form.allowedMcpServers.includes(server.id)`). Seed the form from `initial.allowedSkills` / `initial.allowedMcpServers` with back-compat (`allowedMcpServers` undefined ⇒ `grantedMcpServerIds(initial.allowedTools)`, which for a `null` `initial` resolves to `[]`; `allowedSkills` undefined ⇒ `[]`). Mount-load both stores. This task is UI; verify by `yarn type-check` + `yarn build`. **This is the first full `yarn type-check` of the slice** — it requires Task 18's protocol-field gate to have passed.

**Files:**
- `src/components/account/AgentEditor.tsx`

- [ ] **Step 1:** Fix the imports. Find (line ~10–14):

```ts
import { groupModelOptions } from '@/lib/agentModelOptions'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from '@/lib/agentDraft'
import { agentCategory } from '@/lib/agentCategory'
import { toolNamesToGroups, DEFAULT_TOOL_GROUPS, grantedMcpServerIds } from '@/lib/agentTools'
import { useMcpServersStore } from '@/store/mcpServersStore'
```

Replace with:

```ts
import { groupModelOptions } from '@/lib/agentModelOptions'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from '@/lib/agentDraft'
import { agentCategory } from '@/lib/agentCategory'
import { grantedMcpServerIds } from '@/lib/agentTools'
import { useMcpServersStore } from '@/store/mcpServersStore'
import { useSkillsStore } from '@/store/skillsStore'
```

- [ ] **Step 2:** Replace the store destructure + `groups0` derivation + form seeding + mount effect. Find (line ~32–60):

```ts
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  const { servers: mcpServers } = useMcpServersStore()
  // Existing agent → derive toggles from its stored allow-list; new agent → the git-off default.
  const groups0 = initial ? toolNamesToGroups(initial.allowedTools) : DEFAULT_TOOL_GROUPS
  const [form, setForm] = useState<AgentForm>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? initialKind ?? 'custom',
    command: initial?.command ?? '',
    args: (initial?.args ?? []).join(' '),
    transport: initial?.transport ?? (initialKind === 'acp' ? 'rich' : 'thin'),
    acceptsModelConfig: initial?.acceptsModelConfig ?? false,
    boundModelKey: initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '',
    authMode: initial?.authMode ?? 'opencode-self',
    quirks: initial?.quirks,
    prompt: initial?.prompt ?? '',
    toolsRead: groups0.read,
    toolsEdit: groups0.edit,
    toolsPlan: groups0.plan,
    toolsGit: groups0.git,
    toolsSkill: groups0.skill,
    toolsScript: groups0.script,
    mcpServerIds: initial ? grantedMcpServerIds(initial.allowedTools) : [],
    enabled: initial?.enabled ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void useMcpServersStore.getState().load() }, [])
```

Replace with:

```ts
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  const { servers: mcpServers } = useMcpServersStore()
  const { skills } = useSkillsStore()
  // Seed the per-skill / per-MCP grants from the stored agent. Back-compat: an old internal agent
  // has no allowedMcpServers — derive it once from legacy `mcp__<id>__*` wildcards in allowedTools
  // (grantedMcpServerIds(undefined) === [] when initial is null, so a new agent starts empty);
  // allowedSkills was never represented in the old model, so it starts empty (user re-selects).
  const [form, setForm] = useState<AgentForm>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? initialKind ?? 'custom',
    command: initial?.command ?? '',
    args: (initial?.args ?? []).join(' '),
    transport: initial?.transport ?? (initialKind === 'acp' ? 'rich' : 'thin'),
    acceptsModelConfig: initial?.acceptsModelConfig ?? false,
    boundModelKey: initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '',
    authMode: initial?.authMode ?? 'opencode-self',
    quirks: initial?.quirks,
    prompt: initial?.prompt ?? '',
    allowedSkills: initial?.allowedSkills ?? [],
    allowedMcpServers: initial?.allowedMcpServers ?? grantedMcpServerIds(initial?.allowedTools),
    enabled: initial?.enabled ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void useMcpServersStore.getState().load()
    void useSkillsStore.getState().load()
  }, [])
```

- [ ] **Step 3:** Replace the toggle helper. Find (line ~74–76):

```ts
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))
  const toggleMcpServer = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, mcpServerIds: on ? [...f.mcpServerIds, id] : f.mcpServerIds.filter((x) => x !== id) }))
```

Replace with:

```ts
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))
  const toggleSkill = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, allowedSkills: on ? [...f.allowedSkills, id] : f.allowedSkills.filter((x) => x !== id) }))
  const toggleMcpServer = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, allowedMcpServers: on ? [...f.allowedMcpServers, id] : f.allowedMcpServers.filter((x) => x !== id) }))
```

- [ ] **Step 4:** Replace the entire tools `Section` + MCP `Section` JSX. Find (line ~166–193):

```tsx
              <Section label={t('settings.agents.sectionTools')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolsHint')}</div>
                <ToolToggle label={t('settings.agents.toolRead')} desc={t('settings.agents.toolReadDesc')} checked={form.toolsRead} onChange={(v) => patch({ toolsRead: v })} />
                <ToolToggle label={t('settings.agents.toolEdit')} desc={t('settings.agents.toolEditDesc')} checked={form.toolsEdit} onChange={(v) => patch({ toolsEdit: v })} />
                <ToolToggle label={t('settings.agents.toolPlan')} desc={t('settings.agents.toolPlanDesc')} checked={form.toolsPlan} onChange={(v) => patch({ toolsPlan: v })} />
                <ToolToggle label={t('settings.agents.toolGit')} desc={t('settings.agents.toolGitDesc')} checked={form.toolsGit} onChange={(v) => patch({ toolsGit: v })} />
                <ToolToggle label={t('settings.agents.toolSkill')} desc={t('settings.agents.toolSkillDesc')} checked={form.toolsSkill} onChange={(v) => patch({ toolsSkill: v })} />
                <ToolToggle label={t('settings.agents.toolScript')} desc={t('settings.agents.toolScriptDesc')} checked={form.toolsScript} onChange={(v) => patch({ toolsScript: v })} />
              </Section>

              <Section label={t('settings.agents.toolMcpServers')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolMcpServersDesc')}</div>
                {mcpServers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                    {t('settings.agents.toolMcpServersEmpty')}
                  </div>
                ) : (
                  mcpServers.map((s) => (
                    <ToolToggle
                      key={s.id}
                      label={s.name}
                      desc={s.id}
                      checked={form.mcpServerIds.includes(s.id)}
                      onChange={(v) => toggleMcpServer(s.id, v)}
                    />
                  ))
                )}
              </Section>
```

Replace with:

```tsx
              <Section label={t('settings.agents.sectionTools')}>
                <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                  {t('settings.agents.toolBuiltinNote')}
                </div>
              </Section>

              <Section label={t('settings.agents.toolSkillsSection')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolSkillsSectionDesc')}</div>
                {skills.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                    {t('settings.agents.toolSkillsEmpty')}
                  </div>
                ) : (
                  skills.map((s) => (
                    <ToolToggle
                      key={s.id}
                      label={s.name}
                      desc={s.description}
                      checked={form.allowedSkills.includes(s.id)}
                      onChange={(v) => toggleSkill(s.id, v)}
                    />
                  ))
                )}
              </Section>

              <Section label={t('settings.agents.toolMcpServers')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolMcpServersDesc')}</div>
                {mcpServers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                    {t('settings.agents.toolMcpServersEmpty')}
                  </div>
                ) : (
                  mcpServers.map((s) => (
                    <ToolToggle
                      key={s.id}
                      label={s.name}
                      desc={s.id}
                      checked={form.allowedMcpServers.includes(s.id)}
                      onChange={(v) => toggleMcpServer(s.id, v)}
                    />
                  ))
                )}
              </Section>
```

- [ ] **Step 5:** Type-check the workspace. This is the first whole-graph type-check of the slice and requires Task 18's protocol gate to have passed.

  Run: `yarn type-check`
  Expected: PASS — no errors. In particular, no residual references to `toolNamesToGroups`, `DEFAULT_TOOL_GROUPS`, `groups0`, `form.toolsRead`/`toolsEdit`/`toolsPlan`/`toolsGit`/`toolsSkill`/`toolsScript`, `form.mcpServerIds`, or the removed i18n keys. If you see `Property 'allowedSkills' does not exist on type 'AgentConfig'`, the protocol slice (Task 18) did not actually land — stop and sequence it.

- [ ] **Step 6:** Build the frontend to confirm the bundle compiles.

  Run: `yarn build`
  Expected: PASS — `tsc && vite build` completes, `dist/` is emitted, no errors.

- [ ] **Step 7:** Re-run the two pure-helper suites to confirm nothing regressed across the slice.

  Run: `yarn vitest run src/lib/agentTools.test.ts src/lib/agentDraft.test.ts`
  Expected: PASS — both files green.

- [ ] **Step 8:** Commit.

  Run: `git add src/components/account/AgentEditor.tsx && git commit -m "$(printf 'feat(AgentEditor): per-skill + per-MCP-server grants; built-ins always on\n\nInternal-agent tools section becomes a built-in note + a Skills list (per\ninstalled skill) + the MCP-servers list. Form seeds allowedSkills /\nallowedMcpServers from the stored agent (back-compat: derive MCP servers\nfrom legacy mcp__<id>__* wildcards when allowedMcpServers is unset).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`
  Expected: a commit is created.

---

### Task 23: Final slice verification (paid-free)

Confirm the whole frontend slice is green together and no dead references remain.

**Files:** (none — verification only)

- [ ] **Step 1:** Grep for any leftover reference to the retired symbols / form fields across `src/` (outside their own — now-rewritten — test files).

  Run: `grep -rn "toolNamesToGroups\|groupsToToolNames\|mcpServerWildcard\|DEFAULT_TOOL_GROUPS\|TOOL_GROUPS\|ToolGroups\|toolsRead\|toolsEdit\|toolsPlan\|toolsGit\|toolsSkill\|toolsScript\|mcpServerIds" src/`
  Expected: **no output** (every reference retired). If `mcpServerWildcard`/`TOOL_GROUPS` still appears under `packages/sidecar`, that is the sidecar slice's responsibility — out of scope here, not a blocker.

- [ ] **Step 2:** Workspace type-check (root + sidecar) to confirm no cross-package break from the trimmed `agentTools.ts` / `agentDraft.ts` exports.

  Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
  Expected: the **root** `yarn type-check` PASSES (this slice's own surface is clean). The sidecar type-check belongs to the sidecar slices: if it fails on `mcp__<id>__*` wildcard / `filterTools` / `allowedTools`, note it and proceed — that is out of this frontend slice's scope. This slice's pass criterion is the **root** type-check being clean.

- [ ] **Step 3:** Run the two pure-helper suites once more, paired, to lock the slice green (these are pure helpers — no LLM, no paid call).

  Run: `yarn vitest run src/lib/agentTools.test.ts src/lib/agentDraft.test.ts`
  Expected: PASS — both files green, no skipped paid suites.

- [ ] **Step 4:** No code changes in this task; confirm the tree is clean (all slice changes committed in Tasks 19–22).

  Run: `git status --short`
  Expected: **no output** (clean working tree).

---

**Slice notes for the executor**

- **Sequencing dependency (HARD):** Task 18 is a fail-fast gate. Task 22 Step 5 (`yarn type-check`) and Task 23 Step 2 require the **protocol slice** (`AgentConfig.allowedSkills?`/`allowedMcpServers?`) to have landed. `AgentEditor.tsx` reads `initial?.allowedSkills` / `initial?.allowedMcpServers`, and `buildAgentDraft`'s internal branch returns them. Land protocol first; if Task 18's grep returns nothing, **stop**.
- **`agentTools.ts` / `agentDraft.ts` are intentionally not whole-graph type-checked until Task 22**, because `agentDraft.ts` (Task 20) and `AgentEditor.tsx` (Task 22) import the old exports between commits. Each pure-helper task is independently green via its own `yarn vitest run` (vitest only loads the file under test + its direct imports — it does not type-check the unrelated editor). The first full `yarn type-check` is Task 22 Step 5.
- **`toolsHint` is fully removed** (the old "Choose what this agent is allowed to do" no longer fits the always-on model); `toolBuiltinNote` replaces its role inside the (repurposed) `sectionTools` section.
- **i18n type source is `zh-CN`** (`src/i18n/i18next.d.ts` → `resources: typeof zhCN`), not `en`. All three locales must change identically — a key present in `zh-CN` but missing in `en`/`zh-TW` (or vice-versa) breaks `t()` typing or runtime fallback. Task 21 Step 4 verifies parity.
- **Back-compat seeding:** `initial?.allowedMcpServers ?? grantedMcpServerIds(initial?.allowedTools)` — for a brand-new agent `initial` is `null`, so `initial?.allowedTools` is `undefined` and `grantedMcpServerIds(undefined)` returns `[]`. No separate `initial ? … : []` ternary is needed.
- **Sidecar-side** retirement of `filterTools`'s `mcp__<id>__*` wildcard branch, the read-path migration of `allowedTools`→`allowedMcpServers`, and `internal-runner.ts`/`agents/invoker.ts` pre-filtering (skills→`agent.allowedSkills`, mcpTools→`agent.allowedMcpServers`) plus `permissionMode` cascade are **out of this slice** (covered by the sidecar slices per the contract). This slice's `grantedMcpServerIds` keeps the frontend back-compat seam working independently.

Relevant absolute paths touched by this slice:
- `/Users/lijiamin/data/my-github/hip/src/lib/agentTools.ts` + `/Users/lijiamin/data/my-github/hip/src/lib/agentTools.test.ts`
- `/Users/lijiamin/data/my-github/hip/src/lib/agentDraft.ts` + `/Users/lijiamin/data/my-github/hip/src/lib/agentDraft.test.ts`
- `/Users/lijiamin/data/my-github/hip/src/components/account/AgentEditor.tsx`
- `/Users/lijiamin/data/my-github/hip/src/i18n/en.ts`, `/Users/lijiamin/data/my-github/hip/src/i18n/zh-CN.ts`, `/Users/lijiamin/data/my-github/hip/src/i18n/zh-TW.ts`
- (read-only dependency) `/Users/lijiamin/data/my-github/hip/packages/protocol/src/index.ts` — must already declare `AgentConfig.allowedSkills?` / `allowedMcpServers?`
