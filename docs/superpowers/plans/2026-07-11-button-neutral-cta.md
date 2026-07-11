# 中性 CTA 按钮体系 · 实施清单

> **For agentic workers:** 按 Task 顺序推进；用 checkbox 跟踪。优先整 phase 可合并。  
> **Spec:** [`../specs/2026-07-11-button-neutral-cta-design.md`](../specs/2026-07-11-button-neutral-cta-design.md)

**Goal:** 全产品去掉「绿底 + 浅色字」按钮 CTA，与登录页右侧 elevated 设计（方案 D）对齐。

**Architecture:** 在 `buttonVariants` 一次改 primary/secondary；业务 `<Button>` 自动继承；手写绿底控件单点修；`AuthButton` 收敛到同一原语；rg + 单测防回归。

**Tech Stack:** React 18, TypeScript, Tailwind 3, CVA, Vitest.

---

## Global Constraints

- **只改按钮/可点击 CTA 的填充语义**；不改布局、文案、流程。
- **danger 实心红保留**；subtle/选中条/resize 高亮等非「绿底白字按钮」默认不碰。
- **亮暗都过目视**。
- **每 phase 结束** 跑相关 vitest；能跑则 `yarn tsc`（允许仓库既有无关错误）。

---

## 进度总览

| Phase | 状态 | 一句话 |
|-------|------|--------|
| P0 原语 + 登录收敛 | ✅ 已完成 | `Button` primary→中性 elevated；AuthButton 同源 |
| P1 手写绿底控件 | ✅ 已完成 | ProviderDetail caps / McpConfig 选中指示 |
| P2 扫尾与门禁 | ✅ 已完成 | rg 仅剩 chip follow-up；spec 已更新 |

---

## File Structure（预期触碰）

| File | Phase | Responsibility |
|------|-------|----------------|
| `src/components/ui/Button.tsx` | P0 | 改 `primary` / 必要时 `secondary` / focus |
| `src/components/ui/Button.test.tsx` | P0 | **新建或扩展** primary 中性断言 |
| `src/components/login/AuthButton.tsx` | P0 | 使用 `buttonVariants` |
| `src/components/login/AuthButton.test.tsx` | P0 | 更新断言 |
| `src/components/account/ProviderDetail.tsx` | P1 | capability 选中态去绿底白字 |
| `src/components/account/McpConfig.tsx` | P1 | 选中圆点去绿底白字 |
| 其它 rg 命中的按钮型 class | P1–P2 | 按需 |
| Spec / Plan 状态 | 各 phase 末 | 勾选 |

**通常不必改**（仅消费 `<Button>`）：`Composer`、`AgentToolbar`、`FileTree`、`PlanApprovalCard`…——P0 后自动正确。若测试写死 `bg-accent` class 则更新测试。

---

# Phase 0 — 原语与登录收敛

**Exit criteria**

- [x] `buttonVariants.primary` 为中性 elevated（深描边 + surface + ink 字），**无** `bg-accent`
- [x] `secondary` / `outline` 与登录次级不冲突、层级可分
- [x] `danger` 未改语义
- [x] `AuthButton` 不再维护平行配色字符串
- [x] Button + AuthButton 测试绿
- [x] light/dark 目视：登录、Composer 发送、设置「添加」（实现侧已对齐；建议本地再目视）

---

### Task 0.1: 写失败测试 — primary 不得绿底

**Files:**
- Create or Modify: `src/components/ui/Button.test.tsx`

- [ ] **Step 1: 添加测试**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Button } from './Button'

afterEach(() => cleanup())

