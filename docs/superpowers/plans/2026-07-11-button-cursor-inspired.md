# Cursor Agent 风格按钮 · 实施清单

> **For agentic workers:** 按 Task 顺序推进；checkbox 跟踪。优先整 phase 可合并。  
> **Spec:** [`../specs/2026-07-11-button-cursor-inspired-design.md`](../specs/2026-07-11-button-cursor-inspired-design.md)  
> **Mockup:** [`../../mockups/button-states/cursor-inspired.html`](../../mockups/button-states/cursor-inspired.html)

**Goal:** 在无绿底 CTA 前提下，将按钮升级为 Cursor Agent 式 solid inverse 主操作 + 安静 chrome + 更密尺寸，并精修 Composer / 对话框 / Segmented。

**Architecture:** 改 `buttonVariants` 一次覆盖全局 `<Button>` → Composer/对话框点修 → 新增轻量 `Segmented` → mockup/测试对齐。

**Tech Stack:** React 18, TypeScript, Tailwind 3, CVA, Vitest.

---

## Global Constraints

- **禁止** `primary` 使用 `bg-accent` / 绿底白字。  
- **布局与文案冻结**；只改 class、variant 选择、控件几何。  
- **danger 确认实心保留**。  
- 每 phase：相关 vitest 绿；建议 light/dark 目视关键表面。

---

## 进度总览

| Phase | 状态 | 一句话 |
|-------|------|--------|
| P0 原语 solid inverse + 密度 | ✅ 已完成 | Button/AuthButton/测试 |
| P1 Composer 圆钮 + Cancel ghost | ✅ 已完成 | 关键表面扫尾 |
| P2 Segmented + dangerSoft + mockup | ✅ 已完成 | 新原语与文档 |

---

## File Structure（预期）

| File | Phase | 职责 |
|------|-------|------|
| `src/components/ui/Button.tsx` | P0 / P2 | variants + sizes；可选 dangerSoft |
| `src/components/ui/Button.test.tsx` | P0 / P2 | 断言 solid inverse / danger |
| `src/components/login/AuthButton.tsx` | P0 | 通常仅跟 primary；全宽 class 保留 |
| `src/components/login/AuthButton.test.tsx` | P0 | 更新 primary 断言 |
| `src/components/chat/Composer.tsx` | P1 | 圆形 send/stop |
| `src/components/chat/Composer.test.tsx` | P1 | 可选 class 断言 |
| 各 Dialog footer（见 Task 1.2） | P1 | Cancel → ghost |
| `src/components/ui/SegmentedControl.tsx` | P2 | **新建** |
| 1 处示范接入（见 Task 2.2） | P2 | 替换互斥按钮组 |
| `docs/mockups/button-states/*.html` | P2 | 与实现同步 |
| Spec 状态 | P2 末 | 标已实现 |

---

# Phase 0 — 原语：solid inverse + 密度

**Exit criteria**

- [ ] `primary` = `bg-ink` + 反色字（如 `text-surface`），无 `bg-accent`，无 elevated「深描边+白底」主样式  
- [ ] sizes：sm≈28 / md≈32 / lg≈36 / icon≈28–30；圆角略增  
- [ ] secondary 软底弱边；ghost 安静；outline hairline；danger 不变  
- [ ] Button + AuthButton 测试绿  
- [ ] 登录 / 设置主按钮目视 solid inverse（light+dark）

---

### Task 0.1: 更新失败测试（TDD）

**Files:**
- Modify: `src/components/ui/Button.test.tsx`

- [ ] **Step 1: 改 primary 断言**

```tsx
it('primary is solid inverse monochrome, not sage or elevated outline', () => {
  const { getByRole } = render(<Button variant="primary">Save</Button>)
  const cls = getByRole('button', { name: 'Save' }).className
  expect(cls).toMatch(/\bbg-ink\b/)
  // on-ink text via surface (bg-app inverse) or explicit on-ink token
  expect(cls).toMatch(/text-surface|text-on-ink|text-\[var\(--bg-app\)\]/)
  expect(cls).not.toMatch(/\bbg-accent\b/)
  expect(cls).not.toMatch(/text-on-accent/)
  // elevated outline primary should be gone
  expect(cls).not.toMatch(/border-ink.*bg-surface|bg-surface.*border-ink/)
})
```

（若实现用 `text-on-accent` 在 dark 的 ink 上不合适——**不要**用 on-accent；坚持 surface/on-ink。）

- [ ] **Step 2: 跑测确认 FAIL（改 class 前）**

```bash
yarn vitest run src/components/ui/Button.test.tsx
```

---

### Task 0.2: 实现 `buttonVariants`

**Files:**
- Modify: `src/components/ui/Button.tsx`

