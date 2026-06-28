# 移除智能体配置页面左侧筛选列表 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除「智能体配置」页面左侧的筛选 rail，并清理相关 dead code 与 i18n 文案。

**Architecture:** 移除 `AgentManagement.tsx` 中的 filter state 与 `AgentFilterList` 渲染，将 `Content` 简化为固定展示「全部」视图；删除不再被引用的组件/工具文件；从三份 i18n 文件中移除不再使用的 key。

**Tech Stack:** React, TypeScript, Tailwind CSS, i18next, Vitest

## Global Constraints

- 不新增功能，只做删除与清理
- 保留搜索栏、添加按钮、智能体卡片、编辑弹窗等现有功能
- 删除文件前确认无其他引用
- 所有改动需通过 TypeScript 编译和现有测试

---

## Task 1: 简化 AgentManagement.tsx

**Files:**
- Modify: `src/components/account/AgentManagement.tsx`

**Interfaces:**
- Consumes: `AgentConfig[]` from `useAgentsStore`, `AgentToolbar`, `AgentGrid`, `AgentEditor`, `DeleteAgentDialog`
- Produces: 渲染固定「全部」视图的 `AgentManagement` 组件

- [ ] **Step 1: 移除筛选相关 import 与 state**

  删除以下 import：
  - `agentCategory`
  - `agentFilterCounts`
  - `AgentFilter`
  - `AgentFilterList`
  - `AgentListView`

  删除 state：
  - `const [filter, setFilter] = useState<AgentFilter>('all')`

- [ ] **Step 2: 删除 counts 计算与 AgentFilterList 渲染**

  删除：
  - `const counts = useMemo(() => agentFilterCounts(agents), [agents])`
  - `<AgentFilterList active={filter} counts={counts} onSelect={setFilter} />`

- [ ] **Step 3: 简化 Content 组件**

  将 `Content` 的 props 从 `{ filter, search, filteredAgents, enabledCount, counts, onEdit, onToggle, onDelete }` 简化为 `{ search, filteredAgents, enabledCount, onEdit, onToggle, onDelete }`。

  删除 `filter === 'internal'` / `filter === 'acp'` 分支及其对 `AgentListView` 的渲染，只保留「全部」视图：

  ```tsx
  function Content({
    search,
    filteredAgents,
    enabledCount,
    onEdit,
    onToggle,
    onDelete,
  }: {
    search: string
    filteredAgents: AgentConfig[]
    enabledCount: number
    onEdit: (agent: AgentConfig) => void
    onToggle: (agent: AgentConfig, enabled: boolean) => void
    onDelete: (agent: AgentConfig) => void
  }) {
    const { t } = useTranslation()

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={t('settings.agents.overviewTotal')} value={filteredAgents.length} />
          <Stat label={t('settings.agents.overviewEnabled')} value={enabledCount} />
        </div>
        <AgentGrid
          agents={filteredAgents}
          emptyTitle={search ? t('settings.agents.searchEmpty') : t('settings.agents.gridEmptyTitle')}
          emptyHint={search ? undefined : t('settings.agents.gridEmptyHint')}
          onEdit={onEdit}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      </div>
    )
  }
  ```

  同时更新 `AgentManagement` 中调用 `Content` 的地方，移除 `filter` 和 `counts` prop。

- [ ] **Step 4: 编译检查**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/account/AgentManagement.tsx
  git commit -m "refactor(agents): remove left filter rail and simplify overview"
  ```

---

## Task 2: 删除不再使用的文件

**Files:**
- Delete: `src/components/account/AgentFilterList.tsx`
- Delete: `src/components/account/AgentListPane.tsx`
- Delete: `src/lib/agentFilters.ts`
- Delete: `src/lib/agentFilters.test.ts`

**Interfaces:**
- Consumes: 确认以上文件无任何引用
- Produces: 代码库中不再包含这些文件

- [ ] **Step 1: 确认无其他引用**

  Run:
  ```bash
  grep -R "AgentFilterList\|AgentListPane\|agentFilterCounts\|from '@/lib/agentFilters'\|from \"../lib/agentFilters\"" src/ --include="*.ts" --include="*.tsx"
  ```
  Expected: no matches

- [ ] **Step 2: 删除文件**

  ```bash
  git rm src/components/account/AgentFilterList.tsx
  git rm src/components/account/AgentListPane.tsx
  git rm src/lib/agentFilters.ts
  git rm src/lib/agentFilters.test.ts
  ```

- [ ] **Step 3: 编译检查**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  git commit -m "chore(agents): delete unused filter components and utilities"
  ```

---

## Task 3: 清理 i18n 文案

**Files:**
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: 已删除文件/分支中使用的 key 列表
- Produces: 不再包含无用 key 的 i18n 资源对象

- [ ] **Step 1: 在 `settings.agents` 中删除以下 key**

  三份文件均需删除：
  - `catInternal`
  - `sectionAcp`
  - `sectionInternal`
  - `catAcpEmpty`
  - `catInternalEmpty`
  - `filterAll`
  - `filterBuiltin`
  - `filterInternal`
  - `filterCli`
  - `filterAcp`
  - `builtinOnlyNote`

  保留以下仍被使用的 key：
  - `catAcp`（`AgentCard.tsx`）
  - `addAcp`（`AgentEditor.tsx`、`AgentToolbar.tsx`）
  - `addInternal`（`AgentEditor.tsx`、`AgentToolbar.tsx`）

- [ ] **Step 2: 检查是否还有引用**

  Run:
  ```bash
  grep -R "settings\.agents\.(catInternal|sectionAcp|sectionInternal|catAcpEmpty|catInternalEmpty|filterAll|filterBuiltin|filterInternal|filterCli|filterAcp|builtinOnlyNote)" src/ --include="*.ts" --include="*.tsx"
  ```
  Expected: no matches

- [ ] **Step 3: 编译检查**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
  git commit -m "chore(i18n): remove unused agent filter copy"
  ```

---

## Task 4: 验证

**Files:**
- 整个项目

- [ ] **Step 1: 运行 TypeScript 编译**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 2: 运行单元测试**

  Run: `npm test -- --run`
  Expected: all tests pass

- [ ] **Step 3: 手动验证（可选，如有开发服务器）**

  Run: `npm run dev`
  打开「智能体配置」页面，确认：
  - 左侧无筛选 rail
  - 顶部搜索栏和「添加智能体」按钮正常
  - 下方展示全部智能体卡片网格

- [ ] **Step 4: Commit（如仅验证无新增改动则无需提交）**

---

## Self-Review

- [x] Spec coverage: 每条改动清单都在 Task 1-3 中对应
- [x] Placeholder scan: 无 TBD/TODO/"implement later"
- [x] Type consistency: 删除 `filter`/`counts` 后 Content props 与调用处一致