describe('Button variants', () => {
  it('primary is neutral elevated, not sage fill', () => {
    const { getByRole } = render(<Button variant="primary">Save</Button>)
    const cls = getByRole('button', { name: 'Save' }).className
    expect(cls).toMatch(/border-ink/)
    expect(cls).toMatch(/bg-surface/)
    expect(cls).not.toMatch(/bg-accent(?!-)/) // allow accent-subtle if ever, not bg-accent alone
    expect(cls).not.toMatch(/text-on-accent/)
  })

  it('danger keeps filled semantic', () => {
    const { getByRole } = render(<Button variant="danger">Delete</Button>)
    const cls = getByRole('button', { name: 'Delete' }).className
    expect(cls).toMatch(/bg-danger/)
    expect(cls).toMatch(/text-on-accent/)
  })
})
```

- [ ] **Step 2: 跑测试确认 primary 断言在改原语前失败**

```bash
yarn vitest run src/components/ui/Button.test.tsx
```

Expected: primary 相关 FAIL。

---

### Task 0.2: 改 `buttonVariants`

**Files:**
- Modify: `src/components/ui/Button.tsx`

- [ ] **Step 1: 替换 variants（保持 size / 其它 API）**

```tsx
// variants.variant 目标语义（class 以 spec §3.2 为准，可微调用 token）:
primary:
  'border border-ink bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-surface-subtle focus-visible:ring-ink/25'
secondary:
  'border border-border bg-surface-subtle text-ink hover:bg-surface-muted'
ghost:
  'text-ink-secondary hover:bg-state-hover hover:text-ink'  // 去掉 accent-subtle 依赖可选
outline:
  'border border-border bg-surface text-ink hover:bg-surface-muted'
danger:
  'bg-danger text-on-accent hover:bg-danger/90'  // 不变
```

- [ ] **Step 2: 跑 Button 测试 PASS**

```bash
yarn vitest run src/components/ui/Button.test.tsx
```

- [ ] **Step 3: Commit（若用户要求提交）**

```bash
git add src/components/ui/Button.tsx src/components/ui/Button.test.tsx
git commit -m "feat(ui): neutral elevated primary button (no sage fill)"
```

---

### Task 0.3: AuthButton 收敛到 buttonVariants

**Files:**
- Modify: `src/components/login/AuthButton.tsx`
- Modify: `src/components/login/AuthButton.test.tsx`

- [ ] **Step 1: 实现**

```tsx
import type { LucideIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

// solid → primary, outline → secondary（或 outline）
export function AuthButton({ icon: Icon, label, onClick, variant = 'outline', ... }: ...) {
  const isPrimary = variant === 'solid'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        buttonVariants({ variant: isPrimary ? 'primary' : 'secondary', size: 'lg' }),
        'h-11 w-full gap-2.5 rounded-xl',
      )}
      ...
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </button>
  )
}
```

- [ ] **Step 2: 测试仍断言无 `bg-accent`；可断言含 `border-ink`（primary）**

- [ ] **Step 3: 跑登录相关测试**

```bash
yarn vitest run src/components/login src/components/ui/Button.test.tsx
```

---

### Task 0.4: P0 目视与相关测试烟测

- [ ] **Step 1: 烟测可能写死 class 的测试**

```bash
yarn vitest run src/components/chat/Composer.test.tsx src/components/account/AgentToolbar.tsx 2>/dev/null
# 或更宽：
yarn vitest run src/components/chat src/components/account src/components/artifact --passWithNoTests 2>&1 | tail -40
```

若有 `bg-accent` / `toHaveClass` 失败，只改断言对齐中性 primary。

- [ ] **Step 2: 本地 `yarn tauri dev` 或 `yarn dev` 目视**
  - 登录右侧
  - Composer 发送
  - Settings → Agents「添加」
  - dark mode 同上

- [ ] **Step 3: 更新本 plan Phase P0 状态为 ✅**

---

# Phase 1 — 手写绿底交互控件

**Exit criteria**

- [x] `ProviderDetail` capability 选中无 `bg-accent text-on-accent`
- [x] `McpConfig` 选中指示无绿底白字
- [x] 再跑一次 scoped rg，按钮型命中仅剩白名单

---

### Task 1.1: ProviderDetail capability chips

**Files:**
- Modify: `src/components/account/ProviderDetail.tsx`（约 260 行附近）

- [ ] **Step 1: 将选中态从**

```tsx
caps[f.key] ? 'bg-accent text-on-accent' : 'border border-border ...'
```

**改为**

```tsx
caps[f.key]
  ? 'border border-ink bg-surface text-ink font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
  : 'border border-border text-ink-secondary hover:bg-state-hover'
