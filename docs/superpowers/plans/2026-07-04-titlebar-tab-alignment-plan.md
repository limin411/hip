# TitleBar 标签页与红绿灯对齐实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将顶部标题栏中的会话标签页改为小圆角胶囊按钮，并让整个标签行与红绿灯、右侧控件在同一水平中心线上对齐。

**Architecture：** 保持现有组件结构（`TitleBar` → `SessionTabBar` → `SessionTab`），仅调整 CSS 类名与局部布局。标题栏高度、红绿灯占位宽度、右侧控件内容均不变。

**Tech Stack：** React, Tailwind CSS, TypeScript, Vitest, @testing-library/react, happy-dom

## Global Constraints
- 标题栏高度保持 `h-11`（44px）。
- 红绿灯占位宽度保持 `var(--titlebar-lights-inset, 90px)`。
- 不新增组件，不修改状态逻辑与交互。
- 保留 tab 内的 surface 图标、标题、hover 关闭按钮。
- 右侧 `ConnectionStatus` / `PanelToggle` 保持现有内容与交互，仅调垂直对齐。
- 实现后必须运行测试与 type-check（项目未配置 lint script）。

---

### Task 1: 将 `SessionTab` 改为胶囊按钮样式

**Files:**
- Modify: `src/components/tabs/SessionTab.tsx`
- Test: `src/components/tabs/SessionTab.test.tsx`

**Interfaces:**
- Consumes: props `{ session, active, onSelect, onClose }`（不变）
- Produces: 渲染后的 DOM class 变化（后续测试会校验）

- [ ] **Step 1: 更新组件 className**

将最外层 `div` 的 className 从底部标签样式改为胶囊按钮样式：

```tsx
<div
  className={cn(
    'group flex h-[28px] min-w-[140px] max-w-[200px] items-center gap-1 rounded-md px-2.5 text-body transition-colors',
    active
      ? 'bg-state-active text-ink'
      : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
  )}
>
```

变化点：
- `h-[33px] rounded-t-md border border-transparent border-b-0` → `h-[28px] rounded-md`
- 选中背景从 `bg-app border-border` → `bg-state-active`
- 非选中文字从 `text-ink-tertiary` → `text-ink-secondary`

- [ ] **Step 2: 提交**

```bash
git add src/components/tabs/SessionTab.tsx
git commit -m "style: turn session tab into centered capsule button"
```

---

### Task 2: 让 `SessionTabBar` 垂直居中并同步新建按钮

**Files:**
- Modify: `src/components/tabs/SessionTabBar.tsx`
- Test: `src/components/tabs/SessionTabBar.test.tsx`

**Interfaces:**
- Consumes: `SessionTab`, `DropdownMenu`, `Plus` icon（不变）
- Produces: 标签行 DOM class 变化

- [ ] **Step 1: 调整容器垂直对齐**

将容器 class 中的 `items-end` 改为 `items-center`：

```tsx
<div
  role="tablist"
  aria-label={t('tabs.tabList')}
  data-tauri-drag-region="false"
  className="flex h-full flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide"
>
```

- [ ] **Step 2: 调整新建按钮对齐**

去掉 `mb-[3px]`，让按钮和 tab 同高、垂直居中：

```tsx
<button
  type="button"
  title={t('tabs.newSession')}
  data-testid="new-session-button"
  data-tauri-drag-region="false"
  className="ml-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
>
  <Plus size={14} />
</button>
```

- [ ] **Step 3: 提交**

```bash
git add src/components/tabs/SessionTabBar.tsx
git commit -m "style: center session tab bar vertically and align new button"
```

---

### Task 3: 调整 `TitleBar` 右侧控件垂直对齐

**Files:**
- Modify: `src/components/layout/TitleBar.tsx`
- Test: `src/components/layout/TitleBar.test.tsx`

**Interfaces:**
- Consumes: `SessionTabBar`, `ConnectionStatus`, `PanelToggle`（不变）
- Produces: 右侧控件容器 class 变化

- [ ] **Step 1: 确保右侧容器垂直居中**

右侧容器已有 `flex items-center gap-2 pr-3`，保持不变；若后续视觉仍偏，可微调 `gap` 或 padding。

```tsx
<div className="flex shrink-0 items-center gap-2 pr-3" data-tauri-drag-region="false">
  <ConnectionStatus />
  <PanelToggle />
</div>
```

- [ ] **Step 2: 提交**

```bash
git add src/components/layout/TitleBar.tsx
git commit -m "style: keep titlebar right controls centered with tabs"
```

---

### Task 4: 更新测试断言并通过验证

**Files:**
- Modify: `src/components/tabs/SessionTab.test.tsx`
- Modify: `src/components/tabs/SessionTabBar.test.tsx`

**Interfaces:**
- Consumes: 修改后的 `SessionTab` / `SessionTabBar` DOM class

- [ ] **Step 1: 检查并更新 `SessionTab.test.tsx`**

如果测试直接断言 `bg-app`、`border-border`、`rounded-t-md` 等旧 class，替换为新 class：

```tsx
expect(tab).toHaveClass('rounded-md')
expect(tab).toHaveClass('bg-state-active')
```

打开 `src/components/tabs/SessionTab.test.tsx`，搜索 `bg-app`、`border-border`、`rounded-t-md`、`text-ink-tertiary`，按需替换。

- [ ] **Step 2: 检查并更新 `SessionTabBar.test.tsx`**

如果测试断言 `items-end`，改为 `items-center`。

- [ ] **Step 3: 运行相关测试**

```bash
npm run test -- src/components/tabs/SessionTab.test.tsx src/components/tabs/SessionTabBar.test.tsx src/components/layout/TitleBar.test.tsx
```

Expected: all tests PASS

- [ ] **Step 4: 运行 type-check**

```bash
npm run type-check
```

Expected: no errors

- [ ] **Step 5: lint**

项目未配置 lint script，此步骤跳过。

- [ ] **Step 6: 提交**

```bash
git add src/components/tabs/SessionTab.test.tsx src/components/tabs/SessionTabBar.test.tsx
git commit -m "test: update tab class assertions for capsule redesign"
```

---

## Self-Review

**1. Spec coverage:**
- 胶囊 tab、小圆角 → Task 1
- 标签行垂直居中 → Task 2
- 新建按钮对齐 → Task 2
- 右侧控件对齐 → Task 3
- 测试/typecheck/lint → Task 4
- 无遗漏

**2. Placeholder scan:**
- 无 TBD/TODO
- 每个步骤含具体代码/命令
- 无“适当处理”等模糊描述

**3. Type consistency:**
- 未引入新类型或接口
- 所有组件 props 保持不变
