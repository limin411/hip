# 视觉设计与样式架构 · 实施清单

> **For agentic workers:** 按 Task 顺序推进；用 checkbox 跟踪。优先整 phase 可合并，禁止把 Phase 1–3 塞进同一 PR。  
> **Spec:** [`../specs/2026-07-11-visual-design-style-architecture-design.md`](../specs/2026-07-11-visual-design-style-architecture-design.md)

**Goal:** 在布局冻结前提下，收口 token / 原语 / 业务硬编码，完成克制的视觉与样式架构升级。

**Architecture:** CSS 变量（`tokens.css`）为唯一色与阴影真相源 → Tailwind 语义映射 → `components/ui` 原语 → 业务只消费语义类。分三 phase：令牌与对比 → 原语与 prose → 扫尾与门禁。

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, CVA, Vitest.

---

## Global Constraints

- **布局冻结**：不改 `AppLayout` Panel 结构、TitleBar 角色、主列/右栏信息架构；允许 ±2–4px 与 class 语义替换。
- **不换皮**：保持单色 chrome + Sage Gray；不引入第二主题、全局 elevation、新字体品牌。
- **不扩产品面**：无新功能、无 i18n 语义改动（除非 class 测试文案无关）。
- **分 phase commit**：Phase 1 / 2 / 3 可独立合并与回滚。
- **验收命令基线**（每 phase 结束）：

```bash
yarn tsc
# 若改动了相关组件，再跑对应测试，例如：
# yarn vitest run src/components/ui src/routes/AppLayout.test.tsx
```

---

## 进度总览

| Phase | 状态 | 一句话 |
|-------|------|--------|
| 1 令牌与对比 | ✅ 已完成 | on-accent / shadow-panel / glass / role.worker + Button/AppLayout/TitleBar |
| 2 原语与 prose | ⬜ 未开始 | buttonVariants 收敛、MarkdownBody、字号与 hover 约定 |
| 3 扫尾与门禁 | ⬜ 未开始 | 硬编码 rg、可选微间距、spec 标已实现 |

---

## File Structure（预期触碰）

| File | Phase | Responsibility |
|------|-------|----------------|
| `src/styles/tokens.css` | 1 | `--on-accent`、`--shadow-panel`、可选兼容别名 |
| `tailwind.config.js` | 1 | 映射 on-accent、panel、glass、role.worker |
| `src/components/ui/Button.tsx` | 1–2 | on-accent、字号 token、导出 `buttonVariants` |
| `src/routes/AppLayout.tsx` | 1 | `shadow-panel` |
| `src/components/layout/TitleBar.tsx` | 1 | `bg-glass` |
| `src/components/workflow/DagEditor.css` | 1 | 真变量或依赖 tokens 别名 |
| `src/lib/utils.ts` | 1? | 仅当 tailwind-merge 需登记新 class group |
| `src/components/chat/MarkdownBody.tsx` | 2 | **新建** prose 单一入口 |
| `src/components/chat/MessageBubble.tsx` | 2 | 改用 MarkdownBody |
| Skill 预览等含 markdown class 的文件 | 2 | 接入同一入口 |
| 手写 primary 按钮文件 | 2 | → `Button` / `buttonVariants` |
| `src/routes/LoginScreen.tsx`、`AuthButton.tsx` | 2 | `text-sm` → token |
| 本 plan / spec 状态 | 各 phase 末 | 勾选 + 状态更新 |

---

# Phase 1 — 令牌补全与对比修正

**Exit criteria（全部勾选后可标 Phase 1 完成）**

- [x] tokens 含 `--on-accent`、`--shadow-panel`（`:root` + `.dark`）
- [x] tailwind 可使用 `text-on-accent`（或等价）、`shadow-panel`、`bg-glass`、`text-role-worker` / `bg-role-worker`
- [x] `AppLayout` 无 `shadow-[0_2px_12px…]`
- [x] `TitleBar` 无 `bg-[var(--glass-bg)]`
- [x] `Button` primary/danger 使用 on-accent；size 不用 `text-sm`/`text-base`
- [x] DagEditor 变量可用（别名或改写）
- [x] 相关 vitest 绿（`AppLayout` / `TitleBar` / `utils`）；全量 `yarn tsc` 仍有仓库既有无关错误（SkillConfig i18n / CollaborationStructure）
- [x] 布局结构无变化（仅 class 语义替换）；亮/暗 primary 对比依赖 `--on-accent` 令牌（建议本地目视一次）

---

### Task 1.1: tokens — on-accent 与 shadow-panel

**Files:**
- Modify: `src/styles/tokens.css`

