# 标题栏与全局视觉刷新实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除标题栏边缘阴影，将全局视觉从"卡片投影分隔"统一为"hairline + 背景色 + 毛玻璃沉浸"风格。

**Architecture:** 通过调整 CSS token 提升标题栏毛玻璃不透明度并降低边框对比度；修改 `TitleBar` 去掉阴影和硬边；清理 Tailwind 阴影系统，仅保留浮层阴影；将按钮/卡片 hover 的阴影效果替换为背景色变化。改动集中在前端样式层，不引入新依赖或运行时逻辑。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, class-variance-authority, Vitest

## Global Constraints

- 不更换品牌色（sage gray 保持不变）。
- 不更换字体栈（保持系统字体）。
- 不改整体布局结构（侧栏、主内容、右面板的尺寸关系不变）。
- 不引入新的动画或动效（遵循 `prefers-reduced-motion`）。
- 菜单、弹窗、下拉面板等浮层继续保留 `shadow-menu` / `shadow-overlay`。
- 所有改动必须通过 `yarn test` 和 `yarn tsc`。

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `src/styles/tokens.css` | 调整 `--glass-bg` 和 `--glass-border` token |
| `src/components/layout/TitleBar.tsx` | 移除标题栏阴影和底部 border |
| `tailwind.config.js` | 清理冗余阴影定义，保留浮层阴影 |
| `src/components/ui/Button.tsx` | 移除 primary 按钮 hover 阴影 |
| `src/components/account/AgentCard.tsx` | 移除 grid 卡片 hover 阴影 |
| `src/components/account/McpConfig.tsx` | 移除 stat 卡片和 server 卡片 hover 阴影 |
| `src/components/chat/ChatPane.tsx` | 更新消息容器过渡属性，移除 box-shadow 过渡 |

---

### Task 1: 调整 glass token

**Files:**
- Modify: `src/styles/tokens.css`

**Interfaces:**
- Consumes: 无
- Produces: 更新后的 `--glass-bg`（0.72 → 0.85）、`--glass-border` 对比度降低

- [ ] **Step 1: 修改 light 模式 glass token**

  将 `:root` 中的：
  ```css
  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-border: rgba(0, 0, 0, 0.06);
  ```
  改为：
  ```css
  --glass-bg: rgba(255, 255, 255, 0.85);
  --glass-border: rgba(0, 0, 0, 0.05);
  ```

- [ ] **Step 2: 修改 dark 模式 glass token**

  将 `.dark` 中的：
  ```css
  --glass-bg: rgba(20, 20, 20, 0.72);
  --glass-border: rgba(255, 255, 255, 0.08);
  ```
  改为：
  ```css
  --glass-bg: rgba(20, 20, 20, 0.85);
  --glass-border: rgba(255, 255, 255, 0.06);
  ```

- [ ] **Step 3: 提交**

  ```bash
  git add src/styles/tokens.css
  git commit -m "style(tokens): increase titlebar glass opacity and soften border"
  ```

---

### Task 2: 移除 TitleBar 阴影与硬边

**Files:**
- Modify: `src/components/layout/TitleBar.tsx:33`
- Test: `src/components/layout/TitleBar.test.tsx`

**Interfaces:**
- Consumes: `--glass-bg`（来自 Task 1）
- Produces: 无阴影、无边框的 `TitleBar` className

- [ ] **Step 1: 更新 className**

  将第 33 行从：
  ```tsx
  className="relative flex h-11 shrink-0 items-center border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-sticky-top"
  ```
  改为：
  ```tsx
  className="relative flex h-11 shrink-0 items-center bg-[var(--glass-bg)] backdrop-blur-xl"
  ```

- [ ] **Step 2: 运行 TitleBar 测试**

  ```bash
  yarn test src/components/layout/TitleBar.test.tsx
  ```

  Expected: PASS

