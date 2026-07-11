# Cursor Agent 风格 · 按钮体系升级

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **已实现** |
| 类型 | 设计系统原语 + 关键表面精修（不扩产品面） |
| 参照 | Cursor Agent Desktop / IDE 侧栏；mockup [`../../mockups/button-states/cursor-inspired.html`](../../mockups/button-states/cursor-inspired.html) |
| 前置 | `2026-07-11-button-neutral-cta` **已实现**（去掉绿底白字；现 primary = elevated 描边） |
| 实施清单 | [`../plans/2026-07-11-button-cursor-inspired.md`](../plans/2026-07-11-button-cursor-inspired.md) |
| 覆盖关系 | **修正** neutral-cta 中「primary = 深描边 + surface」的 CTA 约定 → **primary = solid inverse 单色填充** |

---

## 1. 问题陈述

中性 CTA 阶段已消除鼠尾草绿作按钮油漆，但 primary 采用 **elevated 描边**（`border-ink` + 白底 + 深字）。该形态适合登录列表，在 Agent 工作台（Composer、对话框、工具栏）里偏「表单按钮」，与 Cursor Agent Desktop 的 **工具栏层级** 气质不一致：

| 维度 | hip 现状（D） | Cursor Agent 气质 |
|------|---------------|-------------------|
| 主操作 | 描边抢戏 | **反色实心**表达主次 |
| 次操作 | secondary / outline 框感重 | **软底或 ghost**，默认安静 |
| 密度 | md=36、字 13、字重偏重 | 更矮、更软、字重更轻 |
| Send | icon + primary 方钮 | **圆形实心**发送 |
| 模式切换 | 多枚实心/描边 chip 并列 | **Segmented** track |

目标：在 **继续禁止绿底 CTA** 的前提下，把按钮层级改成 Cursor 化的 **填充层级 + 安静 chrome**，并收敛登录 / Composer / 对话框脚注的用法。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| C1 | **`buttonVariants.primary` → solid inverse**：亮色近黑底+浅字，暗色近白底+深字；**无** `bg-accent`、**无** elevated 深描边作主 CTA |
| C2 | **密度**：`sm/md/lg/icon` 高度与圆角略收；字重 primary 用 medium（~500–550），避免 marketing semibold 过重 |
| C3 | **secondary / outline / ghost 分工**：secondary = 无（或极弱）描边软底；outline = 少用的 hairline；ghost = 默认 chrome / Cancel |
| C4 | **Composer Send/Stop**：圆形 solid icon（仍用 primary 色 token），空输入 disabled |
| C5 | **对话框约定**：Cancel → `ghost`（或 secondary 软）；确认 → `primary`；破坏性确认 → `danger` |
| C6 | **Segmented 原语**（轻量）：互斥模式/筛选；禁止用多枚 `primary` 并列充当 segment |
| C7 | **可选 `dangerSoft`**：行内/次级破坏操作（描边或文字红），大红块仅用于确认 |
| C8 | **登录同源**：`AuthButton` 继续吃 `buttonVariants`，随 primary 自动 solid inverse |
| C9 | **测试 + mockup 更新**：Button 断言、Composer 测试、mockup HTML 与实现一致 |
| C10 | **布局/文案冻结**：只改样式与控件形态；不改流程、文案语义、信息架构 |

### Non-Goals

| ID | 非目标 |
|----|--------|
| N1 | 恢复 sage 绿底主按钮 |
| N2 | 全库每个 chip/列表行重做成 segment（仅提供原语 + 1–2 处示范接入） |
| N3 | 重做 Avatar / MessageBubble 身份 chip（仍可 follow-up） |
| N4 | 换字体家族、全局 elevation 系统、第二主题编辑器 |
| N5 | 1:1 像素复刻 Cursor 专有资源（图标、动画）；只取 **交互与层级原则** |

---

## 3. 设计原则（钉死）

1. **填充表达主次，描边不抢戏** — primary 靠反差填充；outline 降级为少数场景。  
2. **默认安静，hover 才出现** — 工具栏/Cancel 优先 ghost。  
3. **Agent 密度** — 控件更像 IDE chrome，不是营销 CTA。  
4. **亮暗对称** — solid inverse 通过 `bg-ink` + `text-surface`（或等价 token）自动反相，不写死 `#fff`/`#000`。  
5. **品牌绿仍非按钮油漆** — 可选用于 focus 点缀/状态点/选中条 subtle，不作 primary fill。  
6. **单一真相源** — 仅 `buttonVariants` + 明确新增组件（Segmented、Composer 圆钮样式）；禁止业务再手写 primary 油漆。

