# Fixed Internal Agents (coder/explore/plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three fixed, non-deletable internal agents (coder/explore/plan) to the agent management UI, backed by existing sidecar agent profiles.

**Architecture:** Frontend hardcodes three fixed agent definitions. Their enable/disable state persists to `hip.toml` under `[fixedAgents]`. The backend already has matching `AgentProfile` definitions (plan, explore, worker); we add a `coder` profile extending `worker` with `run_script`. No CRUD — FixedAgentCard renders lock icon, no edit/delete buttons.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zustand, Vitest, TOML config

## Global Constraints

- Fixed agents are completely non-editable, non-deletable — enforced via component design (no edit/delete buttons rendered)
- Enable/disable toggle is the only user interaction
- Fixed agents appear above user-created agents in the management page
- Fixed agents use global model by default (no boundModel)
- `fixedAgents` section in hip.toml is optional; omission → all enabled
- Existing user agents in `agents` array are unaffected
- `BuiltinCard` component (currently dead code) is removed

---

### Task 1: Add `coder` agent profile to sidecar BUILTIN_PROFILES

**Files:**
- Modify: `packages/sidecar/src/session/agent-profile.ts:50-113`

**Interfaces:**
- Consumes: `AgentProfile` interface, `ALL_BUILTIN_TOOLS` constant (same file)
- Produces: `coder` profile entry in `BUILTIN_PROFILES` array

- [ ] **Step 1: Add coder profile entry**

Insert after the `worker` entry (line 112), before the closing `]`:

```typescript
  {
    id: 'coder',
    name: 'Coder',
    description:
      'General software engineering sub-agent. Reads, writes, edits files, runs scripts, and searches code. Blocked from write_todos so planning stays with the primary agent.',
    mode: 'subagent',
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'run_script',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
    blockedTools: ['write_todos'],
  },
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd packages/sidecar && npx tsc --noEmit src/session/agent-profile.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/session/agent-profile.ts
git commit -m "feat(sidecar): add coder agent profile (worker + run_script)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Add `fixedAgents` to `HipConfig` protocol type

**Files:**
- Modify: `packages/protocol/src/index.ts:759-768`

**Interfaces:**
- Consumes: `AgentConfig` type (same file)
- Produces: `fixedAgents` field on `HipConfig`

- [ ] **Step 1: Add the field**

Insert after `agents?: AgentConfig[]` (line 765):

```typescript
  /** Enable/disable state for fixed built-in agents (coder, explore, plan).
   *  Keyed by agent id; missing entries default to enabled. */
  fixedAgents?: Record<string, boolean>
```

The full interface should read:

```typescript
export interface HipConfig {
  version: number
  providers?: ProviderEntry[]
  activeModel?: ActiveModel
  mcpServers?: McpServerConfig[]
  skills?: SkillEntry[]
  agents?: AgentConfig[]
  /** Agent teams defined in hip.toml under `[[teams]]`. */
  teams?: import('./team-types.js').TeamConfig[]
  /** Enable/disable state for fixed built-in agents (coder, explore, plan).
   *  Keyed by agent id; missing entries default to enabled. */
  fixedAgents?: Record<string, boolean>
}
```

- [ ] **Step 2: Verify type-check**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add fixedAgents field to HipConfig

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Create fixed agent constants and unit test

**Files:**
- Create: `src/lib/fixedAgents.ts`
- Create: `src/lib/fixedAgents.test.ts`

**Interfaces:**
- Consumes: `AgentConfig` from `@hip/protocol`
- Produces: `FIXED_AGENTS: AgentConfig[]`, `FIXED_AGENT_IDS: string[]`

- [ ] **Step 1: Write the test file**

Create `src/lib/fixedAgents.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { FIXED_AGENTS, FIXED_AGENT_IDS } from './fixedAgents'