- [x] **Step 1–4:** `:root` / `.dark` 增加 `--on-accent`、`--shadow-panel`；兼容别名 `--surface` / `--surface-muted` / `--ink*`；顶部阴影三档注释

**Verify:** `grep -n 'on-accent\|shadow-panel\|--surface:' src/styles/tokens.css` ✅

---

### Task 1.2: tailwind 映射

**Files:**
- Modify: `tailwind.config.js`

- [x] **Step 1–2:** `on-accent`、`glass`/`glass.border`、`role.worker`、`boxShadow.panel`
- [x] **Step 3:** 无需 `utils.ts` merge 登记

**Verify:** `grep -n 'on-accent\|shadow-panel\|worker\|glass' tailwind.config.js` ✅

---

### Task 1.3: Button 对比与字号

**Files:**
- Modify: `src/components/ui/Button.tsx`

- [x] **Step 1:** primary/danger → `text-on-accent`
- [x] **Step 2:** 全部 size → `text-body`
- [x] **Step 3:** `export const buttonVariants`

---

### Task 1.4: AppLayout + TitleBar 消费令牌

**Files:**
- Modify: `src/routes/AppLayout.tsx`、`src/components/layout/TitleBar.tsx`

- [x] **Step 1:** 右栏 → `shadow-panel`
- [x] **Step 2:** TitleBar → `bg-glass`
- [x] **Step 3:** `yarn vitest run src/routes/AppLayout.test.tsx src/components/layout/TitleBar.test.tsx` → 14 tests passed

---

### Task 1.5: DagEditor 变量对齐（若 Task 1.1 已加别名可极小改动）

**Files:**
- Modify: `tokens.css` only（兼容别名）

- [x] 别名覆盖 DagEditor 使用的 `--surface` / `--surface-muted` / `--ink` / `--ink-secondary` / `--ink-tertiary`；未改 `DagEditor.css` 布局

---

### Task 1.6: Phase 1 收尾

- [x] 令牌接线验收（grep）通过；建议本地再目视亮/暗 primary
- [x] 相关 vitest 绿；全量 tsc 既有无关错误未引入
- [x] 本 plan Phase 1 → ✅
- [x] spec 状态 → **Phase 1 已实现**
- [ ] Commit（仅 Phase 1 文件）:

```text
style: token on-accent/panel shadow and wire shell chrome
```

---

# Phase 2 — 原语收敛与 Prose 单一真相

**Exit criteria**

- [ ] 热点手写 primary 已改用 `Button` / `buttonVariants`（见 Task 2.2 清单）
- [ ] Markdown 样式单一入口；`MessageBubble` 无大段 `[&_pre]/…` 定义（迁入入口内）
- [ ] Login 等业务无新增/存量 `text-sm`（本 phase 点名的文件）
- [ ] shell 高频 hover 与文档约定一致（新代码 `state-hover` 或等价注释）
- [ ] `yarn tsc` + 相关 test 绿；布局仍冻结

---

### Task 2.1: MarkdownBody（或 prose-hip）

**Files:**
- Create: `src/components/chat/MarkdownBody.tsx`（默认方案）
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: Skill 预览等重复 markdown class 的文件（实现时 `grep` 定位）
- Test: `MessageBubble.test.tsx` 等行为测保持通过

- [ ] **Step 1: 定位重复样式**

```bash
grep -n '\[&_pre\]\|\[&_ul\]\|ReactMarkdown' src --glob '*.tsx'
```

- [ ] **Step 2: 抽取** `MarkdownBody`：接收 `children` 或 `content` + 现有 `components`/`remarkPlugins` 策略与 MessageBubble 一致（保持外链 open 行为）
- [ ] **Step 3: MessageBubble 改用 MarkdownBody**；删除组件内重复 prose class 串
- [ ] **Step 4: 第二调用点**（Skill 配置预览等）接入；若仅一处可先只迁 MessageBubble，在 PR 说明
- [ ] **Step 5: 测试**

```bash
yarn vitest run src/components/chat/MessageBubble.test.tsx
```

---

### Task 2.2: 手写 primary → Button

**Files（实现时再 grep 校准清单）:**

```bash
grep -n 'bg-accent.*text-white\|text-white.*bg-accent' src --glob '*.tsx'
```

预期热点（spec 点名）：

| 文件 | 动作 |
|------|------|
| `src/components/account/AgentToolbar.tsx` | → `<Button variant="primary">` |
| `src/components/artifact/FileTree.tsx` | 空状态 CTA → Button |
| `src/components/login/AuthButton.tsx` | 评估并入 Button 或 `buttonVariants` + `cn` |
| `src/components/account/ProviderDetail.tsx` / `McpConfig.tsx` | 选中态 chip 未必是 Button；**仅**真正提交/主 CTA 替换；toggle chip 可保留 |