- [ ] **Step 3: 提交**

  ```bash
  git add src/components/layout/TitleBar.tsx
  git commit -m "style(titlebar): remove shadow and border for immersive glass"
  ```

---

### Task 3: 清理 Tailwind 阴影系统

**Files:**
- Modify: `tailwind.config.js`

**Interfaces:**
- Consumes: 无
- Produces: 精简后的 `boxShadow` 配置

- [ ] **Step 1: 精简 boxShadow**

  将 `theme.extend.boxShadow` 改为仅保留浮层阴影：
  ```js
  boxShadow: {
    none: 'none',
    sm: 'none',
    DEFAULT: 'none',
    md: 'none',
    lg: 'none',
    xl: 'none',
    '2xl': 'none',
    inner: 'none',
    pop: 'none',
    float: 'none',
    menu: '0 6px 20px -6px rgba(17, 17, 17, 0.14), 0 2px 6px -2px rgba(17, 17, 17, 0.08)',
    overlay: '0 16px 48px -12px rgba(17, 17, 17, 0.22), 0 6px 16px -8px rgba(17, 17, 17, 0.12)',
    'card-hover': 'none',
    'sticky-top': 'none',
  },
  ```

  同时更新上方注释，说明现在只有浮层使用阴影：
  ```js
  // 扁平化：界面主体不用阴影。唯一例外是真正的浮层（菜单、弹窗）用克制的柔和阴影。
  ```

- [ ] **Step 2: 提交**

  ```bash
  git add tailwind.config.js
  git commit -m "style(tailwind): flatten shadow system, keep only float layers"
  ```

---

### Task 4: 移除 Button primary hover 阴影

**Files:**
- Modify: `src/components/ui/Button.tsx:10`
- Test: `src/components/ui/Button.test.tsx`（如果存在，否则运行 `yarn test` 全量）

**Interfaces:**
- Consumes: 无
- Produces: 无 hover 阴影的 primary button variant

- [ ] **Step 1: 修改 primary variant**

  将第 10 行从：
  ```tsx
  primary: 'bg-accent text-white hover:bg-accent-hover hover:shadow-card-hover',
  ```
  改为：
  ```tsx
  primary: 'bg-accent text-white hover:bg-accent-hover',
  ```

- [ ] **Step 2: 运行 Button 相关测试**

  ```bash
  yarn test src/components/ui/Button.test.tsx
  ```

  如果文件不存在：
  ```bash
  yarn test
  ```

  Expected: PASS

- [ ] **Step 3: 提交**

  ```bash
  git add src/components/ui/Button.tsx
  git commit -m "style(button): remove primary hover shadow"
  ```

---

### Task 5: 移除 AgentCard grid hover 阴影

**Files:**
- Modify: `src/components/account/AgentCard.tsx:58`
- Test: `src/components/account/AgentCard.test.tsx`（如果存在，否则运行 `yarn test`）

**Interfaces:**
- Consumes: 无
- Produces: 无 hover 阴影的 grid AgentCard

- [ ] **Step 1: 修改 grid 卡片 className**

  将第 58 行从：
  ```tsx
  <div className="relative flex min-h-[160px] flex-col rounded-lg border border-border bg-surface p-4 transition-shadow hover:shadow-card-hover">
  ```
  改为：
  ```tsx
  <div className="relative flex min-h-[160px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle">
  ```

- [ ] **Step 2: 运行相关测试**

  ```bash
  yarn test src/components/account/AgentCard.test.tsx
  ```

  如果文件不存在：
  ```bash
  yarn test
  ```

  Expected: PASS

- [ ] **Step 3: 提交**

  ```bash
  git add src/components/account/AgentCard.tsx
  git commit -m "style(agent-card): replace grid hover shadow with subtle background shift"
  ```

---

### Task 6: 移除 McpConfig 卡片 hover 阴影

**Files:**
- Modify: `src/components/account/McpConfig.tsx:313,390`
- Test: `src/components/account/McpConfig.test.tsx`（如果存在，否则运行 `yarn test`）

