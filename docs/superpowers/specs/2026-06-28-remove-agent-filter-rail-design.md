# 移除智能体配置页面左侧筛选列表

## 背景

`智能体配置` 页面（`src/components/account/AgentManagement.tsx`）当前在左侧渲染一个 64px 宽的 icon rail（`AgentFilterList`），用于在「全部 / 内部 / ACP」等视图之间切换。产品要求删除该左侧筛选列表。

## 目标

- 完全移除左侧筛选 rail 及其相关 dead code
- 页面固定展示「全部智能体」概览（统计卡片 + AgentGrid）
- 清理因此不再被引用的文件和 i18n 文案

## 不在范围

- 智能体卡片、编辑弹窗、工具栏、搜索栏等其他功能保持不变
- 不新增功能

## 改动清单

### 1. 修改 `src/components/account/AgentManagement.tsx`

- 删除 `AgentFilterList` import
- 删除 `agentFilterCounts` 与 `AgentFilter` 相关 import
- 删除 `filter` state 与 `setFilter`
- 删除 `counts` 与 `agentFilterCounts` 调用
- 删除 JSX 中的 `<AgentFilterList />`
- 删除 `Content` 组件中 `filter === 'internal'` / `filter === 'acp'` 的分支
- `Content` 简化为只渲染「全部」视图：统计卡片（`agents.length`、`enabledCount`）+ `AgentGrid`
- 从 `Content` props 中移除 `filter` 和 `counts`

### 2. 删除不再使用的组件与工具文件

- `src/components/account/AgentFilterList.tsx`
- `src/components/account/AgentListPane.tsx`（当前已无任何引用）
- `src/lib/agentFilters.ts`
- `src/lib/agentFilters.test.ts`

### 3. 清理 i18n 文案

在 `src/i18n/zh-CN.ts`、`src/i18n/zh-TW.ts`、`src/i18n/en.ts` 中移除以下不再使用的 key：

- `settings.agents.catInternal`
- `settings.agents.sectionAcp`
- `settings.agents.sectionInternal`
- `settings.agents.catAcpEmpty`
- `settings.agents.catInternalEmpty`
- `settings.agents.filterAll`
- `settings.agents.filterBuiltin`
- `settings.agents.filterInternal`
- `settings.agents.filterCli`
- `settings.agents.filterAcp`
- `settings.agents.builtinOnlyNote`

保留以下仍被其他组件使用的 key：

- `settings.agents.catAcp`（`AgentCard.tsx` 使用）
- `settings.agents.addAcp`（`AgentEditor.tsx`、`AgentToolbar.tsx` 使用）
- `settings.agents.addInternal`（`AgentEditor.tsx`、`AgentToolbar.tsx` 使用）

## 预期结果

页面顶部保留搜索栏与「添加智能体」按钮，下方直接展示全部智能体卡片网格，左侧不再显示筛选 rail。

## 验证

- TypeScript 编译通过
- 相关单元测试通过（如 `AgentManagement` 或 `agentsStore` 测试）
- 手动确认页面无左侧 rail，且「全部」视图正常渲染