- [ ] **Step 1: 替换 variant / size（语义对齐 spec §4）**

```tsx
// 目标语义示例（以最终 Tailwind 类名为准）
primary:
  'border border-transparent bg-ink text-surface font-medium hover:opacity-90 focus-visible:ring-ink/30'
  // 或 hover:brightness / 单独 hover:bg 若 opacity 影响子元素则改用明确 hover 色

secondary:
  'border border-transparent bg-surface-subtle text-ink hover:bg-surface-muted focus-visible:ring-ink/20'

outline:
  'border border-border bg-transparent text-ink hover:bg-state-hover focus-visible:ring-ink/20'

ghost:
  'border border-transparent text-ink-secondary hover:bg-state-hover hover:text-ink focus-visible:ring-ink/20'

danger:
  'border border-transparent bg-danger text-on-accent hover:bg-danger/90 focus-visible:ring-danger/40'

size:
  sm: 'h-7 px-2.5 text-body rounded-md'      // 28px
  md: 'h-8 px-3 text-body rounded-lg'        // 32px
  lg: 'h-9 px-3.5 text-body rounded-lg'      // 36px
  icon: 'h-7 w-7 p-0 text-body rounded-lg'   // 28
```

Base 可保留 `active:scale-[0.985]`、`transition`、`disabled:opacity-40`。

- [ ] **Step 2: 测试 PASS**

```bash
yarn vitest run src/components/ui/Button.test.tsx
```

- [ ] **Step 3: 更新 AuthButton 测试**

```tsx
// solid → 期望 bg-ink，非 border-ink+bg-surface
expect(btn.className).toMatch(/\bbg-ink\b/)
expect(btn.className).not.toMatch(/\bbg-accent\b/)
```

```bash
yarn vitest run src/components/login/AuthButton.test.tsx
```

- [ ] **Step 4: AuthButton 登录专用** — 保持 `h-11 w-full rounded-xl`；确认与新 primary 不冲突（字色反色可读）。

---

### Task 0.3: P0 烟测

```bash
yarn vitest run src/components/ui src/components/login src/components/chat/Composer.test.tsx src/components/chat/PlanApprovalCard.test.tsx src/components/chat/PermissionModal.test.tsx
```

- [ ] 失败仅因 class 断言时更新断言，不改行为。  
- [ ] 目视：登录 Email、设置 Add、任意 Save。  
- [ ] 勾选本 phase exit criteria；标进度表 P0 ✅。

---

# Phase 1 — Composer 圆钮 + 对话框 Cancel

**Exit criteria**

- [ ] Send/Stop 为圆形 solid（`rounded-full`），仍 `data-testid` 不变  
- [ ] 主要对话框 Cancel 为 `ghost`  
- [ ] 相关测试绿

---

### Task 1.1: Composer 圆形 Send/Stop

**Files:**
- Modify: `src/components/chat/Composer.tsx`
- Modify: `src/components/chat/Composer.test.tsx`（如需）

- [ ] **Step 1: 为 send/stop 增加圆形几何**

```tsx
className="h-7 w-7 shrink-0 rounded-full"
// 叠在 buttonVariants({ variant: 'primary', size: 'icon' }) 上
// 用 cn(buttonVariants(...), 'rounded-full h-7 w-7') 
// 或 <Button className="rounded-full ..." />
```

Stop 按钮同样圆形，保持 `data-testid="composer-stop"`。

- [ ] **Step 2: 跑 Composer 测试**

```bash
yarn vitest run src/components/chat/Composer.test.tsx
```

- [ ] **Step 3: 目视** 空输入 disabled / 有输入可点 / 运行中 stop。

---

### Task 1.2: 对话框 Cancel → ghost

**Files（按存在情况修改，Cancel 现为 outline 的改为 ghost）：**

| 文件 | 动作 |
|------|------|
| `src/components/account/AgentEditor.tsx` | Cancel → `ghost` |
| `src/components/account/AddProviderDialog.tsx` | Cancel → `ghost` |
| `src/components/account/DeleteAgentDialog.tsx` | Cancel → `ghost` |
| `src/components/account/McpConfig.tsx` | 表单/删除 Cancel → `ghost` |
| `src/components/account/PluginConfig.tsx` / `PluginConfigView.tsx` | 同上 |
| `src/components/account/SkillConfig.tsx` | 删除确认 Cancel → `ghost` |
| `src/components/history/DeleteSessionDialog.tsx` | Cancel → `ghost` |
| `src/components/history/ClearAllSessionsDialog.tsx` | Cancel → `ghost` |
| `src/components/artifact/BranchSwitcher.tsx` | 确认条 Cancel 若 outline → ghost |
| `src/components/artifact/TimelineView.tsx` | revert Cancel → ghost |
| `src/components/chat/PermissionModal.tsx` | 次要操作按矩阵 |
| `src/components/chat/PlanApprovalCard.tsx` | 次要/拒绝若适合 ghost 则改；主批准保持 primary |