- [ ] **Step 1:** 跑 grep，更新本表「实际修改列表」写入 PR 描述
- [ ] **Step 2:** 逐个替换；保持 `data-testid` / disabled / title
- [ ] **Step 3:** 跑相关组件测试
- [ ] **Step 4:** Avatar/AI 圆标上的 `text-white`（如 MessageBubble AI badge）— **可保留或改 on-accent**；圆标算强调底，优先 `text-on-accent` 以求一致

---

### Task 2.3: 字号与 shell hover

**Files:**
- Modify: `src/routes/LoginScreen.tsx`、`src/components/login/AuthButton.tsx`
- Modify（对齐 hover）: `TitleBar`、`SessionTab`/`SessionTabBar`、`PanelToggle` 中不一致的 hover 灰

- [ ] **Step 1:** `text-sm` → `text-body` 或 `text-meta`（副文案）
- [ ] **Step 2:** 在 `tokens.css` 注释写明：`state-hover` ≡ `accent-subtle`（若仍等价）；**新代码**优先 `hover:bg-state-hover`
- [ ] **Step 3:** shell 三处 hover 统一到同一 token 类名（不改 hit area 结构）

---

### Task 2.4: Phase 2 收尾

- [ ] 走查：Chat 消息 markdown、Settings 工具条主按钮、Login
- [ ] `yarn tsc` + 相关 vitest
- [ ] 本 plan Phase 2 → ✅；spec → **`Phase 2 已实现`**
- [ ] Commit 示例：

```text
style: converge buttons and extract MarkdownBody
```

---

# Phase 3 — 质感扫尾与门禁（可选但建议做）

**Exit criteria**

- [ ] 业务 `text-sm`/`text-xs` 扫尾完成或白名单极短
- [ ] 硬编码 `shadow-[` / 业务 hex 可解释
- [ ] 走查清单勾完
- [ ] spec → **`已实现`**

---

### Task 3.1: 字号扫尾

- [ ] **Step 1:**

```bash
grep -rn 'text-sm\|text-xs\|text-base\|text-lg' src --glob '*.tsx'
```

- [ ] **Step 2:** 业务 UI 改为 token 字号；测试/第三方除外
- [ ] **Step 3:** 记录白名单（若有）于本 plan 附录

---

### Task 3.2: 硬编码扫描

- [ ] **Step 1:**

```bash
grep -rn 'shadow-\[' src --glob '*.tsx'
grep -rn 'bg-\[var(--' src --glob '*.tsx'
grep -rn '#[0-9a-fA-F]\{6\}' src/components --glob '*.tsx'
```

- [ ] **Step 2:** 能令牌化的迁入 token；保留例外写明：
  - `terminalTheme.ts` ANSI
  - 测试 mock
  - 其它（写路径 + 原因）
- [ ] **Step 3（可选）:** 文档约定「PR 前跑上述 grep」；**默认不上 CI**（spec Q5）

---

### Task 3.3: 走查清单（人工）

- [ ] New Conversation（chat / code greeting）
- [ ] 进行中会话 + 流式消息 + composer
- [ ] Code 右栏：文件树 / diff / terminal（theme 仍跟 token）
- [ ] Settings 各 tab 主按钮与卡片 hover
- [ ] History 列表与分页
- [ ] Modal / Dropdown / Command Palette
- [ ] Light + Dark + System（切换 system 跟 OS）

**禁止**借走查重排设置 IA 或改 panel 比例默认值。

---

### Task 3.4: Phase 3 收尾

- [ ] 本 plan 进度总览三 phase 均 ✅
- [ ] spec 状态 → **`已实现`**
- [ ] Commit 示例：

```text
style: finish visual token cleanup and document exceptions
```

---

## 建议执行顺序（agent）

```text
1.1 tokens → 1.2 tailwind → 1.3 Button → 1.4 AppLayout/TitleBar → 1.5 Dag → 1.6 收尾 commit
2.1 MarkdownBody → 2.2 primary 收敛 → 2.3 字号/hover → 2.4 收尾 commit
3.1–3.4 扫尾 commit
```

可用：`superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 按 Task 推进。

---

## 附录 — 白名单（实现时填写）

| 路径 | 模式 | 原因 |
|------|------|------|
| `src/components/artifact/terminalTheme.ts` | hex / ANSI | 终端调色板 |
| | | |
| | | |

---

## 附录 — Phase 完成记录

| Phase | 完成日期 | PR / commit | 备注 |
|-------|----------|-------------|------|
| 1 | 2026-07-11 | （本提交） | tokens 别名覆盖 Dag；未改 DagEditor.css |
| 2 | | | |
| 3 | | | |
