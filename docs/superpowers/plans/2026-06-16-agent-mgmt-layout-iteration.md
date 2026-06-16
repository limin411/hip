# 智能体管理 Layout Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the 智能体管理 settings page as a two-pane layout (left type-filter rail + right list pane), add an ACP provider-preset picker that reserves future providers, and add an in-app localized help drawer.

**Architecture:** Pure data/helpers in `src/lib/*` (TDD with `.test.ts`), presentational React components in `src/components/account/*` (verified by `tsc` + final browser-preview GUI pass — the project's vitest glob runs `*.test.ts` only, so component behavior is NOT unit-tested, matching the prior two iterations). No protocol, sidecar-runtime, or network changes; future ACP providers are `coming-soon` placeholders.

**Tech Stack:** React + Zustand + react-i18next (typed `t()` sourced from `zh-CN`), Radix Dialog, lucide-react icons, Tailwind tokens, Vitest (node env).

**Spec:** `docs/superpowers/specs/2026-06-16-agent-mgmt-layout-iteration-design.md`

---

## Ground rules (read before starting)

- **Paid-free testing.** Run only the specific test file: `yarn vitest run src/lib/<file>.test.ts`. NEVER run bare `yarn vitest run src` or `yarn test` — both substring-match `packages/sidecar/src` and fire paid real-LLM suites. The `src/lib` helper tests here touch no LLM, so a per-file run is safe.
- **Type-check** with `npx tsc --noEmit` from the repo root.
- **Typed `t()` source is `zh-CN`** ([src/i18n/i18next.d.ts](../../src/i18n/i18next.d.ts) → `resources: typeof zhCN`). Add every new key to `zh-CN.ts` (drives types + caught by tsc), then mirror the same keys into `en.ts` and `zh-TW.ts` for runtime (NOT type-checked — verify by hand). All three files end in `} as const`; insert new keys inside the existing `settings.agents` object.
- **Don't add `.test.tsx` files** — the vitest glob ignores them; they silently never run.
- Commit after each task with the shown message.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/agentFilters.ts` (new) | Left-rail filter model: `AgentFilter` type, `AGENT_FILTERS` entries, `agentFilterCounts()` |
| `src/lib/acpPresets.ts` (new) | ACP provider preset catalog (OpenCode available; others reserved) |
| `src/lib/agentHelp.ts` (new) | Help-drawer content model: `HELP_SECTIONS`, `helpSectionById()` |
| `src/components/account/AgentFilterList.tsx` (new) | Left rail UI |
| `src/components/account/AgentListPane.tsx` (new) | Right pane UI (all / builtin / per-category) |
| `src/components/account/AcpProviderPicker.tsx` (new) | Provider-preset cards (new-ACP step) |
| `src/components/account/AgentHelpDrawer.tsx` (new) | Right-side non-modal help drawer |
| `src/components/account/AgentManagement.tsx` (modify) | Two-pane composition + filter/help state |
| `src/components/account/AgentEditor.tsx` (modify) | ACP picker step + preset seeding + `onOpenHelp` |
| `src/i18n/{zh-CN,en,zh-TW}.ts` (modify) | New keys |
| `packages/sidecar/src/session/agents/acp-quirks.ts` (modify) | Reserve comment |
| `packages/sidecar/src/session/agents/acp-config.ts` (modify) | Reserve comment |

---

## Task 1: Filter model — `src/lib/agentFilters.ts`

**Files:**
- Create: `src/lib/agentFilters.ts`
- Test: `src/lib/agentFilters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { AGENT_FILTERS, agentFilterCounts } from './agentFilters'

function a(kind: AgentConfig['kind']): AgentConfig {
  return { id: Math.random().toString(36).slice(2), name: 'X', kind, command: '', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }
}

describe('AGENT_FILTERS', () => {
  it('lists the five entries in order', () => {
    expect(AGENT_FILTERS.map((f) => f.id)).toEqual(['all', 'builtin', 'internal', 'cli', 'acp'])
  })
})

describe('agentFilterCounts', () => {
  it('counts an empty roster as just the built-in', () => {
    expect(agentFilterCounts([])).toEqual({ all: 1, builtin: 1, acp: 0, cli: 0, internal: 0 })
  })
  it('counts a mixed roster by category, all = agents + builtin', () => {
    const agents = [a('internal'), a('internal'), a('custom'), a('acp'), a('opencode')]
    expect(agentFilterCounts(agents)).toEqual({ all: 6, builtin: 1, internal: 2, cli: 1, acp: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/agentFilters.test.ts`
Expected: FAIL — cannot find module `./agentFilters`.

- [ ] **Step 3: Write the implementation**

```ts
import type { AgentConfig } from '@hip/protocol'
import { agentCategory, type AgentCategory } from './agentCategory'

export type AgentFilter = 'all' | 'builtin' | AgentCategory // 'all' | 'builtin' | 'acp' | 'cli' | 'internal'
export type AgentFilterIcon = 'layout-grid' | 'sparkles' | 'bot' | 'terminal' | 'plug'

export interface AgentFilterEntry {
  id: AgentFilter
  icon: AgentFilterIcon
}

/** Fixed, ordered rail entries: overview, built-in, then the three categories. */
export const AGENT_FILTERS: AgentFilterEntry[] = [
  { id: 'all', icon: 'layout-grid' },
  { id: 'builtin', icon: 'sparkles' },
  { id: 'internal', icon: 'bot' },
  { id: 'cli', icon: 'terminal' },
  { id: 'acp', icon: 'plug' },
]

/**
 * Per-entry counts. builtin is always 1 (the single hip core agent); all = builtin + every
 * configured agent; internal/cli/acp = configured agents in that category.
 */
export function agentFilterCounts(agents: AgentConfig[]): Record<AgentFilter, number> {
  const counts: Record<AgentFilter, number> = { all: agents.length + 1, builtin: 1, acp: 0, cli: 0, internal: 0 }
  for (const agent of agents) counts[agentCategory(agent)] += 1
  return counts
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/agentFilters.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentFilters.ts src/lib/agentFilters.test.ts
git commit -m "feat(agents): left-rail filter model (agentFilters)"
```

---

## Task 2: ACP preset catalog — `src/lib/acpPresets.ts`

**Files:**
- Create: `src/lib/acpPresets.ts`
- Test: `src/lib/acpPresets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { ACP_PRESETS, acpPresetById, CUSTOM_ACP_PRESET_ID } from './acpPresets'

describe('ACP_PRESETS', () => {
  it('has a single, available OpenCode preset that seeds the OpenCode defaults', () => {
    const oc = ACP_PRESETS.filter((p) => p.id === 'opencode')
    expect(oc).toHaveLength(1)
    expect(oc[0].status).toBe('available')
    expect(oc[0].command).not.toBe('')
    expect(oc[0].quirks).toBe('opencode')
    expect(oc[0].authModeDefault).toBe('opencode-self')
  })

  it('reserves claude-code, codex and kimi-code as coming-soon with no command', () => {
    for (const id of ['claude-code', 'codex', 'kimi-code']) {
      const p = acpPresetById(id)
      expect(p?.status).toBe('coming-soon')
      expect(p?.command).toBe('')
    }
  })

  it('has unique preset ids and unique docsIds', () => {
    const ids = ACP_PRESETS.map((p) => p.id)
    const docs = ACP_PRESETS.map((p) => p.docsId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(docs).size).toBe(docs.length)
  })

  it('looks presets up by id', () => {
    expect(acpPresetById('opencode')?.name).toBe('OpenCode')
    expect(acpPresetById('nope')).toBeUndefined()
    expect(CUSTOM_ACP_PRESET_ID).toBe('custom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/acpPresets.test.ts`
Expected: FAIL — cannot find module `./acpPresets`.

- [ ] **Step 3: Write the implementation**

```ts
import type { AgentAuthMode } from '@hip/protocol'

export type AcpPresetStatus = 'available' | 'coming-soon'
export type AcpPresetIcon = 'code' | 'bot' | 'cpu' | 'rocket'

export interface AcpPreset {
  id: string
  name: string // brand label, NOT localized
  status: AcpPresetStatus
  command: string // default executable; '' for coming-soon
  args: string[] // default launch args; [] for coming-soon
  quirks?: string // quirk-profile key (packages/sidecar/.../acp-quirks.ts)
  authModeDefault?: AgentAuthMode
  docsId: string // → src/lib/agentHelp.ts section id
  icon: AcpPresetIcon
}

export const ACP_PRESETS: AcpPreset[] = [
  { id: 'opencode', name: 'OpenCode', status: 'available', command: 'opencode', args: ['acp'], quirks: 'opencode', authModeDefault: 'opencode-self', docsId: 'acp-opencode', icon: 'code' },
  { id: 'claude-code', name: 'Claude Code', status: 'coming-soon', command: '', args: [], docsId: 'acp-claude-code', icon: 'bot' },
  { id: 'codex', name: 'Codex', status: 'coming-soon', command: '', args: [], docsId: 'acp-codex', icon: 'cpu' },
  { id: 'kimi-code', name: 'Kimi Code', status: 'coming-soon', command: '', args: [], docsId: 'acp-kimi-code', icon: 'rocket' },
]

/** The 自定义 / 通用 escape hatch — not a real preset; the picker handles it separately. */
export const CUSTOM_ACP_PRESET_ID = 'custom'

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/acpPresets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/acpPresets.ts src/lib/acpPresets.test.ts
git commit -m "feat(agents): ACP provider preset catalog (reserve-only)"
```

---

## Task 3: Help content model — `src/lib/agentHelp.ts`

**Files:**
- Create: `src/lib/agentHelp.ts`
- Test: `src/lib/agentHelp.test.ts`

Note: `HELP_SECTIONS` is declared `as const` so every i18n key stays a string literal (the typed-`t()` union accepts only literal keys; a widening `string[]` interface would break it). `status` is present on every section (uniform union access). `HelpSection` is derived from the array.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { HELP_SECTIONS, helpSectionById } from './agentHelp'
import { ACP_PRESETS } from './acpPresets'

describe('HELP_SECTIONS', () => {
  it('has unique ids', () => {
    const ids = HELP_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a help section for every ACP preset docsId', () => {
    for (const preset of ACP_PRESETS) {
      expect(helpSectionById(preset.docsId), `missing help for ${preset.docsId}`).toBeDefined()
    }
  })

  it('marks coming-soon providers and keeps OpenCode available', () => {
    expect(helpSectionById('acp-opencode')?.status).toBe('available')
    for (const id of ['acp-claude-code', 'acp-codex', 'acp-kimi-code']) {
      expect(helpSectionById(id)?.status).toBe('coming-soon')
    }
  })

  it('resolves overview and returns undefined for an unknown id', () => {
    expect(helpSectionById('overview')?.status).toBe('available')
    expect(helpSectionById('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/agentHelp.test.ts`
Expected: FAIL — cannot find module `./agentHelp`.

- [ ] **Step 3: Write the implementation**

```ts
export type HelpStatus = 'available' | 'coming-soon'

/** `as const` keeps every i18n key a string literal so typed-t() accepts it. */
export const HELP_SECTIONS = [
  { id: 'overview', status: 'available', titleKey: 'settings.agents.help.overviewTitle', bodyKeys: ['settings.agents.help.overviewBody1', 'settings.agents.help.overviewBody2'] },
  { id: 'internal', status: 'available', titleKey: 'settings.agents.help.internalTitle', bodyKeys: ['settings.agents.help.internalBody1', 'settings.agents.help.internalBody2'] },
  { id: 'cli', status: 'available', titleKey: 'settings.agents.help.cliTitle', bodyKeys: ['settings.agents.help.cliBody1', 'settings.agents.help.cliBody2'] },
  { id: 'acp', status: 'available', titleKey: 'settings.agents.help.acpTitle', bodyKeys: ['settings.agents.help.acpBody1', 'settings.agents.help.acpBody2'] },
  { id: 'acp-opencode', status: 'available', titleKey: 'settings.agents.help.opencodeTitle', bodyKeys: ['settings.agents.help.opencodeBody1', 'settings.agents.help.opencodeBody2', 'settings.agents.help.opencodeBody3'] },
  { id: 'acp-claude-code', status: 'coming-soon', titleKey: 'settings.agents.help.claudeTitle', bodyKeys: ['settings.agents.help.comingSoonBody'] },
  { id: 'acp-codex', status: 'coming-soon', titleKey: 'settings.agents.help.codexTitle', bodyKeys: ['settings.agents.help.comingSoonBody'] },
  { id: 'acp-kimi-code', status: 'coming-soon', titleKey: 'settings.agents.help.kimiTitle', bodyKeys: ['settings.agents.help.comingSoonBody'] },
] as const

export type HelpSection = (typeof HELP_SECTIONS)[number]

export function helpSectionById(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/agentHelp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentHelp.ts src/lib/agentHelp.test.ts
git commit -m "feat(agents): help-drawer content model (agentHelp)"
```

---

## Task 4: i18n keys (all three locales)

**Files:**
- Modify: `src/i18n/zh-CN.ts` (type source — add first)
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-TW.ts`

Insert the new keys inside the existing `settings.agents` object (after `badgeGlobalModel`, before the object's closing `}`). The `help` sub-object holds all drawer content. Keep keys identical across the three files; only the values differ.

- [ ] **Step 1: zh-CN — add to `settings.agents`**

```ts
        filterAll: '全部',
        filterBuiltin: '内置核心',
        filterInternal: '内部',
        filterCli: '命令行',
        filterAcp: 'ACP',
        builtinOnlyNote: '内置核心智能体由 hip 提供，不可编辑或删除。',
        helpButton: '如何接入',
        acpPickTitle: '新增 ACP — 选择提供方',
        acpPresetAvailable: '现已支持',
        acpPresetComingSoon: '即将支持',
        acpPresetCustom: '自定义 / 通用',
        acpPresetCustomDesc: '手填命令与参数',
        viewDocs: '查看接入文档',
        backToProviders: '← 返回选择提供方',
        help: {
          title: '如何接入智能体',
          overviewTitle: '三类智能体总览',
          overviewBody1: 'hip 是唯一的顶层智能体；这里配置的都是它可调度的「子智能体」，共三类：内部管理、命令行（CLI）、ACP 对接。',
          overviewBody2: '内部 = 仅提示词、跑在 hip 自己的循环上；CLI = 通过命令行子进程接入的外部智能体；ACP = 通过 Agent Client Protocol 接入、可流式展示推理与工具调用的富交互智能体。',
          internalTitle: '内部管理智能体',
          internalBody1: '在「内部」分区点「新增内部智能体」。填写名称、使用场景（hip 据此决定何时委派）、以及提示词（定义其角色与工作方式）。',
          internalBody2: '可为它单独选一个模型（留空则用全局模型），并勾选它能使用的工具（读取/编辑/计划/Git）。它不会再向下委派（深度 1）。',
          cliTitle: '命令行（CLI）接入',
          cliBody1: '在「命令行」分区点「新增命令行智能体」。填写可执行命令（PATH 名或绝对路径）与启动参数。',
          cliBody2: '协议选「精简」适配任意 CLI（纯文本），选「丰富」可解析 JSON 事件流并展示思考过程。也可把你配置的模型与密钥推送给它。',
          acpTitle: 'ACP 对接',
          acpBody1: 'ACP（Agent Client Protocol）让外部智能体以富交互方式接入：流式推理、工具调用卡片、同步的人工确认（HITL）、运行时切换模型。',
          acpBody2: '新增 ACP 时先选择「提供方」。目前 OpenCode 已支持；Claude Code、Codex、Kimi Code 即将支持。也可选「自定义 / 通用」手填命令。',
          opencodeTitle: 'OpenCode',
          opencodeBody1: '先在系统中安装 OpenCode 并完成其自身登录（opencode auth）。',
          opencodeBody2: '在 ACP 提供方里选 OpenCode；命令会自动填为「opencode acp」，无需改动。认证默认「OpenCode 自管」（用它自己的密钥）；若想由 hip 托管模型与密钥，切换为「hip 托管」并绑定一个模型。',
          opencodeBody3: '保存并启用后，hip 即可把它作为子智能体调度，并在对话中实时展示其推理与工具调用。',
          claudeTitle: 'Claude Code',
          codexTitle: 'Codex',
          kimiTitle: 'Kimi Code',
          comingSoonBody: '该提供方的 ACP 接入正在开发中，敬请期待。当前可先使用 OpenCode，或通过「自定义 / 通用」手动接入兼容 ACP 的命令。',
        },
```

- [ ] **Step 2: en — add the same keys to `settings.agents`**

```ts
        filterAll: 'All',
        filterBuiltin: 'Built-in',
        filterInternal: 'Internal',
        filterCli: 'CLI',
        filterAcp: 'ACP',
        builtinOnlyNote: 'The built-in core agent is provided by hip and cannot be edited or removed.',
        helpButton: 'How to connect',
        acpPickTitle: 'New ACP agent — pick a provider',
        acpPresetAvailable: 'Available',
        acpPresetComingSoon: 'Coming soon',
        acpPresetCustom: 'Custom / generic',
        acpPresetCustomDesc: 'Enter command and args manually',
        viewDocs: 'View docs',
        backToProviders: '← Back to providers',
        help: {
          title: 'How to connect agents',
          overviewTitle: 'Overview',
          overviewBody1: 'hip is the only top-level agent. Everything configured here is a sub-agent it can dispatch, in three categories: internal, CLI, and ACP.',
          overviewBody2: 'Internal agents are prompt-only and run on hip\'s own loop; CLI agents connect through a command-line subprocess; ACP agents connect over the Agent Client Protocol with streamed reasoning and tool-call cards.',
          internalTitle: 'Internal managed agents',
          internalBody1: 'In the Internal section, click "New internal agent". Give it a name, a when-to-use description (hip uses it to decide when to delegate), and a system prompt that defines its role.',
          internalBody2: 'You can bind a dedicated model (leave empty to use the global model) and check the tools it may use (read / edit / plan / git). It does not delegate further (depth 1).',
          cliTitle: 'CLI agents',
          cliBody1: 'In the CLI section, click "New CLI agent". Enter the executable (a PATH name or absolute path) and its launch arguments.',
          cliBody2: 'Choose "thin" transport for plain text (works with any CLI) or "rich" to parse a JSON event stream and show reasoning. You may also push your configured model and key to it.',
          acpTitle: 'ACP agents',
          acpBody1: 'ACP (Agent Client Protocol) connects an external agent richly: streamed reasoning, tool-call cards, synchronous human approval (HITL), and runtime model switching.',
          acpBody2: 'When adding an ACP agent, first pick a provider. OpenCode is supported today; Claude Code, Codex and Kimi Code are coming soon. You can also pick "Custom / generic" to enter a command by hand.',
          opencodeTitle: 'OpenCode',
          opencodeBody1: 'First install OpenCode on your system and complete its own login (opencode auth).',
          opencodeBody2: 'Pick OpenCode in the provider step; the command is filled in as "opencode acp" automatically. Auth defaults to "OpenCode self-managed" (its own key); switch to "hip-managed" to push a hip-bound model and key instead.',
          opencodeBody3: 'Save and enable it, and hip can dispatch it as a sub-agent, showing its reasoning and tool calls live in the conversation.',
          claudeTitle: 'Claude Code',
          codexTitle: 'Codex',
          kimiTitle: 'Kimi Code',
          comingSoonBody: 'ACP support for this provider is in development. For now, use OpenCode, or connect a compatible ACP command via "Custom / generic".',
        },
```

- [ ] **Step 3: zh-TW — add the same keys to `settings.agents`**

```ts
        filterAll: '全部',
        filterBuiltin: '內建核心',
        filterInternal: '內部',
        filterCli: '命令列',
        filterAcp: 'ACP',
        builtinOnlyNote: '內建核心智能體由 hip 提供，不可編輯或刪除。',
        helpButton: '如何接入',
        acpPickTitle: '新增 ACP — 選擇提供方',
        acpPresetAvailable: '現已支援',
        acpPresetComingSoon: '即將支援',
        acpPresetCustom: '自訂 / 通用',
        acpPresetCustomDesc: '手填命令與參數',
        viewDocs: '查看接入文件',
        backToProviders: '← 返回選擇提供方',
        help: {
          title: '如何接入智能體',
          overviewTitle: '三類智能體總覽',
          overviewBody1: 'hip 是唯一的頂層智能體；這裡設定的都是它可調度的「子智能體」，共三類：內部管理、命令列（CLI）、ACP 接入。',
          overviewBody2: '內部 = 僅提示詞、跑在 hip 自己的循環上；CLI = 透過命令列子行程接入的外部智能體；ACP = 透過 Agent Client Protocol 接入、可串流展示推理與工具呼叫的富互動智能體。',
          internalTitle: '內部管理智能體',
          internalBody1: '在「內部」分區點「新增內部智能體」。填寫名稱、使用場景（hip 據此決定何時委派）、以及提示詞（定義其角色與工作方式）。',
          internalBody2: '可為它單獨選一個模型（留空則用全域模型），並勾選它能使用的工具（讀取/編輯/計劃/Git）。它不會再向下委派（深度 1）。',
          cliTitle: '命令列（CLI）接入',
          cliBody1: '在「命令列」分區點「新增命令列智能體」。填寫可執行命令（PATH 名或絕對路徑）與啟動參數。',
          cliBody2: '協定選「精簡」適配任意 CLI（純文字），選「豐富」可解析 JSON 事件流並展示思考過程。也可把你設定的模型與金鑰推送給它。',
          acpTitle: 'ACP 接入',
          acpBody1: 'ACP（Agent Client Protocol）讓外部智能體以富互動方式接入：串流推理、工具呼叫卡片、同步的人工確認（HITL）、執行時切換模型。',
          acpBody2: '新增 ACP 時先選擇「提供方」。目前 OpenCode 已支援；Claude Code、Codex、Kimi Code 即將支援。也可選「自訂 / 通用」手填命令。',
          opencodeTitle: 'OpenCode',
          opencodeBody1: '先在系統中安裝 OpenCode 並完成其自身登入（opencode auth）。',
          opencodeBody2: '在 ACP 提供方裡選 OpenCode；命令會自動填為「opencode acp」，無需改動。認證預設「OpenCode 自管」（用它自己的金鑰）；若想由 hip 托管模型與金鑰，切換為「hip 托管」並綁定一個模型。',
          opencodeBody3: '儲存並啟用後，hip 即可把它作為子智能體調度，並在對話中即時展示其推理與工具呼叫。',
          claudeTitle: 'Claude Code',
          codexTitle: 'Codex',
          kimiTitle: 'Kimi Code',
          comingSoonBody: '該提供方的 ACP 接入正在開發中，敬請期待。目前可先使用 OpenCode，或透過「自訂 / 通用」手動接入相容 ACP 的命令。',
        },
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (0 errors). zh-CN drives the typed-t resource type; the new keys now exist for later component tasks.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/en.ts src/i18n/zh-TW.ts
git commit -m "i18n(agents): filters, provider-picker, and help-drawer strings"
```

---

## Task 5: Left rail — `src/components/account/AgentFilterList.tsx`

**Files:**
- Create: `src/components/account/AgentFilterList.tsx`

No unit test (component). Verify with `tsc`; GUI verified in Task 12.

- [ ] **Step 1: Write the component**

```tsx
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Sparkles, Bot, Terminal, Plug, type LucideIcon } from 'lucide-react'
import { AGENT_FILTERS, type AgentFilter, type AgentFilterIcon } from '@/lib/agentFilters'
import { cn } from '@/lib/utils'

const ICONS: Record<AgentFilterIcon, LucideIcon> = {
  'layout-grid': LayoutGrid,
  sparkles: Sparkles,
  bot: Bot,
  terminal: Terminal,
  plug: Plug,
}

/** Left master pane: a fixed type-filter rail (no search — only five entries). */
export function AgentFilterList({
  active,
  counts,
  onSelect,
}: {
  active: AgentFilter
  counts: Record<AgentFilter, number>
  onSelect: (filter: AgentFilter) => void
}) {
  const { t } = useTranslation()
  const label = (id: AgentFilter) => {
    switch (id) {
      case 'all': return t('settings.agents.filterAll')
      case 'builtin': return t('settings.agents.filterBuiltin')
      case 'internal': return t('settings.agents.filterInternal')
      case 'cli': return t('settings.agents.filterCli')
      case 'acp': return t('settings.agents.filterAcp')
    }
  }
  return (
    <div className="w-[184px] shrink-0 self-start overflow-hidden rounded-lg border border-border p-1.5">
      {AGENT_FILTERS.map((entry) => {
        const Icon = ICONS[entry.icon]
        const isActive = entry.id === active
        return (
          <button
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body transition-colors',
              isActive ? 'bg-accent-active font-medium text-accent-strong' : 'text-ink-secondary hover:bg-surface-muted',
            )}
          >
            <Icon size={16} className="shrink-0" />
            <span className="flex-1 truncate">{label(entry.id)}</span>
            <span className={cn('text-caption', isActive ? 'text-accent-strong' : 'text-ink-tertiary')}>{counts[entry.id]}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentFilterList.tsx
git commit -m "feat(ui): agent type-filter left rail"
```

---

## Task 6: Provider picker — `src/components/account/AcpProviderPicker.tsx`

**Files:**
- Create: `src/components/account/AcpProviderPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useTranslation } from 'react-i18next'
import { Code, Bot, Cpu, Rocket, Settings2, CircleCheck, type LucideIcon } from 'lucide-react'
import { ACP_PRESETS, type AcpPreset, type AcpPresetIcon } from '@/lib/acpPresets'
import { cn } from '@/lib/utils'

const ICONS: Record<AcpPresetIcon, LucideIcon> = { code: Code, bot: Bot, cpu: Cpu, rocket: Rocket }

/** Step 1 of adding a new ACP agent: choose a provider preset (or the custom escape hatch). */
export function AcpProviderPicker({
  onPick,
  onPickCustom,
  onOpenDocs,
}: {
  onPick: (preset: AcpPreset) => void
  onPickCustom: () => void
  onOpenDocs: (sectionId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {ACP_PRESETS.map((preset) => {
        const Icon = ICONS[preset.icon]
        const available = preset.status === 'available'
        return (
          <div
            key={preset.id}
            role={available ? 'button' : undefined}
            tabIndex={available ? 0 : undefined}
            onClick={available ? () => onPick(preset) : undefined}
            onKeyDown={available ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(preset) } } : undefined}
            className={cn(
              'rounded-lg border px-3 py-2.5 transition-colors',
              available ? 'cursor-pointer border-border hover:border-accent hover:bg-accent-subtle' : 'border-border opacity-70',
            )}
          >
            <div className="flex items-center gap-2">
              <Icon size={18} className={available ? 'text-accent-strong' : 'text-ink-tertiary'} />
              <span className={cn('text-body font-medium', available ? 'text-ink' : 'text-ink-secondary')}>{preset.name}</span>
            </div>
            {available ? (
              <div className="mt-1.5 flex items-center gap-1 text-caption text-success">
                <CircleCheck size={13} /> {t('settings.agents.acpPresetAvailable')}
              </div>
            ) : (
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-caption text-ink-tertiary">{t('settings.agents.acpPresetComingSoon')}</span>
                <button
                  type="button"
                  className="text-caption text-accent-strong hover:underline"
                  onClick={(e) => { e.stopPropagation(); onOpenDocs(preset.docsId) }}
                >
                  {t('settings.agents.viewDocs')}
                </button>
              </div>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={onPickCustom}
        className="rounded-lg border border-dashed border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-muted"
      >
        <div className="flex items-center gap-2">
          <Settings2 size={18} className="text-ink-secondary" />
          <span className="text-body font-medium text-ink">{t('settings.agents.acpPresetCustom')}</span>
        </div>
        <div className="mt-1.5 text-caption text-ink-tertiary">{t('settings.agents.acpPresetCustomDesc')}</div>
      </button>
    </div>
  )
}
```

Note: if `text-success` is not a defined Tailwind text color in this project, fall back to `text-ink-secondary` for the available line (check `tailwind.config` `colors.success`; `bg-success` is already used in [AgentCard.tsx](../../src/components/account/AgentCard.tsx), so the `success` color exists — `text-success` should resolve).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AcpProviderPicker.tsx
git commit -m "feat(ui): ACP provider preset picker"
```

---

## Task 7: Help drawer — `src/components/account/AgentHelpDrawer.tsx`

**Files:**
- Create: `src/components/account/AgentHelpDrawer.tsx`

Built on Radix Dialog with `modal={false}` + an own scrim, both `pointer-events-auto`. Rationale (from spec §C.2): the drawer can be opened from inside the open `AgentEditor` modal, which sets `body{pointer-events:none}`; `modal={false}` means this drawer never adds a second lock, and `pointer-events-auto` keeps the drawer interactive even under the editor's body-lock. This avoids the documented stuck-pointer-events footgun.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { HELP_SECTIONS, helpSectionById } from '@/lib/agentHelp'
import { cn } from '@/lib/utils'

/** Right-anchored, non-modal help drawer with a section mini-nav. Deep-linkable via `sectionId`. */
export function AgentHelpDrawer({
  open,
  sectionId,
  onOpenChange,
}: {
  open: boolean
  sectionId?: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<string>(sectionId ?? 'overview')
  useEffect(() => {
    if (open) setCurrent(sectionId ?? 'overview')
  }, [open, sectionId])

  const section = helpSectionById(current) ?? HELP_SECTIONS[0]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        {open && (
          <div className="pointer-events-auto fixed inset-0 z-40 bg-ink/30" onClick={() => onOpenChange(false)} />
        )}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className="pointer-events-auto fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-border bg-surface shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="text-body font-semibold text-ink">{t('settings.agents.help.title')}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1">
            <nav className="w-[136px] shrink-0 overflow-y-auto border-r border-border py-2">
              {HELP_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setCurrent(s.id)}
                  className={cn(
                    'block w-full px-3 py-1.5 text-left text-caption transition-colors',
                    s.id.startsWith('acp-') && 'pl-5',
                    s.id === current ? 'font-medium text-accent-strong' : 'text-ink-secondary hover:text-ink',
                  )}
                >
                  {t(s.titleKey)}
                  {s.status === 'coming-soon' && <span className="ml-1 text-ink-tertiary">· {t('settings.agents.acpPresetComingSoon')}</span>}
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              <h3 className="text-title font-semibold text-ink">{t(section.titleKey)}</h3>
              <div className="mt-3 space-y-3">
                {section.bodyKeys.map((key) => (
                  <p key={key} className="whitespace-pre-line text-body leading-relaxed text-ink-secondary">{t(key)}</p>
                ))}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (If `t(s.titleKey)` / `t(key)` raise a typed-key error, confirm `HELP_SECTIONS` is `as const` from Task 3 — that is what keeps the keys as literals.)

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentHelpDrawer.tsx
git commit -m "feat(ui): in-app agent help drawer (non-modal, deep-linkable)"
```

---

## Task 8: Right pane — `src/components/account/AgentListPane.tsx`

**Files:**
- Create: `src/components/account/AgentListPane.tsx`

Moves the current overview rendering (built-in card + three sections + 3-item Add menu) here for the `all` filter, and adds the `builtin` and single-category branches.

- [ ] **Step 1: Write the component**

```tsx
import { useTranslation } from 'react-i18next'
import { Bot, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import type { AgentCategory } from '@/lib/agentCategory'
import type { AgentFilter } from '@/lib/agentFilters'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { BuiltinCard, AgentCard } from './AgentCard'

type EmptyKey = 'settings.agents.catInternalEmpty' | 'settings.agents.catCliEmpty' | 'settings.agents.catAcpEmpty'

const SECTIONS = [
  { cat: 'internal' as AgentCategory, titleKey: 'settings.agents.sectionInternal' as const, emptyKey: 'settings.agents.catInternalEmpty' as const, kind: 'internal' as AgentConfig['kind'], addKey: 'settings.agents.addInternal' as const },
  { cat: 'cli' as AgentCategory, titleKey: 'settings.agents.sectionCli' as const, emptyKey: 'settings.agents.catCliEmpty' as const, kind: 'custom' as AgentConfig['kind'], addKey: 'settings.agents.addCli' as const },
  { cat: 'acp' as AgentCategory, titleKey: 'settings.agents.sectionAcp' as const, emptyKey: 'settings.agents.catAcpEmpty' as const, kind: 'acp' as AgentConfig['kind'], addKey: 'settings.agents.addAcp' as const },
]

export function AgentListPane({
  filter,
  byCat,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  filter: AgentFilter
  byCat: Record<AgentCategory, AgentConfig[]>
  onAdd: (kind: AgentConfig['kind']) => void
  onEdit: (agent: AgentConfig) => void
  onToggle: (agent: AgentConfig, enabled: boolean) => void
  onDelete: (agent: AgentConfig) => void
}) {
  const { t } = useTranslation()

  const card = (agent: AgentConfig) => (
    <AgentCard
      key={agent.id}
      agent={agent}
      onToggle={(enabled) => onToggle(agent, enabled)}
      onEdit={() => onEdit(agent)}
      onDelete={() => onDelete(agent)}
    />
  )

  const empty = (key: EmptyKey) => (
    <div className="rounded-lg border border-dashed border-border py-5 text-center text-meta text-ink-tertiary">{t(key)}</div>
  )

  if (filter === 'builtin') {
    return (
      <div className="min-w-0 flex-1 space-y-2">
        <BuiltinCard />
        <div className="px-1 text-caption text-ink-tertiary">{t('settings.agents.builtinOnlyNote')}</div>
      </div>
    )
  }

  if (filter === 'internal' || filter === 'cli' || filter === 'acp') {
    const section = SECTIONS.find((s) => s.cat === filter)!
    const list = byCat[filter]
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-body font-medium text-ink">{t(section.titleKey)}</div>
          <button
            onClick={() => onAdd(section.kind)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta font-medium text-accent-strong transition-colors hover:bg-accent-subtle"
          >
            <Plus size={14} /> {t(section.addKey)}
          </button>
        </div>
        <div className="space-y-2">{list.length === 0 ? empty(section.emptyKey) : list.map(card)}</div>
      </div>
    )
  }

  // filter === 'all' — overview
  return (
    <div className="min-w-0 flex-1">
      <BuiltinCard />
      {SECTIONS.map((s) => (
        <div key={s.cat} className="mt-6">
          <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{t(s.titleKey)}</div>
          <div className="space-y-2">{byCat[s.cat].length === 0 ? empty(s.emptyKey) : byCat[s.cat].map(card)}</div>
        </div>
      ))}
      <div className="mt-6">
        {/* modal={false}: the menu opens a Modal; stacking two pointer-events locks freezes the app. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <Plus size={15} /> {t('settings.agents.add')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => onAdd('internal')}>
              <Bot size={14} /> {t('settings.agents.addInternal')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('custom')}>{t('settings.agents.addCli')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd('acp')}>{t('settings.agents.addAcp')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentListPane.tsx
git commit -m "feat(ui): agent list right-pane (all/builtin/per-category)"
```

---

## Task 9: ACP picker step in `AgentEditor.tsx`

**Files:**
- Modify: `src/components/account/AgentEditor.tsx`

Adds: an `onOpenHelp` prop, an `acpStep` state, the provider-picker branch for new ACP agents, preset seeding, a back link, and the pick-step title.

- [ ] **Step 1: Add imports**

After the existing imports (near `import { toolNamesToGroups, DEFAULT_TOOL_GROUPS } from '@/lib/agentTools'`), add:

```tsx
import { AcpProviderPicker } from './AcpProviderPicker'
import type { AcpPreset } from '@/lib/acpPresets'
```

- [ ] **Step 2: Add the `onOpenHelp` prop**

Change the component signature props to include `onOpenHelp`:

```tsx
export function AgentEditor({
  initial,
  initialKind,
  onSave,
  onCancel,
  onOpenHelp,
}: {
  initial: AgentConfig | null
  initialKind?: AgentConfig['kind']
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
  onOpenHelp?: (sectionId: string) => void
}) {
```

- [ ] **Step 3: Add step state + seeding helpers**

Immediately after the `const [error, setError] = useState<string | null>(null)` line, add:

```tsx
  const isNewAcp = !initial && initialKind === 'acp'
  const [acpStep, setAcpStep] = useState<'pick' | 'form'>(isNewAcp ? 'pick' : 'form')

  const pickPreset = (preset: AcpPreset) => {
    patch({ command: preset.command, args: preset.args.join(' '), quirks: preset.quirks, authMode: preset.authModeDefault ?? 'opencode-self', transport: 'rich' })
    setAcpStep('form')
  }
  const pickCustom = () => {
    patch({ command: '', args: '', quirks: undefined, authMode: 'opencode-self', transport: 'rich' })
    setAcpStep('form')
  }
```

(`patch` is already defined above; this code must come after it. If `patch` is declared below `error`, move these helpers to just after `patch`'s declaration.)

- [ ] **Step 4: Update the title to cover the pick step**

Replace the existing `const title = …` block with:

```tsx
  const title = initial
    ? t('settings.agents.editTitle')
    : isAcp && acpStep === 'pick'
      ? t('settings.agents.acpPickTitle')
      : t(isAcp ? 'settings.agents.addAcp' : isInternal ? 'settings.agents.addInternal' : 'settings.agents.addCli')
```

- [ ] **Step 5: Branch the modal body for the pick step**

The modal currently is:

```tsx
      <div className="flex flex-col">
        <div className="space-y-5 p-5">
          <Field label={t('settings.agents.name')}>
          …
```

Wrap so the pick step renders the picker + a Cancel-only footer, and the form step renders the existing body. Replace the opening `<div className="flex flex-col">` … through the end of the footer `</div>` with:

```tsx
      <div className="flex flex-col">
        {isAcp && acpStep === 'pick' ? (
          <>
            <div className="p-5">
              <AcpProviderPicker onPick={pickPreset} onPickCustom={pickCustom} onOpenDocs={(id) => onOpenHelp?.(id)} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3">
              <Button variant="outline" size="sm" onClick={onCancel}>
                {t('settings.agents.cancel')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-5 p-5">
              {isNewAcp && (
                <button type="button" onClick={() => setAcpStep('pick')} className="text-meta text-accent-strong transition-colors hover:underline">
                  {t('settings.agents.backToProviders')}
                </button>
              )}
              <Field label={t('settings.agents.name')}>
                {/* …everything that is currently inside the existing `space-y-5 p-5` div, unchanged… */}
              </Field>
              {/* …rest of the existing body (description, internal/non-internal branches, error)… */}
            </div>

            <div className="flex items-center gap-2 border-t border-border bg-surface-subtle px-5 py-3">
              {/* …existing footer (enable Switch + Cancel + Save), unchanged… */}
            </div>
          </>
        )}
      </div>
```

Concretely: keep the current `<div className="space-y-5 p-5"> … </div>` and footer `<div className="flex items-center gap-2 …"> … </div>` exactly as they are, but (a) nest them inside the `: (` … `)` else-branch shown above, (b) add the `{isNewAcp && (<button …>back</button>)}` as the first child of the `space-y-5 p-5` div. Do not change any field markup.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/account/AgentEditor.tsx
git commit -m "feat(ui): ACP provider-picker step + preset seeding in the editor"
```

---

## Task 10: Two-pane composition in `AgentManagement.tsx`

**Files:**
- Modify (rewrite): `src/components/account/AgentManagement.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HelpCircle } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { agentCategory, type AgentCategory } from '@/lib/agentCategory'
import { agentFilterCounts, type AgentFilter } from '@/lib/agentFilters'
import { AgentFilterList } from './AgentFilterList'
import { AgentListPane } from './AgentListPane'
import { AgentEditor } from './AgentEditor'
import { AgentHelpDrawer } from './AgentHelpDrawer'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [filter, setFilter] = useState<AgentFilter>('all')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)
  const [help, setHelp] = useState<{ open: boolean; sectionId?: string }>({ open: false })

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const byCat = useMemo(() => {
    const m: Record<AgentCategory, AgentConfig[]> = { acp: [], cli: [], internal: [] }
    for (const a of agents) m[agentCategory(a)].push(a)
    return m
  }, [agents])
  const counts = useMemo(() => agentFilterCounts(agents), [agents])

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>
        </div>
        <button
          onClick={() => setHelp({ open: true, sectionId: 'overview' })}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-meta text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <HelpCircle size={15} /> {t('settings.agents.helpButton')}
        </button>
      </div>

      <div className="mt-5 flex gap-3.5">
        <AgentFilterList active={filter} counts={counts} onSelect={setFilter} />
        <AgentListPane
          filter={filter}
          byCat={byCat}
          onAdd={(kind) => setEditing({ mode: 'add', kind })}
          onEdit={(a) => setEditing({ mode: 'edit', agent: a })}
          onToggle={(a, enabled) => void updateAgent(a.id, { enabled })}
          onDelete={(a) => setDeleting(a)}
        />
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
          initialKind={editing.mode === 'add' ? editing.kind : undefined}
          onOpenHelp={(id) => setHelp({ open: true, sectionId: id })}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateAgent(editing.agent.id, draft)
            else await addAgent(draft)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeleteAgentDialog
          agent={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void removeAgent(deleting.id)
            setDeleting(null)
          }}
        />
      )}

      <AgentHelpDrawer open={help.open} sectionId={help.sectionId} onOpenChange={(o) => setHelp((h) => ({ ...h, open: o }))} />
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentManagement.tsx
git commit -m "feat(ui): two-pane agent management (filter rail + list pane + help)"
```

---

## Task 11: Backend reserve comments (no behavior change)

**Files:**
- Modify: `packages/sidecar/src/session/agents/acp-quirks.ts`
- Modify: `packages/sidecar/src/session/agents/acp-config.ts`

- [ ] **Step 1: Comment in `acp-quirks.ts`**

Add the comment directly above the `PROFILES` declaration:

```ts
// Reserve point — future ACP providers (claude-code, codex, kimi-code) add their quirk profile here.
// Today only OpenCode is selectable in the provider picker (src/lib/acpPresets.ts); the others are
// 'coming-soon' placeholders, so no unimplemented profile can be reached at runtime.
const PROFILES: Record<string, Partial<AcpQuirks>> = {
  opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true },
}
```

- [ ] **Step 2: Comment in `acp-config.ts`**

Add the comment as the first line inside `buildAcpSpawn`, before `const env: …`:

```ts
export function buildAcpSpawn(agent: AgentConfig, model: ResolvedModel | null): AcpSpawn {
  // NOTE: this spawn path is OpenCode-shaped (writes opencode.json via OPENCODE_CONFIG). A future ACP
  // provider (claude-code/codex/kimi-code) will branch here on its preset/quirks. Reserved — not
  // reachable yet because only OpenCode is selectable in the provider picker (src/lib/acpPresets.ts).
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-quirks.ts packages/sidecar/src/session/agents/acp-config.ts
git commit -m "docs(acp): reserve-point comments for future ACP providers"
```

---

## Task 12: Full verification (types + paid-free tests + GUI)

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole repo**

Run: `npx tsc --noEmit`
Expected: clean (0 errors).

- [ ] **Step 2: Run the three new helper suites (paid-free)**

Run: `yarn vitest run src/lib/agentFilters.test.ts src/lib/acpPresets.test.ts src/lib/agentHelp.test.ts`
Expected: PASS (all). These touch no LLM. Do NOT broaden to `src` (fires paid sidecar suites).

- [ ] **Step 3: Browser-preview GUI verification**

Start/confirm the vite dev server (preview tools) with a mocked `__TAURI_INTERNALS__.invoke` returning a small agent roster (one internal, one CLI, one ACP/opencode). Navigate to 设置 → 智能体管理 and verify (via `preview_snapshot` / `preview_click`, using `textContent` not `innerText`, and PointerEvent sequences for Radix):
  - Left rail shows 全部 / 内置核心 / 内部 / CLI / ACP with correct counts; selecting each filters the right pane.
  - `全部` shows the built-in card pinned + three labeled sub-sections + the 3-item Add menu.
  - `内置核心` shows only the built-in card + the cannot-edit note.
  - A single-category view shows a direct `新增…` button; clicking it opens the editor at the right step.
  - New-ACP opens the provider picker: OpenCode selectable (→ seeds `opencode acp` into the form), Claude Code/Codex/Kimi Code disabled with a 「查看接入文档」 link, and the 自定义/通用 card → blank form. The 「← 返回选择提供方」 link returns to the picker.
  - The header 「如何接入」 opens the drawer at 概览; the picker's 「查看接入文档」 opens it at the right provider section.
  - Open the editor, then open the help drawer from inside it — confirm the drawer is interactive and closing it does NOT freeze the page (pointer-events not stuck).

- [ ] **Step 4: Final review + commit any GUI fixes**

If the GUI pass surfaces fixes, make them, re-run Steps 1-2, and commit:

```bash
git add -A
git commit -m "fix(ui): agent-management layout GUI follow-ups"
```

Then dispatch the final whole-implementation code review per subagent-driven-development before finishing the branch.

---

## Self-Review

**Spec coverage:**
- §A Two-pane layout → Tasks 1 (filter model), 5 (left rail), 8 (right pane), 10 (composition). ✓
- §B ACP presets → Tasks 2 (catalog), 6 (picker), 9 (editor step + seeding), 11 (reserve comments). ✓
- §C Help drawer → Tasks 3 (content model), 7 (drawer), wired in 9/10. ✓
- §D i18n → Task 4 (all three locales). ✓
- §E Testing → Tasks 1-3 unit tests + Task 12 GUI. ✓
- §F Files → every listed file has an owning task. ✓

**Placeholder scan:** No TBD/TODO. The one "fill in" reference (Task 9 Step 5) explicitly says to preserve the existing field/footer markup verbatim and points to exactly what moves — not a vague placeholder, since the existing code is the source.

**Type consistency:** `AgentFilter`, `AgentFilterIcon`, `AcpPreset`/`AcpPresetIcon`, `HelpSection`, `agentFilterCounts`, `acpPresetById`, `helpSectionById`, `onOpenHelp`, `pickPreset`/`pickCustom`, `acpStep` are used consistently across tasks. i18n keys referenced by components (`filterAll…`, `helpButton`, `acpPick*`, `acpPreset*`, `viewDocs`, `backToProviders`, `builtinOnlyNote`, `help.*`) all exist after Task 4. `HELP_SECTIONS` `as const` (Task 3) is what makes `t(section.titleKey)` type-check in Task 7.