---

## 4. 目标 `buttonVariants`（语义）

实现 class 可微调，**语义不可改**。

### 4.1 Variant

| Variant | 表面 | 边框 | 文字 | Hover | 用途 |
|---------|------|------|------|-------|------|
| **primary** | `bg-ink` | 同色或 transparent | `text-surface`（反色） | 略亮/略淡 ink | Save / Apply / Add / 登录主 CTA / Send 底色 |
| **secondary** | `bg-surface-subtle` 或 elevated | 无或 `border-transparent` | `text-ink` | 略深 soft | 并列次操作、OAuth 次级 |
| **outline** | transparent / surface | `border-border` hairline | `text-ink` | ghost-hover | 需要「盒子」时少用 |
| **ghost** | transparent | none | `text-ink-secondary` | `state-hover` + `text-ink` | Cancel、工具栏、更多 |
| **danger** | `bg-danger` | none | `text-on-accent` | 略亮/暗 | 破坏性 **确认** |
| **dangerSoft**（新） | transparent | 淡 danger 边 或 无边 | `text-danger` | 淡红底 | 行内删除、次级破坏 |

Focus：双环风格优先 — `ring` 用 ink 低透明（danger 用 danger 低透明），与 Cursor/VS Code 接近；**不要**再用 accent 绿环作为主 focus（可保留极低对比，但不作为识别色）。

Active：`scale-[0.985]` 或保持现有 0.97（略收即可）。

Disabled：`opacity-40~50` + `pointer-events-none`。

### 4.2 Size

| Size | 现高 | 目标高 | 圆角 | 备注 |
|------|------|--------|------|------|
| sm | 32 (`h-8`) | **28** (`h-7`) | 6–7px | 对话框脚注 |
| md | 36 (`h-9`) | **32** (`h-8`) | 8px | 默认 |
| lg | 40 (`h-10`) | **36** (`h-9`) | 8–10px | 登录全宽可再 `rounded-xl` |
| icon | 32 | **28–30** | 7–8px；Send 特例 **圆 999** | Composer 见 §5 |

字号：继续 `text-body` 或略收；primary **不要** `font-semibold` 过重 → `font-medium`。

### 4.3 Token 建议（若缺则补，尽量复用）

| 用途 | 建议 |
|------|------|
| primary 底 | `bg-ink`（已有） |
| primary 字 | 需「on-ink」：优先 `text-surface`（surface=bg-app，亮白暗黑）验证对比；不足则加 `--on-ink` |
| soft elevated | `bg-surface-subtle` / `bg-surface-muted` |
| ghost hover | `bg-state-hover`（已有） |

---

## 5. 关键表面

### 5.1 Composer Send / Stop

**文件：** `src/components/chat/Composer.tsx`

| 状态 | 形态 |
|------|------|
| 可发送 | 圆形 solid primary，icon（ArrowUp） |
| 不可发送 | 同形 disabled（opacity） |
| 运行中 Stop | 同圆形体系；可用 primary 或略强调（仍单色，非绿） |

实现选项（择一，plan 钉死）：

- **A（推荐）**：`Button variant="primary" size="icon"` + `className="rounded-full h-7 w-7"`（或专用 `size="iconSend"`）  
- **B**：`buttonVariants` 抽 `icon` 默认圆角，Send 加 `rounded-full`

测试：`Composer.test.tsx` 保持 `data-testid="composer-send"`；可断言 class 含 `rounded-full` / `bg-ink`。

### 5.2 对话框脚注

| 角色 | variant |
|------|---------|
| Cancel / 关闭 | `ghost`（首选）或 `secondary` |
| 确认 / 保存 | `primary` |
| 删除确认 | `danger` |

扫尾：`AgentEditor`、`AddProviderDialog`、`Delete*Dialog`、`McpConfig`、`PermissionModal`、`PlanApprovalCard` 等 footer 中 **Cancel 现用 outline 的改为 ghost**（plan 列清单）。

### 5.3 登录

`AuthButton`：solid → primary，outline → secondary（已接 `buttonVariants`）。  
primary 改为 solid inverse 后登录自动升级；全宽 `h-11` + `rounded-xl` 可保留登录专用 class。

