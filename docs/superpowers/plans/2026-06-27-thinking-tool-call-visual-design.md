# 思考过程与工具调用视觉优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 hip 聊天界面中引入 `ActivityBar`，将原本默认展开的推理与工具调用时间线折叠为单行摘要，点击后展开抽屉查看详情；同时改造 `ThinkingBubble` 使用同一套视觉语言。

**Architecture:** 新增 `ActivityBar` 组件负责单行摘要、展开状态和抽屉渲染；`TurnTimeline` 从 `MessageBubble` 中移入 `ActivityBar` 抽屉；`ToolCallRow` 保持默认折叠并统一状态图标；`ThinkingBubble` 复用 `ActivityBar`；所有状态继续使用现有协议类型，不改动 sidecar。

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, lucide-react, vitest (node environment + `react-dom/server`), i18next

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/components/chat/ActivityBar.tsx` | Create | 新增活动条组件：单行摘要、展开状态、抽屉内渲染 `TurnTimeline` |
| `src/components/chat/ActivityBar.test.tsx` | Create | 测试 ActivityBar 的折叠态、展开态、运行中状态、空状态隐藏 |
| `src/components/chat/ThinkingBubble.tsx` | Modify | 移除跳动点，复用 `ActivityBar` 展示当前 Agent 与步骤 |
| `src/components/chat/ThinkingBubble.test.tsx` | Create | 测试 ThinkingBubble 不再使用旧动画，且能透传活动数据 |
| `src/components/chat/TurnTimeline.tsx` | Modify | 减少默认间距，导出 `AgentBadge`，作为抽屉内容使用 |
| `src/components/artifact/ToolCallRow.tsx` | Modify | 默认折叠为单行摘要，升级成功/失败图标为圆形图标 |
| `src/components/artifact/ToolCallRow.test.tsx` | Create | 测试 ToolCallRow 的折叠态与图标 |
| `src/components/artifact/SubAgentCard.tsx` | Modify | 圆角与边框风格向 `ActivityBar` 靠拢 |
| `src/components/chat/MessageBubble.tsx` | Modify | 用 `ActivityBar` 替换直接渲染的 `TurnTimeline`，保留 `SubAgentCard`，并透传流数据给 `ThinkingBubble` |
| `src/i18n/zh-CN.ts` | Modify | 新增 ActivityBar 相关中文文案 |
| `src/i18n/zh-TW.ts` | Modify | 新增 ActivityBar 相关繁体中文文案 |
| `src/i18n/en.ts` | Modify | 新增 ActivityBar 相关英文文案 |

---

### Task 1: Create `ActivityBar` component

**Files:**
- Create: `src/components/chat/ActivityBar.tsx`
- Create: `src/components/chat/ActivityBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/chat/ActivityBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityBar } from './ActivityBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'chat.activity.completed') return `已完成 · ${params?.finished}/${params?.total} 个工具 · ${params?.agents} 个子 Agent`
    if (key === 'chat.activity.runningTool') return `正在 ${params?.name}`
    if (key === 'chat.activity.runningReasoning') return '正在思考'
    if (key === 'artifact.roles.planner') return '规划员'
    return key
  } }),
}))

vi.mock('./TurnTimeline', () => ({
  TurnTimeline: () => null,
  AgentBadge: ({ role }: { role: string }) => `<AgentBadge role="${role}" />`,
}))

const baseSteps = [
  { kind: 'reasoning' as const, stepSeq: 1, agentId: 'planner-1', role: 'planner' as const, content: '先分析需求' },
  { kind: 'tool' as const, stepSeq: 2, agentId: 'planner-1', role: 'planner' as const, callId: 'call-1' },
]

const baseTools = [
  { callId: 'call-1', agentId: 'planner-1', name: 'read_file', input: '{}', status: 'finished' as const, seq: 1 },
]

const baseRuns = [
  { agentId: 'planner-1', role: 'planner' as const, output: '', startedAt: 1, finishedAt: 2, seq: 1 },
]

