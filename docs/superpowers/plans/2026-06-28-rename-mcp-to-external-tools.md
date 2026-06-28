# MCP 服务器改名为外部工具服务并改为网格卡片 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将「MCP 服务器」改名为「外部工具服务」，并把服务器列表从横向卡片列表改为响应式网格卡片布局。

**Architecture:** 仅修改 i18n 文案值（不改 key）和 `McpConfig.tsx` 的渲染布局。`McpServerCard` 与 `PluginMcpServerCard` 改为类似 `AgentCard` grid view 的垂直卡片，列表容器改为 `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3`。

**Tech Stack:** React, TypeScript, Tailwind CSS, i18next, Vitest

## Global Constraints

- 不修改内部变量名、类型名、store 字段、协议字段、i18n key
- 保持所有现有功能（启用/禁用、编辑、删除、重连、工具管理）
- 所有改动需通过 TypeScript 编译和现有测试

---

## Task 1: 替换 i18n 文案

**Files:**
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Consumes: 现有 `settings.mcp.*`、`settings.agents.*`、`settings.plugins.*` key
- Produces: 新的用户可见文案值

- [ ] **Step 1: 修改 `src/i18n/zh-CN.ts`**

  替换以下值：

  ```ts
  mcpLabel: '外部工具服务',
  ```

  ```ts
  mcp: {
    title: '外部工具服务',
    intro: '接入外部工具服务，其工具会合并进 hip 主智能体（以及你授权的内部智能体）。外部（ACP/CLI）智能体不使用它们。',
    // ... 其他 key 不变 ...
    empty: '还没有外部工具服务。添加一个以扩展 hip 的外部工具。',
    editTitle: '编辑外部工具服务',
    addTitle: '添加外部工具服务',
    namePlaceholder: '我的外部工具服务',
    deleteConfirmBody: '这会移除该外部工具服务配置。之后可以重新添加。',
    pluginSectionTitle: '插件外部工具服务',
  }
  ```

  同时修改 `settings.agents` 与 `settings.plugins` 中的相关文案：

  ```ts
  toolMcpServers: '外部工具服务',
  toolMcpServersEmpty: '尚未配置任何外部工具服务',
  ```

  ```ts
  componentCounts: '{{skills}} 个技能 · {{mcpServers}} 个外部工具服务 · {{agents}} 个智能体 · {{hooks}} 个钩子',
  ```

- [ ] **Step 2: 修改 `src/i18n/en.ts`**

  ```ts
  mcpLabel: 'External Tool Services',
  ```

  ```ts
  mcp: {
    title: 'External Tool Services',
    intro: 'Connect external tool services. Their tools are merged into the hip agent (and internal agents you allow). External (ACP/CLI) agents do not use them.',
    empty: 'No external tool services yet. Add one to extend hip with external tools.',
    editTitle: 'Edit external tool service',
    addTitle: 'Add external tool service',
    namePlaceholder: 'My external tool service',
    deleteConfirmBody: 'This removes the external tool service configuration. It can be added again later.',
    pluginSectionTitle: 'Plugin external tool services',
  }
  ```

  ```ts
  toolMcpServers: 'External tool services',
  toolMcpServersEmpty: 'No external tool services configured yet',
  componentCounts: '{{skills}} skills · {{mcpServers}} external tool services · {{agents}} agents · {{hooks}} hooks',
  ```

- [ ] **Step 3: 修改 `src/i18n/zh-TW.ts`**

  ```ts
  mcpLabel: '外部工具服務',
  ```

  ```ts
  mcp: {
    title: '外部工具服務',
    intro: '接入外部工具服務，其工具會合併進 hip 主智能體（以及你授權的內部智能體）。外部（ACP/CLI）智能體不使用它們。',
    empty: '還沒有外部工具服務。新增一個以擴充 hip 的外部工具。',
    editTitle: '編輯外部工具服務',
    addTitle: '新增外部工具服務',
    namePlaceholder: '我的外部工具服務',
    deleteConfirmBody: '這會移除該外部工具服務設定。之後可以重新新增。',
    pluginSectionTitle: '外掛外部工具服務',
  }
  ```

  ```ts
  toolMcpServers: '外部工具服務',
  toolMcpServersEmpty: '尚未設定任何外部工具服務',
  componentCounts: '{{skills}} 個技能 · {{mcpServers}} 個外部工具服務 · {{agents}} 個智能體 · {{hooks}} 個鉤子',
  ```

- [ ] **Step 4: 编译检查**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 5: Commit**

  ```bash
  git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
  git commit -m "chore(i18n): rename MCP servers to external tool services"
  ```

---

## Task 2: 重构 McpServerCard 为网格卡片

**Files:**
- Modify: `src/components/account/McpConfig.tsx`

**Interfaces:**
- Consumes: `McpServerConfig`, `McpServerStatusVM`, existing callbacks
- Produces: 垂直网格布局的 `McpServerCard`