```

- [ ] **Step 2: 若有测试覆盖 caps，更新；否则手测设置 → Provider 能力开关**

---

### Task 1.2: McpConfig 选中圆点 / 同类

**Files:**
- Modify: `src/components/account/McpConfig.tsx`（约 906 行：`bg-accent text-on-accent`）

- [ ] **Step 1: 选中指示改为中性**

```tsx
// 例：实心 ink 小点，或 border-ink bg-ink text-surface（非 accent）
selected ? 'border-ink bg-ink text-surface' : 'border-border'
// 或更淡：selected ? 'border-ink bg-surface' : ...
```

注意：`text-surface` 在 dark 下是深底，需确认对比；更稳妥用 `bg-ink` + `text-[var(--bg-app)]` / 既有 on-surface 若无则用 `text-surface` 仅当 surface 为反色背景字。

更简单且符合 D：

```tsx
selected ? 'border-ink bg-surface ring-1 ring-ink' : 'border-border'
```

- [ ] **Step 2: 跑 `McpConfig` 相关测试**

```bash
yarn vitest run src/components/account/McpConfig
```

---

### Task 1.3: 二次盘点

- [ ] **Step 1: 搜索**

```bash
rg -n "bg-accent[^\"']*text-on-accent|text-on-accent[^\"']*bg-accent|bg-accent text-white" src --glob '*.tsx'
```

- [ ] **Step 2: 对每个命中分类**
  - **按钮/开关** → 本 phase 改掉
  - **Avatar/气泡 chip** → 记入 P2 follow-up，不改
  - **danger** → 跳过

---

# Phase 2 — 扫尾、门禁、文档

**Exit criteria**

- [x] Spec 状态改为「已实现」或「P0–P1 已实现；chip 除外」
- [x] 门禁命令写入 plan 或 CLAUDE/注释；本地可重复
- [x] 全量登录 + ui 测试绿

---

### Task 2.1: 回归门禁脚本（文档化即可）

- [ ] **Step 1: 在 plan 或 `docs/...` 固定命令**

```bash
# 允许：Button danger、MessageBubble/ThinkingBubble/Avatar 等白名单
rg -n "bg-accent\s+[^\n]*text-on-accent|bg-accent text-white" src --glob '*.tsx' \
  | rg -v "Button\.tsx|MessageBubble|ThinkingBubble|Avatar|danger" || true
```

期望：无输出，或仅剩已记录 follow-up。

---

### Task 2.2: 更新 spec 状态

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-button-neutral-cta-design.md`

- [ ] 状态 → **已实现**（或分条：P0/P1 完成）
- [ ] 若 Avatar chip 未改，在 Non-Goals / Follow-up 写明

---

### Task 2.3: 最终验证

```bash
yarn vitest run src/components/ui src/components/login
yarn vitest run src/components/account/McpConfig src/components/account/ProviderDetail --passWithNoTests
```

- [ ] light/dark 页面矩阵（spec §5）勾选

---

## 验收检查表（产品）

| # | 检查项 | P0 | P1 | P2 |
|---|--------|----|----|-----|
| 1 | 任意主 CTA 非绿底白字 | ☐ | | |
| 2 | 删除类仍为 danger 红 | ☐ | | |
| 3 | 登录与设置主按钮视觉一致 | ☐ | | |
| 4 | 列表选中 subtle 仍可用品牌浅底 | ☐ | ☐ | |
| 5 | 无业务平行 primary class | | ☐ | ☐ |

---

## 执行建议

1. **先做 P0**（1 个小 PR）：收益最大、风险可控。  
2. **再 P1** 扫手写控件。  
3. **P2** 文档与门禁，可不单独占 PR。

需要执行时：在本会话选 **Inline** 按 Task 推进，或 **Subagent-Driven** 分 task 派发。