describe('ActivityBar', () => {
  it('renders collapsed summary for completed activity', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} />,
    )
    expect(html).toContain('data-testid="activity-bar"')
    expect(html).toContain('已完成 · 1/1 个工具 · 0 个子 Agent')
    expect(html).toContain('aria-expanded="false"')
  })

  it('shows running state without expand chevron when streaming', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={[]} agentRuns={baseRuns} streaming />,
    )
    expect(html).toContain('正在 read_file')
    expect(html).not.toContain('aria-expanded')
  })

  it('hides when there is no activity', () => {
    const html = renderToStaticMarkup(<ActivityBar />)
    expect(html).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
yarn test src/components/chat/ActivityBar.test.tsx
```

Expected: FAIL — `ActivityBar` not found / file does not exist.

- [ ] **Step 3: Implement `ActivityBar`**

Create `src/components/chat/ActivityBar.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { AgentBadge, TurnTimeline } from './TurnTimeline'

interface ActivityBarProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  streaming?: boolean
}

export function ActivityBar({ steps = [], toolCalls = [], agentRuns = [], streaming }: ActivityBarProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hasActivity = steps.length > 0 || toolCalls.length > 0 || agentRuns.length > 0
  if (!hasActivity) return null

  const ordered = useMemo(() => [...steps].sort((a, b) => a.stepSeq - b.stepSeq), [steps])
  const lastStep = ordered[ordered.length - 1]
  const activeRole: AgentRole | null = lastStep?.role ?? agentRuns[agentRuns.length - 1]?.role ?? null

  const totalCount = toolCalls.length
  const finishedCount = toolCalls.filter((t) => t.status === 'finished').length
  const hasError = toolCalls.some((t) => t.status === 'error')
  const status: 'running' | 'finished' | 'error' = hasError ? 'error' : streaming ? 'running' : 'finished'

  const agentCount = useMemo(() => {
    const ids = new Set(agentRuns.filter((r) => r.role !== 'supervisor').map((r) => r.agentId))
    return ids.size
  }, [agentRuns])

  const byCallId = useMemo(() => new Map(toolCalls.map((tc) => [tc.callId, tc])), [toolCalls])

  const currentStepText = useMemo(() => {
    if (!lastStep) return null
    if (lastStep.kind === 'reasoning') return t('chat.activity.runningReasoning')
    const tool = byCallId.get(lastStep.callId)
    if (tool) return t('chat.activity.runningTool', { name: tool.name })
    return null
  }, [lastStep, byCallId, t])

  const summaryText = streaming
    ? (currentStepText ?? t('chat.activity.runningReasoning'))
    : t('chat.activity.completed', { finished: finishedCount, total: totalCount, agents: agentCount })

  const StatusIcon = {
    running: () => <Loader2 size={14} className="animate-spin text-accent-strong" />,
    finished: () => <CheckCircle2 size={14} className="text-success" />,
    error: () => <XCircle size={14} className="text-danger" />,
  }[status]

  const canExpand = !streaming

  return (
    <div className="mb-2" data-testid="activity-bar">
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-border bg-surface-muted/40 px-2.5 py-1.5 text-left transition-colors',
          canExpand && 'hover:border-accent/30 hover:bg-surface-muted/60',
          !canExpand && 'cursor-default',
        )}
      >
        {activeRole ? <AgentBadge role={activeRole} /> : <Circle size={10} className="text-ink-tertiary" />}
        {activeRole && (
          <span className="shrink-0 text-meta font-medium text-ink-secondary">{t(`artifact.roles.${activeRole}`)}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-meta text-ink-tertiary">{summaryText}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusIcon />
          {canExpand && (
            <ChevronRight size={14} className={cn('text-ink-tertiary transition-transform', open && 'rotate-90')} />
          )}
        </span>
      </button>
      {open && canExpand && (
        <div className="mt-1.5 rounded-lg border border-border bg-surface-muted/30 px-2 py-1.5">
          <TurnTimeline steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
yarn test src/components/chat/ActivityBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ActivityBar.tsx src/components/chat/ActivityBar.test.tsx
git commit -m "feat(chat): add ActivityBar component for compact activity summary"
```

---

### Task 2: Export `AgentBadge` from `TurnTimeline`

**Files:**
- Modify: `src/components/chat/TurnTimeline.tsx`

- [ ] **Step 1: Modify `TurnTimeline.tsx`**

Change the `AgentBadge` function definition to be exported:

```tsx
export function AgentBadge({ role }: { role: AgentRole }) {
  return (
    <span
      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: ROLE_COLOR[role] }}
      aria-hidden
    />
  )
}
```

- [ ] **Step 2: Run existing tests**

Run:
```bash
yarn test src/lib/timelineFilter.test.ts src/lib/turnAgents.test.ts
```

Expected: PASS (no logic change).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/TurnTimeline.tsx
git commit -m "refactor(chat): export AgentBadge from TurnTimeline"
```

---

### Task 3: Update `ThinkingBubble` to use `ActivityBar`

**Files:**
- Modify: `src/components/chat/ThinkingBubble.tsx`
- Create: `src/components/chat/ThinkingBubble.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/chat/ThinkingBubble.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThinkingBubble } from './ThinkingBubble'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'chat.activity.runningTool') return `正在 ${params?.name}`
    if (key === 'chat.activity.runningReasoning') return '正在思考'
    if (key === 'artifact.roles.planner') return '规划员'
    return key
  } }),
}))

vi.mock('./TurnTimeline', () => ({
  AgentBadge: ({ role }: { role: string }) => `<AgentBadge role="${role}" />`,
}))

describe('ThinkingBubble', () => {
  it('renders AI badge and hip label', () => {
    const html = renderToStaticMarkup(<ThinkingBubble />)
    expect(html).toContain('AI')
    expect(html).toContain('hip')
  })

  it('does not render old bouncing dots', () => {
    const html = renderToStaticMarkup(<ThinkingBubble />)
    expect(html).not.toContain('animate-dot-bounce')
    expect(html).not.toContain('chat.thinking')
  })

  it('forwards activity data to ActivityBar', () => {
    const steps = [{ kind: 'tool' as const, stepSeq: 1, agentId: 'p1', role: 'planner' as const, callId: 'c1' }]
    const tools = [{ callId: 'c1', agentId: 'p1', name: 'read_file', input: '{}', status: 'running' as const, seq: 1 }]
    const runs = [{ agentId: 'p1', role: 'planner' as const, output: '', startedAt: 1, finishedAt: null as number | null, seq: 1 }]
    const html = renderToStaticMarkup(<ThinkingBubble steps={steps} toolCalls={tools} agentRuns={runs} />)
    expect(html).toContain('正在 read_file')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
yarn test src/components/chat/ThinkingBubble.test.tsx
```

Expected: FAIL — `ThinkingBubble` does not accept props / still contains bouncing dots.

- [ ] **Step 3: Rewrite `ThinkingBubble`**

Modify `src/components/chat/ThinkingBubble.tsx` to:

```tsx
import type { AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { ActivityBar } from './ActivityBar'

interface ThinkingBubbleProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

export function ThinkingBubble({ steps, toolCalls, agentRuns }: ThinkingBubbleProps) {
  return (
    <div className="flex gap-3" data-testid="thinking-bubble">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-white">
        AI
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-meta font-medium text-ink-secondary">hip</div>
        <ActivityBar steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} streaming />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
yarn test src/components/chat/ThinkingBubble.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ThinkingBubble.tsx src/components/chat/ThinkingBubble.test.tsx
git commit -m "feat(chat): rewrite ThinkingBubble with ActivityBar"
```

---

### Task 4: Update `TurnTimeline` for compact drawer use

**Files:**
- Modify: `src/components/chat/TurnTimeline.tsx`

- [ ] **Step 1: Modify `TurnTimeline.tsx`**

Update the outer container to use tighter spacing:

```tsx
return (
  <div className="mb-0 flex flex-col gap-1" data-testid="turn-timeline">
    {plan && plan.todos.length > 0 && <TodoChecklist todos={plan.todos} />}
    {ordered.flatMap((step) => {
      // ... existing logic
    })}
  </div>
)
```

Also update `ThinkingDisclosure` pre styles to remove the top border-left in favor of a subtler left border or keep it. Main change is `mb-2` → `mb-0` and `gap-1.5` → `gap-1`.

- [ ] **Step 2: Run tests**

Run:
```bash
yarn test src/lib/timelineFilter.test.ts src/lib/turnAgents.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/TurnTimeline.tsx
git commit -m "style(chat): compact TurnTimeline spacing for drawer"
```

---

### Task 5: Update `ToolCallRow` status icons

**Files:**
- Modify: `src/components/artifact/ToolCallRow.tsx`
- Create: `src/components/artifact/ToolCallRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/artifact/ToolCallRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolCallRow } from './ToolCallRow'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const baseTool = {
  callId: 'c1',
  agentId: 'a1',
  name: 'read_file',
  input: '{"path":"src/main.ts"}',
  output: '{"content":"hello"}',
  status: 'finished' as const,
  seq: 1,
}

describe('ToolCallRow', () => {
  it('renders collapsed summary by default', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={baseTool} />)
    expect(html).toContain('data-testid="tool-row"')
    expect(html).toContain('read_file')
    expect(html).toContain('src/main.ts')
    expect(html).toContain('aria-expanded="false"')
  })

  it('uses CheckCircle2 for finished status', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={baseTool} />)
    expect(html).toContain('CheckCircle2')
  })

  it('uses XCircle for error status', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={{ ...baseTool, status: 'error', error: 'oops' }} />)
    expect(html).toContain('XCircle')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
yarn test src/components/artifact/ToolCallRow.test.tsx
```

Expected: FAIL — icons still `Check` / `X`.

- [ ] **Step 3: Modify `ToolCallRow`**

Edit `src/components/artifact/ToolCallRow.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'

// targetHint and Field stay unchanged ...

export function ToolCallRow({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hint = targetHint(tool.input)
  return (
    <div className="rounded-lg border border-border bg-surface-muted/40">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors" data-testid="tool-row">
        <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 font-mono text-meta text-ink">{tool.name}</span>
        {hint && <span className="truncate font-mono text-caption text-ink-tertiary">{hint}</span>}
        <span className="ml-auto shrink-0">
          {tool.status === 'running' && <Loader2 size={12} className="animate-spin text-accent-strong" />}
          {tool.status === 'finished' && <CheckCircle2 size={12} className="text-success" />}
          {tool.status === 'error' && <XCircle size={12} className="text-danger" />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          <Field label={tool.truncated ? `${t('artifact.arguments')} · ${t('artifact.truncated')}` : t('artifact.arguments')} value={tool.input} />
          {tool.status === 'error'
            ? <Field label={t('artifact.failed')} value={tool.error ?? ''} danger />
            : tool.output !== undefined && (
                <Field label={tool.truncated ? `${t('artifact.output')} · ${t('artifact.truncated')}` : t('artifact.output')} value={tool.output} />
              )}
        </div>
      )}
    </div>
  )
}
```

Key changes:
- Import `CheckCircle2`, `XCircle` instead of `Check`, `X`
- Container `rounded-md` → `rounded-lg`

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
yarn test src/components/artifact/ToolCallRow.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/ToolCallRow.tsx src/components/artifact/ToolCallRow.test.tsx
git commit -m "feat(artifact): unify ToolCallRow status icons and rounding"
```

---

### Task 6: Update `SubAgentCard` styling

**Files:**
- Modify: `src/components/artifact/SubAgentCard.tsx`

- [ ] **Step 1: Modify `SubAgentCard.tsx`**

Change the outer container class from `rounded-md` to `rounded-lg` and keep border:

```tsx
<div className="rounded-lg border border-border bg-surface-muted/30">
```

- [ ] **Step 2: Run tests**

Run:
```bash
yarn test src/components/artifact/SubAgentCard.logic.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/SubAgentCard.tsx
git commit -m "style(artifact): align SubAgentCard rounding with ActivityBar"
```

---

### Task 7: Update `MessageBubble` to integrate `ActivityBar`

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Modify `MessageBubble.tsx`**

Replace the direct `TurnTimeline` import and rendering with `ActivityBar`:

```tsx
import { ActivityBar } from './ActivityBar'
// Remove: import { TurnTimeline } from './TurnTimeline'
```

Inside the assistant content area:

```tsx
{message.role === 'assistant' && (
  <>
    <ActivityBar steps={flatSteps} toolCalls={message.toolCalls} agentRuns={message.agentRuns} streaming={streaming} />
    {nested.map((a) => <SubAgentCard key={a.agentId} agent={a} />)}
  </>
)}
```

Also update `ThinkingBubble` usage if the parent component renders it. Find the caller of `ThinkingBubble` (likely in `ChatPane.tsx` or similar) and pass `message.timeline`, `message.toolCalls`, `message.agentRuns` to it. For this plan, modify the call site in `ChatPane.tsx` if it exists.

- [ ] **Step 2: Run tests**

Run:
```bash
yarn test src/domain/sessionStore.test.ts
```

Expected: PASS (no logic change in store).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MessageBubble.tsx src/components/chat/ChatPane.tsx
git commit -m "feat(chat): integrate ActivityBar into MessageBubble"
```

---

### Task 8: Add i18n keys

**Files:**
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Add keys to `zh-CN.ts`**

Under `chat:` add:

```ts
activity: {
  completed: '已完成 · {{finished}}/{{total}} 个工具 · {{agents}} 个子 Agent',
  runningTool: '正在 {{name}}',
  runningReasoning: '正在思考',
},
```

- [ ] **Step 2: Add keys to `zh-TW.ts`**

```ts
activity: {
  completed: '已完成 · {{finished}}/{{total}} 個工具 · {{agents}} 個子 Agent',
  runningTool: '正在 {{name}}',
  runningReasoning: '正在思考',
},
```

- [ ] **Step 3: Add keys to `en.ts`**

```ts
activity: {
  completed: 'Completed · {{finished}}/{{total}} tools · {{agents}} sub-agents',
  runningTool: '{{name}} in progress',
  runningReasoning: 'Thinking',
},
```

- [ ] **Step 4: Run type-check**

Run:
```bash
yarn type-check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "feat(i18n): add ActivityBar activity summary keys"
```

---

### Task 9: Verify full test suite and type-check

**Files:** None (verification only)

- [ ] **Step 1: Run type-check**

Run:
```bash
yarn type-check
```

Expected: PASS with no TS errors.

- [ ] **Step 2: Run all frontend tests**

Run:
```bash
yarn test
```

Expected: PASS (or only pre-existing failures).

- [ ] **Step 3: Commit if any fixes were needed**

If type-check or tests required fixes, commit them:

```bash
git add -A
git commit -m "fix: address type-check and test issues from ActivityBar integration"
```

---

## Self-Review

**1. Spec coverage:**
- ActivityBar 单行摘要：Task 1
- 点击展开抽屉显示完整时间线：Task 1
- ThinkingBubble 复用 ActivityBar：Task 3
- ToolCallRow 默认折叠 + 统一图标：Task 5
- TurnTimeline 紧凑抽屉内容：Task 4
- SubAgentCard 视觉统一：Task 6
- MessageBubble 集成：Task 7
- i18n 文案：Task 8
- 不改协议 / 不新增 store：所有任务仅使用现有 props

**2. Placeholder scan:**
- No "TBD", "TODO", or vague steps. Each step includes concrete code or commands.

**3. Type consistency:**
- `ActivityBarProps` uses `TimelineStep[]`, `ToolCall[]`, `AgentRun[]` matching protocol types.
- `ThinkingBubble` props mirror `ActivityBarProps` minus `streaming`.
- i18n keys `chat.activity.*` used consistently across components and locale files.

**Open issue to confirm during execution:**
- The exact call site of `<ThinkingBubble />` must be located and updated to pass streaming data. Current search showed no direct usage in `MessageBubble.tsx`; it is likely rendered in `ChatPane.tsx` or a streaming wrapper.