### 5.4 Segmented control

**新建** `src/components/ui/SegmentedControl.tsx`（名称可短：`Segmented`）：

- API 草图：`options: { value, label }[]`，`value`，`onChange`，`size?: 'sm' | 'md'`
- 样式：track（`bg-surface-muted` / 低透明）+ 选中块（surface elevated + 细边/轻阴影）
- **首批接入（示范，非全库）**：择 1–2 处互斥 UI（例如 diff view mode 或 permission mode 类控件，若已有按钮组且适合）
- 不适合的多选 filter 仍用 soft chip（secondary/outline），**禁止**多 primary

### 5.5 dangerSoft

- 加入 `buttonVariants.variant.dangerSoft`
- 首批：仅当现有「行内删除」已是实心 danger 且过重时替换；否则只提供 API，调用点可选

---

## 6. 明确不改

- 列表选中 `bg-accent-subtle` / `text-accent-strong`
- Resize handle accent 高亮
- Activity 圆点、角色色
- MessageBubble / ThinkingBubble 身份 chip（follow-up）
- `danger` 确认实心语义

---

## 7. 测试与验收

### 7.1 自动化

- `Button.test.tsx`：  
  - primary 含 `bg-ink`（或约定类），**不含** `bg-accent`、**不含** 仅描边 elevated（无 `border-ink`+`bg-surface` 组合作 primary）  
  - danger 仍 `bg-danger` + `text-on-accent`  
  - 若有 dangerSoft：有对应断言  
- `AuthButton.test.tsx`：solid 随 primary（bg-ink 体系）  
- `Composer.test.tsx`：send 仍可用；形态断言可选  
- 对话框相关测试若断言 `outline` Cancel，改为接受 ghost

### 7.2 目视矩阵

| 表面 | light | dark |
|------|-------|------|
| 登录主/次按钮 | ☐ | ☐ |
| Composer send/stop | ☐ | ☐ |
| Settings 添加/保存 footer | ☐ | ☐ |
| 删除确认 | ☐ | ☐ |
| Segmented（若接入） | ☐ | ☐ |

### 7.3 Mockup

- 更新 `docs/mockups/button-states/index.html` 反映 solid inverse  
- `cursor-inspired.html` 可标注 **implemented** 或与 index 合并链接

### 7.4 回归门禁（延续）

```bash
# 禁止绿底 CTA（允许 danger / 身份 chip 白名单）
# primary 应为 bg-ink 体系，而非 bg-accent
```

---

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| solid inverse 在部分浅灰底上对比不足 | 坚持 `bg-ink`/`text-surface`；目视 settings 卡片底 |
| Cancel 变 ghost 后可发现性下降 | footer 仍右对齐主按钮；Cancel 保持文案与位置 |
| 高度缩小导致点击热区不足 | sm 不低于 28px；icon Send ≥ 28–30 |
| 与「elevated D」用户预期差 | mockup 已确认方向；PR 说明覆盖 neutral-cta primary 定义 |

回滚：还原 `Button.tsx` size/variant + Composer class 即可。

---

## 9. 分阶段

| Phase | 内容 | 可独立合并 |
|-------|------|------------|
| **P0** | `buttonVariants` solid inverse + 密度；测试；AuthButton 自动跟随 | ✅ 主收益 |
| **P1** | Composer 圆钮；对话框 Cancel→ghost 扫尾 | ✅ |
| **P2** | Segmented 原语 + 1 处示范；可选 dangerSoft；mockup 同步 | ✅ |

---

## 10. 与既有 spec 关系

| Spec | 关系 |
|------|------|
| `visual-design-style-architecture` | 仍遵守：布局冻结、token 真相源、扁平 chrome |
| `button-neutral-cta` | **继承**「无绿底 CTA」；**替换** primary 形态定义（描边 elevated → solid inverse） |
| 登录视觉升级 | 左 GIF/白底不动；右按钮随全局 primary |

---

## 11. 推荐落地优先级（已确认）

1. `primary` → solid inverse  
2. size 略收（md=32）  
3. Composer 圆形 send  
4. 对话框 Cancel → ghost  
5. Segmented + 可选 dangerSoft  

Mockup 预览：`docs/mockups/button-states/cursor-inspired.html`（用户已确认方向）。