describe('FIXED_AGENTS', () => {
  it('contains exactly 3 agents', () => {
    expect(FIXED_AGENTS).toHaveLength(3)
  })

  it('has unique ids', () => {
    const ids = FIXED_AGENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all agents have kind "internal"', () => {
    for (const a of FIXED_AGENTS) {
      expect(a.kind).toBe('internal')
    }
  })

  it('all agents have required fields', () => {
    for (const a of FIXED_AGENTS) {
      expect(a.id).toBeTruthy()
      expect(a.name).toBeTruthy()
      expect(a.description).toBeTruthy()
      expect(a.prompt).toBeTruthy()
      expect(a.enabled).toBe(true)
    }
  })

  it('includes coder, explore, and plan', () => {
    expect(FIXED_AGENT_IDS).toEqual(['coder', 'explore', 'plan'])
  })

  it('coder has run_script in allowedTools', () => {
    const coder = FIXED_AGENTS.find((a) => a.id === 'coder')!
    expect(coder.allowedTools).toContain('run_script')
  })

  it('explore does not have write_file or run_script', () => {
    const explore = FIXED_AGENTS.find((a) => a.id === 'explore')!
    expect(explore.allowedTools).not.toContain('write_file')
    expect(explore.allowedTools).not.toContain('edit_file')
    expect(explore.allowedTools).not.toContain('run_script')
  })

  it('plan does not have run_script', () => {
    const plan = FIXED_AGENTS.find((a) => a.id === 'plan')!
    expect(plan.allowedTools).not.toContain('run_script')
    expect(plan.allowedTools).not.toContain('write_file')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/fixedAgents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the constants file**

Create `src/lib/fixedAgents.ts`:

```typescript
import type { AgentConfig } from '@hip/protocol'

/**
 * Three fixed, non-deletable internal agents.
 *
 * These are NOT stored in hip.toml's `agents` array. Their enable/disable
 * state is persisted under `[fixedAgents]` in hip.toml.
 *
 * Tool restrictions mirror the corresponding sidecar AgentProfile entries
 * (see packages/sidecar/src/session/agent-profile.ts).
 */
export const FIXED_AGENTS: AgentConfig[] = [
  {
    id: 'coder',
    name: 'Coder',
    description:
      '默认子 Agent，通用软件工程助手，可读写文件、执行命令、搜索代码并落地具体改动。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a software engineering assistant. You can read and write files, execute shell commands, search code, and implement concrete changes. When given a task, break it down into steps and execute them methodically. Always verify your changes work correctly.`,
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'run_script',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
  },
  {
    id: 'explore',
    name: 'Explore',
    description:
      '代码库探索专用，只读操作，不修改文件。适合快速搜索、阅读和总结仓库。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a codebase exploration agent. You can read files, search code, and summarize findings — but you CANNOT modify any files, execute shell commands, or make any changes to the codebase. Your purpose is to understand, search, and report. When asked about the codebase, be thorough in your exploration before answering.`,
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
  },
  {
    id: 'plan',
    name: 'Plan',
    description:
      '实现规划与架构设计专用，不提供 Shell 命令，专注于"想清楚怎么做"。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a software architecture and planning agent. You focus on analyzing requirements, designing implementation approaches, and creating detailed plans. You do NOT have access to shell commands — your job is to think through the problem and produce a clear, actionable plan that others can execute. Consider trade-offs, edge cases, and existing codebase patterns in your analysis.`,
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_todos',
      'EnterPlanMode',
      'ExitPlanMode',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
  },
]

export const FIXED_AGENT_IDS = FIXED_AGENTS.map((a) => a.id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/fixedAgents.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fixedAgents.ts src/lib/fixedAgents.test.ts
git commit -m "feat: add fixed agent constants for coder/explore/plan

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Create FixedAgentCard component and test

**Files:**
- Create: `src/components/account/FixedAgentCard.tsx`
- Create: `src/components/account/FixedAgentCard.test.tsx`

**Interfaces:**
- Consumes: `AgentConfig` from `@hip/protocol`, Avatar, Badge, Switch UI primitives
- Produces: `FixedAgentCard` React component — `({ agent, enabled, onToggle }: Props) => JSX.Element`

- [ ] **Step 1: Write the test file**

Create `src/components/account/FixedAgentCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FixedAgentCard } from './FixedAgentCard'
import type { AgentConfig } from '@hip/protocol'

const coder: AgentConfig = {
  id: 'coder',
  name: 'Coder',
  description: '默认子 Agent，通用软件工程助手。',
  kind: 'internal',
  command: '',
  args: [],
  enabled: true,
  prompt: 'You are a coder.',
}

describe('FixedAgentCard', () => {
  it('renders agent name and description', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.getByText('Coder')).toBeInTheDocument()
    expect(screen.getByText('默认子 Agent，通用软件工程助手。')).toBeInTheDocument()
  })

  it('shows built-in badge', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.getByText(/内置|Built-in|內建/)).toBeInTheDocument()
  })

  it('shows lock icon', () => {
    const { container } = render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    // Lock icon is rendered via lucide-react Lock component
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('does NOT render edit button', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.queryByLabelText(/edit|编辑|編輯/i)).toBeNull()
  })

  it('does NOT render delete button', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.queryByLabelText(/delete|删除|刪除/i)).toBeNull()
  })

  it('does NOT render kebab menu', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    expect(screen.queryByLabelText(/more|更多/i)).toBeNull()
  })

  it('renders switch with correct checked state', () => {
    render(<FixedAgentCard agent={coder} enabled onToggle={() => {}} />)
    const switchEl = screen.getByRole('switch')
    expect(switchEl).toBeChecked()
  })

  it('renders unchecked switch when disabled', () => {
    render(<FixedAgentCard agent={coder} enabled={false} onToggle={() => {}} />)
    const switchEl = screen.getByRole('switch')
    expect(switchEl).not.toBeChecked()
  })

  it('calls onToggle when switch is clicked', async () => {
    const onToggle = vi.fn()
    render(<FixedAgentCard agent={coder} enabled onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/components/account/FixedAgentCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/components/account/FixedAgentCard.tsx`:

```typescript
import { useTranslation } from 'react-i18next'
import { Lock, Cpu } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'

interface FixedAgentCardProps {
  agent: AgentConfig
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

export function FixedAgentCard({ agent, enabled, onToggle }: FixedAgentCardProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface-subtle px-4 py-3.5">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
        <Avatar name={agent.name} shape="square" size={38} />
      </span>

      <div className={cn('flex min-w-0 flex-1 items-center gap-3.5 transition-opacity', !enabled && 'opacity-60')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium text-ink">{agent.name}</span>
            <Badge className="bg-accent-subtle text-accent-strong">
              {t('settings.agents.builtin')}
            </Badge>
            <Badge>
              <Cpu size={11} />
              {t('settings.agents.badgeGlobalModel')}
            </Badge>
          </div>
          {agent.description && (
            <div className="mt-1 truncate text-caption text-ink-tertiary">
              {agent.description}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('settings.agents.enableThis')}
        />
        <Lock size={15} className="shrink-0 text-ink-tertiary" />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/components/account/FixedAgentCard.test.tsx`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/FixedAgentCard.tsx src/components/account/FixedAgentCard.test.tsx
git commit -m "feat: add FixedAgentCard component for non-editable agents

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Wire FixedAgentCard into AgentManagement

**Files:**
- Modify: `src/components/account/AgentManagement.tsx`

**Interfaces:**
- Consumes: `FIXED_AGENTS` from `@/lib/fixedAgents`, `FixedAgentCard` from `./FixedAgentCard`, `useAgentsStore`
- Produces: Fixed agent section rendered above user agents in AgentManagement

- [ ] **Step 1: Update AgentManagement to render fixed agents**

Open `src/components/account/AgentManagement.tsx`. The current component renders `AgentToolbar` + `Content` (which renders stats + `AgentGrid`). We need to:

1. Import `FIXED_AGENTS` and `FixedAgentCard`
2. Read/write `fixedAgents` from `hipConfigStore`
3. Render `FixedAgentCard` × 3 above the existing `Content`
4. Include fixed agents in stats counts

Replace the file content:

```typescript
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { FIXED_AGENTS } from '@/lib/fixedAgents'
import { AgentToolbar } from './AgentToolbar'
import { AgentGrid } from './AgentGrid'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'
import { FixedAgentCard } from './FixedAgentCard'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const fixedAgentsEnabled = useHipConfigStore((s) => s.config.fixedAgents)
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const filteredAgents = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return agents
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(s) ||
        (a.description ?? '').toLowerCase().includes(s) ||
        a.command.toLowerCase().includes(s),
    )
  }, [agents, search])

  const fixedEnabledCount = FIXED_AGENTS.filter(
    (a) => fixedAgentsEnabled?.[a.id] !== false,
  ).length
  const userEnabledCount = useMemo(
    () => agents.filter((a) => a.enabled).length,
    [agents],
  )
  const totalAgents = FIXED_AGENTS.length + agents.length
  const enabledCount = fixedEnabledCount + userEnabledCount

  const handleFixedToggle = async (id: string, enabled: boolean) => {
    const next = { ...(fixedAgentsEnabled ?? {}), [id]: enabled }
    await updateSection('fixedAgents', next)
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between shrink-0">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>
        </div>
        <AgentToolbar
          search={search}
          onSearchChange={setSearch}
          onAdd={(kind) => setEditing({ mode: 'add', kind })}
        />
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5">
          {/* Stats — includes fixed agents */}
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('settings.agents.overviewTotal')} value={totalAgents} />
            <Stat label={t('settings.agents.overviewEnabled')} value={enabledCount} />
          </div>

          {/* Fixed agents section */}
          <div className="space-y-3">
            {FIXED_AGENTS.map((agent) => (
              <FixedAgentCard
                key={agent.id}
                agent={agent}
                enabled={fixedAgentsEnabled?.[agent.id] !== false}
                onToggle={(enabled) => handleFixedToggle(agent.id, enabled)}
              />
            ))}
          </div>

          {/* User agents section */}
          <AgentGrid
            agents={filteredAgents}
            emptyTitle={
              filteredAgents.length === 0
                ? search.trim().length > 0
                  ? t('settings.agents.searchEmpty')
                  : t('settings.agents.gridEmptyTitle')
                : ''
            }
            emptyHint={
              filteredAgents.length === 0 && !search.trim()
                ? t('settings.agents.gridEmptyHint')
                : undefined
            }
            onEdit={(a) => setEditing({ mode: 'edit', agent: a })}
            onToggle={(a, enabled) => void updateAgent(a.id, { enabled })}
            onDelete={(a) => setDeleting(a)}
          />
        </div>
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
          initialKind={editing.mode === 'add' ? editing.kind : undefined}
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
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-caption text-ink-tertiary">{label}</div>
      <div className="mt-1 text-stat font-semibold text-ink">{value}</div>
    </div>
  )
}
```

Note: The `Content` sub-component from the original is inlined — its logic (empty state handling) moves into `AgentGrid` props directly.

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: No errors in `AgentManagement.tsx`.

- [ ] **Step 3: Run existing tests**

Run: `yarn vitest run src/components/account/`
Expected: All existing tests pass. FixedAgentCard test passes. Any AgentManagement tests may need updates — check output.

- [ ] **Step 4: Fix any broken AgentManagement tests**

If existing `AgentManagement` tests reference the old `Content` sub-component or old stats counts, update them. Show the specific test failure and the fix.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/AgentManagement.tsx
git commit -m "feat: render fixed agents (coder/explore/plan) in AgentManagement

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Remove BuiltinCard dead code and add i18n strings

**Files:**
- Modify: `src/components/account/AgentCard.tsx:18-36` (remove BuiltinCard)
- Modify: `src/components/account/AgentCard.tsx:1-10` (remove unused Lock, Bot imports if only used by BuiltinCard)
- Modify: `src/i18n/en.ts:418-475` (remove builtin keys, add fixed agent keys)
- Modify: `src/i18n/zh-CN.ts:418-475` (same)
- Modify: `src/i18n/zh-TW.ts:418-475` (same)

**Interfaces:**
- Consumes: i18n `settings.agents.*` namespace
- Produces: Clean AgentCard without dead code; updated i18n with fixed agent descriptions

- [ ] **Step 1: Remove BuiltinCard from AgentCard.tsx**

Remove the `BuiltinCard` function (lines 18-36) and unused imports. Check which imports are only used by BuiltinCard:

```typescript
// BEFORE (lines 1-3):
import { Bot, Lock, Cpu, Terminal, Pencil, Trash2, MoreVertical } from 'lucide-react'

// AFTER — remove Bot and Lock (only used by BuiltinCard):
import { Cpu, Terminal, Pencil, Trash2, MoreVertical } from 'lucide-react'
```

Delete the `BuiltinCard` function (lines 18-36 entirely).

- [ ] **Step 2: Remove builtin i18n keys, add fixed agent keys — en.ts**

In `src/i18n/en.ts`, remove:
```typescript
        builtinName: 'hip (built-in)',
        builtinDesc: 'The default agent. Cannot be edited.',
```

And the `builtin: 'Built-in',` key stays (still used by FixedAgentCard badge).

Add after `badgeGlobalModel`:
```typescript
        fixedCoderDesc: 'Default sub-agent. Reads, writes files, executes commands, searches code, and implements changes.',
        fixedExploreDesc: 'Codebase exploration only. Read-only — search, read, and summarize without modifying files.',
        fixedPlanDesc: 'Planning and architecture design. No shell commands — focused on designing the approach, not implementing it.',
```

- [ ] **Step 3: Add fixed agent keys — zh-CN.ts**

In `src/i18n/zh-CN.ts`, remove:
```typescript
        builtinName: 'hip（内置）',
        builtinDesc: '默认智能体，不可编辑。',
```

Add after `badgeGlobalModel`:
```typescript
        fixedCoderDesc: '默认子 Agent，通用软件工程助手，可读写文件、执行命令、搜索代码并落地具体改动。',
        fixedExploreDesc: '代码库探索专用，只读操作，不修改文件。适合快速搜索、阅读和总结仓库。',
        fixedPlanDesc: '实现规划与架构设计专用，不提供 Shell 命令，专注于"想清楚怎么做"。',
```

- [ ] **Step 4: Add fixed agent keys — zh-TW.ts**

In `src/i18n/zh-TW.ts`, remove:
```typescript
        builtinName: 'hip（內建）',
        builtinDesc: '預設智能體，不可編輯。',
```

Add after `badgeGlobalModel`:
```typescript
        fixedCoderDesc: '預設子 Agent，通用軟體工程助手，可讀寫檔案、執行命令、搜尋程式碼並落實具體改動。',
        fixedExploreDesc: '程式碼庫探索專用，唯讀操作，不修改檔案。適合快速搜尋、閱讀和摘要倉庫。',
        fixedPlanDesc: '實作規劃與架構設計專用，不提供 Shell 命令，專注於「想清楚怎麼做」。',
```

- [ ] **Step 5: Verify type-check and tests**

Run: `yarn tsc --noEmit`
Expected: No errors.

Run: `yarn vitest run src/components/account/AgentCard`
Expected: All existing tests pass (no BuiltinCard tests existed since it was dead code).

- [ ] **Step 6: Commit**

```bash
git add src/components/account/AgentCard.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat: remove dead BuiltinCard, add i18n for fixed agents

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: End-to-end verification

**Files:**
- No changes — verification only

- [ ] **Step 1: Run full type-check**

```bash
yarn tsc --noEmit
```
Expected: No errors across the entire project.

- [ ] **Step 2: Run all frontend tests**

```bash
yarn test
```
Expected: All tests pass.

- [ ] **Step 3: Verify the feature in the app**

Launch the app and navigate to Settings → Agent Management. Verify:
- Three fixed agent cards (coder, explore, plan) appear at the top
- Each shows a lock icon, "内置" badge, and "全局模型" badge
- No edit or delete buttons are present
- Enable/disable toggle works and persists across app restart
- User-created agents appear below the fixed agents
- Stats (total agents, enabled) include fixed agents in counts

- [ ] **Step 4: Commit any verification fixes**

If verification reveals issues, fix and commit them.