**Interfaces:**
- Consumes: 无
- Produces: 无 hover 阴影的 MCP stat/server 卡片

- [ ] **Step 1: 修改 stat 卡片**

  将第 313 行从：
  ```tsx
  <div className="rounded-xl border border-border bg-surface p-4 transition-shadow hover:shadow-card-hover">
  ```
  改为：
  ```tsx
  <div className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle">
  ```

- [ ] **Step 2: 修改 server 卡片**

  将第 390 行从：
  ```tsx
  'relative flex min-h-[180px] flex-col rounded-lg border border-border bg-surface p-4 transition-shadow hover:shadow-card-hover',
  ```
  改为：
  ```tsx
  'relative flex min-h-[180px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle',
  ```

- [ ] **Step 3: 运行相关测试**

  ```bash
  yarn test src/components/account/McpConfig.test.tsx
  ```

  如果文件不存在：
  ```bash
  yarn test
  ```

  Expected: PASS

- [ ] **Step 4: 提交**

  ```bash
  git add src/components/account/McpConfig.tsx
  git commit -m "style(mcp-config): replace card hover shadows with background shift"
  ```

---

### Task 7: 清理 ChatPane 消息容器过渡属性

**Files:**
- Modify: `src/components/chat/ChatPane.tsx:119`
- Test: `src/components/chat/ChatPane.test.tsx`（如果存在，否则运行 `yarn test`）

**Interfaces:**
- Consumes: 无
- Produces: 保留 ring fade-out 所需 box-shadow 过渡的消息容器

- [ ] **Step 1: 修改过渡属性**

  第 119 行原本就是：
  ```tsx
  'transition-[background-color,box-shadow] duration-700',
  ```
  保持不变。

  > 说明：最初计划改为 `transition-colors` 以配合去阴影方向，但 `highlightedId === m.id && 'bg-accent-subtle ring-2 ring-accent/50'` 中的 `ring-*` 使用 `box-shadow` 实现。若移除 `box-shadow` 过渡，高亮 ring 的淡出效果会丢失（与上方注释矛盾）。因此保留 `transition-[background-color,box-shadow]`，只去掉其他非必要的 shadow 使用。

- [ ] **Step 2: 运行相关测试**

  ```bash
  yarn test src/components/chat/ChatPane.test.tsx
  ```

  如果文件不存在：
  ```bash
  yarn test
  ```

  Expected: PASS

- [ ] **Step 3: 提交**

  ```bash
  git add src/components/chat/ChatPane.tsx
  git commit -m "style(chat-pane): remove box-shadow transition from message wrapper"
  ```

---

### Task 8: 全量测试与类型检查

**Files:**
- 无新文件

**Interfaces:**
- Consumes: 前述所有改动
- Produces: 验证通过的测试和类型检查报告

- [ ] **Step 1: 运行全量测试**

  ```bash
  yarn test
  ```

  Expected: PASS

- [ ] **Step 2: 运行类型检查**

  ```bash
  yarn tsc
  ```

  Expected: 无错误

- [ ] **Step 3: 最终提交**

  ```bash
  git add .
  git commit -m "style: verify titlebar and global visual refresh"
  ```

---

## 可选增强（本计划不包含）

- 滚动时标题栏浮现 subtle hairline：需要监听主内容区 scroll 并动态切换 className，会引入运行时逻辑。如需实现，请单独开一个 plan。

## Self-Review

- **Spec coverage:**
  - 标题栏去阴影/边框 → Task 2
  - glass token 调整 → Task 1
  - Tailwind 阴影系统清理 → Task 3
  - 按钮/卡片 hover 阴影替换 → Task 4、5、6
  - 非浮层组件清理 → Task 7
  - 测试/类型检查 → Task 8
- **Placeholder scan:** 无 TBD/TODO/模糊描述。
- **Type consistency:** 所有改动均为 className 字符串调整，无类型签名变化。