- [ ] **Step 1: 修改 `McpServerCard` JSX 为垂直卡片**

  将 `McpServerCard` 内部布局从横向 flex 改为垂直 flex，参考 `AgentCard` grid view：

  ```tsx
  <div
    className={cn(
      'relative flex min-h-[180px] flex-col rounded-lg border border-border bg-surface p-4 transition-shadow hover:shadow-card-hover',
      !server.enabled && 'opacity-60',
    )}
  >
    {/* Header */}
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
        <Plug size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{server.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge>{transportLabel}</Badge>
          {status && (
            <span className="inline-flex items-center gap-1 text-caption text-ink-secondary" title={statusTitle}>
              <StatusDot status={status.status} />
              {statusLabel}
            </span>
          )}
        </div>
      </div>
    </div>

    {/* Body */}
    <div className="mt-3 flex-1">
      <div className="truncate font-mono text-caption text-ink-tertiary">{detail}</div>
      {status && (
        <div className="mt-2 flex items-center gap-3 text-caption text-ink-tertiary">
          <span>
            {toolCount} {toolCount === 1 ? t('settings.mcp.toolSingular') : t('settings.mcp.toolPlural')}
          </span>
          {hasTools && (
            <button
              onClick={() => setToolsOpen((o) => !o)}
              className="inline-flex items-center gap-0.5 text-accent-strong transition-colors hover:text-accent"
            >
              {t('settings.mcp.manageTools')}
              <ChevronDown size={14} className={cn('transition-transform', toolsOpen && 'rotate-180')} />
            </button>
          )}
        </div>
      )}
      {toolsOpen && hasTools && (
        <div className="mt-3 rounded-lg border border-border bg-surface-subtle p-3">
          {/* existing tools panel, unchanged */}
        </div>
      )}
    </div>

    {/* Footer */}
    <div className="mt-4 flex items-center justify-between">
      <Switch checked={server.enabled} onCheckedChange={onToggle} ariaLabel={t('settings.mcp.enableThis')} />
      <div className="flex items-center gap-1">
        {status?.status === 'disconnected' && server.enabled && (
          <ActionButton icon={<RefreshCw size={14} />} label={t('settings.mcp.reconnect')} onClick={onReconnect} />
        )}
        <ActionButton icon={<Pencil size={14} />} label={t('settings.mcp.edit')} onClick={onEdit} />
        <ActionButton icon={<Trash2 size={14} />} label={t('settings.mcp.delete')} onClick={onDelete} danger />
      </div>
    </div>
  </div>
  ```

  其中 `ActionButton` 可参考 `AgentCard.tsx` 中的实现：

  ```tsx
  function ActionButton({
    icon,
    label,
    onClick,
    danger,
  }: {
    icon: React.ReactNode
    label: string
    onClick: () => void
    danger?: boolean
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          danger
            ? 'text-ink-secondary hover:bg-danger/10 hover:text-danger'
            : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
        )}
        aria-label={label}
      >
        {icon}
      </button>
    )
  }
  ```

- [ ] **Step 2: 重构 PluginMcpServerCard 为网格卡片**

  同样改为垂直卡片，保留插件来源 Badge，无操作按钮：

  ```tsx
  <div
    className={cn(
      'relative flex min-h-[140px] flex-col rounded-lg border border-border bg-surface p-4',
      !server.enabled && 'opacity-60',
    )}
  >
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
        <Plug size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{server.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge>{transportLabel}</Badge>
          <Badge className="bg-accent-subtle text-accent-strong">{t('settings.mcp.via', { name: pluginName })}</Badge>
          {status && (
            <span className="inline-flex items-center gap-1 text-caption text-ink-secondary" title={statusTitle}>
              <StatusDot status={status.status} />
              {statusLabel}
            </span>
          )}
        </div>
      </div>
    </div>
    <div className="mt-3 flex-1">
      <div className="truncate font-mono text-caption text-ink-tertiary">{detail}</div>
      {toolCount !== undefined && (
        <div className="mt-2 text-caption text-ink-tertiary">
          {toolCount} {toolCount === 1 ? t('settings.mcp.toolSingular') : t('settings.mcp.toolPlural')}
        </div>
      )}
    </div>
  </div>
  ```

- [ ] **Step 3: 编译检查**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/account/McpConfig.tsx
  git commit -m "refactor(mcp): convert server cards to grid layout"
  ```

---

## Task 3: 列表容器改为网格布局

**Files:**
- Modify: `src/components/account/McpConfig.tsx`

**Interfaces:**
- Consumes: `McpServerCard`, `PluginMcpServerCard`, server arrays
- Produces: 响应式网格列表容器

- [ ] **Step 1: 修改「我的服务器」列表容器**

  将：

  ```tsx
  <div className="mt-2 space-y-2">
  ```

  改为：

  ```tsx
  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
  ```

  空状态按钮保持原样，仅文案已随 i18n 更新。

- [ ] **Step 2: 修改「插件外部工具服务」列表容器**

  同样将对应 `space-y-2` 改为 `grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3`。

- [ ] **Step 3: 运行 McpConfig 测试**

  Run: `npx vitest run src/components/account/McpConfig.test.tsx`
  Expected: all tests pass

- [ ] **Step 4: 编译检查**

  Run: `npx tsc --noEmit`
  Expected: no errors

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/account/McpConfig.tsx
  git commit -m "refactor(mcp): use grid layout for server lists"
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

- [ ] **Step 3: 手动验证（可选）**

  Run: `npm run dev`
  打开「外部工具服务」页面，确认：
  - 标题、按钮、弹窗文案均显示「外部工具服务」
  - 服务器以网格卡片展示
  - 启用/禁用、编辑、删除、工具管理交互正常

---

## Self-Review

- [x] Spec coverage: 文案替换在 Task 1，卡片网格在 Task 2，容器布局在 Task 3
- [x] Placeholder scan: 无 TBD/TODO
- [x] Type consistency: McpServerCard 与 PluginMcpServerCard props 不变，仅内部布局与外层容器调整