- [ ] **Step 1:** `rg 'variant="outline"' src/components --glob '*.tsx'` 人工筛 Cancel/关闭。  
- [ ] **Step 2:** 批量改为 `variant="ghost"`（仅 Cancel/次要，**不要**把主 CTA 改 ghost）。  
- [ ] **Step 3:** 跑 account/history 相关测试。

```bash
yarn vitest run src/components/account src/components/history src/components/chat/PlanApprovalCard.test.tsx src/components/chat/PermissionModal.test.tsx
```

---

### Task 1.3: P1 收尾

- [ ] 进度表 P1 ✅  
- [ ] 目视：任意删除对话框、保存对话框、Composer。

---

# Phase 2 — Segmented + dangerSoft + mockup

**Exit criteria**

- [ ] `SegmentedControl`（或 `Segmented`）可复用  
- [ ] ≥1 处真实互斥 UI 接入  
- [ ] 可选 `dangerSoft` 进入 variants + 测试  
- [ ] mockup HTML 与实现一致；spec 状态 **已实现**

---

### Task 2.1: dangerSoft（可选但建议做）

**Files:**
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Button.test.tsx`

```tsx
dangerSoft:
  'border border-danger/30 bg-transparent text-danger hover:bg-danger/10 focus-visible:ring-danger/30'
```

- [ ] 测试：dangerSoft 含 `text-danger`，不含 `bg-danger` 实心（或仅 10% hover）。  
- [ ] 调用点：仅当发现行内实心 Delete 过重时替换 1 处；否则只暴露 API。

---

### Task 2.2: Segmented 原语

**Files:**
- Create: `src/components/ui/SegmentedControl.tsx`
- Create: `src/components/ui/SegmentedControl.test.tsx`
- Modify: 一处互斥 UI（推荐优先检查）：
  - `src/components/artifact/ChangesView.tsx` / `TimelineView.tsx` 的 mode 切换 pill  
  - 或 `PermissionModePicker` 类控件  
  - 以「已是互斥、现为多按钮」为准，实现时 grep `diffViewMode` / `aria-selected` 选定

**API 草图：**

```tsx
type SegmentedOption<T extends string> = { value: T; label: string }

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  'aria-label': ariaLabel,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  'aria-label'?: string
}) {
  // role="tablist" / tab；选中 aria-selected
  // track: rounded-lg bg-surface-muted p-0.5 border border-border
  // item selected: bg-surface text-ink shadow-sm / ring-1 ring-border
}
```

- [ ] 测试：点击切换调用 onChange；选中项 `aria-selected="true"`。  
- [ ] 接入 1 处后目视 dark/light。

---

### Task 2.3: Mockup + 文档

**Files:**
- Modify: `docs/mockups/button-states/index.html` — primary 改为 solid inverse，sizes 对齐  
- Modify: `docs/mockups/button-states/cursor-inspired.html` — 页头标注 Implemented / 日期  
- Modify: `docs/superpowers/specs/2026-07-11-button-cursor-inspired-design.md` — 状态 **已实现**  
- Modify: 本 plan 进度表全 ✅  

- [ ] 本地打开 mockup 与 app 对照无严重漂移。

---

### Task 2.4: 最终验证

```bash
yarn vitest run src/components/ui src/components/login src/components/chat/Composer.test.tsx
# 门禁：primary 不应再是 border-ink+bg-surface elevated
# 门禁：无 bg-accent 作 Button primary
```

- [ ] Spec §7.2 目视矩阵勾选  
- [ ] 进度 P2 ✅

---

## 验收检查表（产品）

| # | 检查项 | P0 | P1 | P2 |
|---|--------|----|----|-----|
| 1 | 主 CTA 为反色实心，非绿、非深描边白底 | ☐ | | |
| 2 | 暗色下 primary 仍清晰 | ☐ | | |
| 3 | Composer 圆 send + disabled 态 | | ☐ | |
| 4 | 对话框 Cancel 安静（ghost） | | ☐ | |
| 5 | Segmented 至少一处 | | | ☐ |
| 6 | 删除确认仍为 danger 实心 | ☐ | ☐ | |
| 7 | 登录与全局 primary 一致 | ☐ | | |

---

## 执行建议

1. **先 P0**（一个 PR）：全局观感立即 Cursor 化。  
2. **P1** 紧随：Composer + Cancel 是感知第二高。  
3. **P2** 可同 PR 或随后：Segmented / dangerSoft / mockup。

用户已确认方向；执行时说 **「执行 plan」** 或 **「先做 P0」** 即可开工。
