# 视觉设计与样式架构 · 克制升级

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **Phase 2 已实现** |
| 类型 | 设计系统收敛 / UI polish（不扩产品面） |
| 前置 | 现有 token + Tailwind + `components/ui` 已可用；布局骨架稳定 |
| 实施清单 | [`../plans/2026-07-11-visual-design-style-architecture.md`](../plans/2026-07-11-visual-design-style-architecture.md) |
| 相关 | `src/styles/tokens.css`、`tailwind.config.js`、`src/components/ui/*`、`src/components/theme/ThemeProvider.tsx` |

---

## 1. 问题陈述

hip 前端已具备可识别的视觉方向与半成品设计系统：

- **方向正确**：单色 chrome、Sage Gray 品牌强调、扁平主界面、仅浮层用阴影、AA 对比意识、`prefers-reduced-motion`。
- **架构半完成**：CSS 变量在 `tokens.css`，Tailwind 映射在 `tailwind.config.js`，`cn` + `cva` 仅在部分原语落地。
- **执行不齐**：业务组件内仍有硬编码 `shadow-[…]`、`bg-[var(--…)]`、手写 primary 按钮、`text-sm` 与 token 字号混用；暗色下 `text-white` 铺在浅色 accent 上对比偏弱；第三方覆盖（`DagEditor.css`）变量名与 token 不一致。

若不收口，后续功能会继续复制局部 class，品牌与交互状态会漂移；若重做布局/换皮肤，成本高且与「克制」目标冲突。

本 spec 定义一次 **布局冻结、令牌补洞、原语收敛、渐进迁移** 的升级，把系统从「半设计系统」收到「可长期演进的薄设计系统」。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| V1 | **布局冻结**：`AppLayout` Panel 结构、TitleBar 角色、主对话列、右侧浮动面板形态与信息架构不变 |
| V2 | **令牌唯一真相源**：颜色 / 玻璃 / 面板阴影 / on-accent / 角色色 仅在 `tokens.css`（+ Tailwind 映射）定义 |
| V3 | **暗色 primary 对比可读**：填充按钮使用 `--on-accent`，不再依赖「永远白字」 |
| V4 | **字号阶梯落地**：业务 UI 优先 `caption` / `meta` / `body` / `prose` / `title` / `display` / `stat`；消灭 chrome 中的 `text-sm` / `text-base` 误用 |
| V5 | **原语优先**：primary / ghost / icon 按钮等可点击控件优先走 `Button`（或导出的 `buttonVariants`）；禁止再复制 `bg-accent text-white hover:bg-accent-hover` 三件套 |
| V6 | **Markdown / 长文样式单一真相**：Chat / Skill 预览等共用 prose 样式源，去掉 `MessageBubble` 内超长 `[&_*]` 重复 |
| V7 | **第三方 CSS 与 token 对齐**：`DagEditor.css` 等使用真实变量名或兼容别名 |
| V8 | **分阶段可验收**：每 phase 可独立合并；视觉 diff 为「对齐与对比修正」，非换皮 |

### Non-Goals

| ID | 非目标 |
|----|--------|
| N1 | 重做三栏 / 侧边导航 / 会话信息架构 |
| N2 | 引入第二套强调色主题、用户自定义主题编辑器 |
| N3 | 全局卡片 elevation、Material 式阴影层级 |
| N4 | 迁移 Tailwind v4、CSS-in-JS、完整 shadcn 脚手架、Storybook monorepo |
| N5 | 更换展示字体为「再贴一个 Inter / 几何无衬线」类同质方案 |
| N6 | 大范围无关重构、组件目录大搬迁、重写 Diff/Terminal 引擎 |
| N7 | 新增产品功能或改 i18n 文案语义（仅样式与结构） |

---

## 3. 设计原则（钉死）

1. **克制优先**：一次只动令牌或一类组件；「去掉一件装饰」优于「多加一层质感」。
2. **布局冻结**：成功标准是用户感觉「更齐、更稳」，不是「换了一个 app」。
3. **扁平 chrome，浮层可阴影**：主界面无 elevation；仅菜单、Modal、右侧浮动 panel 允许阴影令牌。
4. **语义消费，禁止硬编码**：业务不写 hex、不写长任意 shadow、不直接 `bg-[var(--bg-app)]`（应用 `bg-surface` 等语义类）。
5. **亮暗对称**：每个新增 token 必须同时定义 `:root` 与 `.dark`。
6. **无障碍底线**：对比度不低于现有 AA 取向；保留 reduced-motion 兜底；focus 环不削弱。
7. **渐进迁移**：新代码 100% 合规；旧代码按热点路径分批，不要求单 PR 全库清零。

---

## 4. 现状基线（写 spec 时）

### 4.1 已有资产

| 层 | 路径 | 内容 |
|----|------|------|
| 令牌 | `src/styles/tokens.css` | surface / ink / accent / semantic / role / glass / state / layout 尺寸 |
| 映射 | `tailwind.config.js` | colors、fontSize 阶梯、radius、扁平化 boxShadow（menu/overlay 例外）、动画 |
| 主题 | `ThemeProvider` + `uiStore.theme` | light / dark / system + `class` darkMode |
| 工具 | `src/lib/utils.ts` `cn` | 已登记自定义 font-size，避免与 text color 冲突 |
| 原语 | `src/components/ui/*` | Button、Badge、Input、Textarea、Modal、Dropdown、Tabs… |
| cva | Button、Badge | 仅此两处系统性使用 variants |

### 4.2 已知缺口

| 缺口 | 证据 / 影响 |
|------|-------------|
| 无 `--on-accent` | primary 用 `text-white`；dark 下浅 accent + 白字对比偏弱 |
| glass 未进 Tailwind | TitleBar：`bg-[var(--glass-bg)]` |
| panel 阴影未令牌化 | AppLayout 右栏：`shadow-[0_2px_12px…] dark:shadow-[…]` |
| `role.worker` 未映射 | token 有 `--role-worker`，tailwind `role` 缺 worker |
| Button 字号漂移 | `size.md/lg` 使用 `text-sm` / `text-base` |
| 手写 primary | 如 `AgentToolbar`、`FileTree` 等复制 accent 按钮样式 |
| Prose 内联 | `MessageBubble` 大段 `[&_pre]` / `[&_ul]` |
| 变量名漂移 | `DagEditor.css` 使用 `--surface`、`--ink-secondary` 等非真实名 |
| 业务 `text-sm` | Login 等仍用默认阶梯 |

### 4.3 布局冻结范围（明确「不许动」）

| 冻结项 | 说明 |
|--------|------|
| `AppLayout` 结构 | TitleBar 全宽 + 水平 `PanelGroup`：主列 / resize handle / 右列 |
| 主列内容切换 | history / settings / NewConversation / ChatPane+InputBar |
| 右列形态 | 浮动卡片（rounded + border + 阴影）；code / chat 面板内容槽位 |
| TitleBar 分区 | 红绿灯 inset + tabs 或 back/title + 右侧状态 |
| 不引入 | 持久左侧 icon rail 产品化、底部 dock、多行工具栏重组 |

允许的微调：**同一结构内** ±2–4px 间距、颜色/阴影/字号、focus 环；**不允许**改 panel 默认比例语义、拖走 Composer 位置、合并/拆分主列信息架构。

---

## 5. 目标架构

```
src/styles/tokens.css          ← 唯一：色、玻璃、阴影档、on-accent、state、布局尺寸
tailwind.config.js             ← 映射为语义 utility；字号/圆角/动画
src/lib/utils.ts               ← cn + 自定义 class group 登记
src/components/ui/*            ← 交互原语（cva variants）；业务优先消费
src/components/**              ← 业务组合：只写布局与语义类名
src/components/**/**.css       ← 仅第三方库覆盖；变量对齐 token
```

### 5.1 阴影三档（写死）

| Token / class | 用途 |
|---------------|------|
| `shadow-none`（默认几乎全部 chrome） | 标题栏、列表、消息、设置页、输入 chrome |
| `shadow-panel` ← `--shadow-panel` | 右侧 Artifact/Preview 浮动卡片（及未来同级浮层卡片） |
| `shadow-menu` / `shadow-overlay` | 下拉菜单 / Modal（已有，保持） |

禁止在业务中新增第四档任意 shadow。Switch 旋钮等控件级微阴影：可保留在组件内，或收敛为 `--shadow-knob`（可选，Phase 1 可不做）。

### 5.2 新增 / 补齐令牌

| Token | Light（示意） | Dark（示意） | Tailwind |
|-------|---------------|--------------|----------|
| `--on-accent` | `#ffffff` | `#111111`（或近黑，需实测对比） | `text-on-accent` / `fill-on-accent` |
| `--shadow-panel` | 现 AppLayout light 阴影等价 | 现 AppLayout dark 阴影等价 | `shadow-panel` |
| glass | 已有 `--glass-bg` / `--glass-border` | 已有 | `bg-glass`、`border-glass`（颜色映射） |
| `--role-worker` | 已有 | 已有 | `role.worker` 补映射 |

可选（Phase 1 可不实现，列入 Phase 3 评估）：

- 语义 radius：`--radius-panel: 12px` → 与 `rounded-xl` 对齐的文档说明即可，不必强加 CSS 变量。
- focus 文档化：表单 `ring-accent/8` + `border-accent`；按钮 `ring-focus-ring/60`（与现实现一致）。

### 5.3 交互状态约定

| 场景 | 类名约定 |
|------|----------|
| 列表行 / 图标按钮 hover | `hover:bg-state-hover` 或现有 `hover:bg-accent-subtle`（二者 token 等价时统一命名，见 §8） |
| 选中行 / 激活 | `bg-state-active` / `bg-accent-active` |
| 表单 focus | 与 `Input` 一致：`border-accent` + `ring-[3px] ring-accent/8` |
| 按钮 focus | 与 `Button` 一致：`ring-2 ring-focus-ring/60` |
| disabled | `opacity-50` + `pointer-events-none` 或 `text-state-disabled` |

实现时二选一并写进 tokens 注释：要么全面改用 `state-*`，要么文档写明 `accent-subtle` ≡ hover 底。**禁止**同页混用三种 hover 灰。

### 5.4 原语升级点

| 原语 | 要求 |
|------|------|
| `Button` | `primary`/`danger` 文字改 `text-on-accent`；size 字号改 token；**导出** `buttonVariants` 供需要原生 button 样式的场景 |
| `Input` / `Textarea` | 保持；Composer 用的无边框样式可增加 variant `plain` **或** 继续 `className` 覆盖（二选一，优先小 diff） |
| `Badge` | 已有 cva；无需扩张 variant 除非业务重复 3+ 次 |
| Markdown | 新增 `MarkdownBody` 组件 **或** `@layer components { .prose-hip {…} }`；MessageBubble / Skill 预览共用 |
| 不强制新增 | `IconButton`、`Chip` 独立文件——若 Phase 2 出现 3+ 重复再抽 |

### 5.5 字号规则

| 角色 | Token class | 典型用途 |
|------|-------------|----------|
| caption | `text-caption` | 时间戳、usage、辅助标注 |
| meta | `text-meta` | Tab 副文案、chip、表头元信息 |
| body | `text-body` | 默认 chrome、按钮、表单 |
| prose | `text-prose` | 消息正文、Markdown |
| title | `text-title` | Modal 标题、设置分区标题 |
| display / stat | `text-display` / `text-stat` | 空状态大数字、问候语（克制使用） |

**规则**：`src/components/**` 业务 UI 禁止新增 `text-sm` / `text-xs` / `text-base` / `text-lg`（登录页、Button 存量在 Phase 1–2 清掉）。第三方或测试 fixture 除外。

---

## 6. 分阶段交付

### Phase 1 — 令牌补全与对比修正（优先合并）

**范围**

1. `tokens.css`：增加 `--on-accent`、`--shadow-panel`（light/dark）；必要时为 glass 保持现状变量。
2. `tailwind.config.js`：
   - `colors.on.accent` 或 `colors['on-accent']`（实现时选与现有命名一致的一种）
   - `boxShadow.panel`
   - `colors` 增加 glass 映射（`glass` / `glass-border` 或 `backgroundColor`/`borderColor` 扩展）
   - `role.worker`
3. `Button`：`text-on-accent`；size 改 `text-body` 等 token。
4. `AppLayout`：右栏卡片改 `shadow-panel`（去掉双套任意 shadow）。
5. `TitleBar`：`bg-glass`（或等价语义类），去掉 `bg-[var(--glass-bg)]`。
6. `DagEditor.css`：变量改为 `--bg-app` / `--text-secondary` 等真实名，**或** 在 tokens 增加一层兼容别名：
   - `--surface` → `var(--bg-app)`
   - `--ink-secondary` → `var(--text-secondary)`
   - 兼容别名优先于改第三方大文件（更小风险）。
7. 扫描并替换**明确**的 `text-white` on accent 填充（Button、已知 primary 入口）；不强制一次清完所有 `text-white`。

**验收**

- [ ] 布局：AppLayout 结构与右栏形态不变（人工 / 截图对照）。
- [ ] Light/Dark：primary 按钮文字对比可接受；dark 下不再「发飘白字」。
- [ ] `rg 'shadow-\[0_2px_12px' src` → 无 AppLayout 残留。
- [ ] `yarn tsc` / 相关单测绿。

**风险**：低。视觉接近无感。

---

### Phase 2 — 原语收敛与 Prose 单一真相

**范围**

1. 导出 `buttonVariants`；替换手写 accent 按钮（至少：`AgentToolbar`、`FileTree` 空状态 CTA、`AuthButton` 评估是否并入 Button）。
2. Markdown：抽取 `MarkdownBody` 或 `.prose-hip`；`MessageBubble`、Skill 预览类路径接入。
3. hover/focus 约定：选一种命名（`state-*` 或 `accent-subtle`）并在 `tokens.css` 顶部注释写清；高频 shell（TitleBar、SessionTab、PanelToggle）对齐。
4. Login / 残留 `text-sm` 改为 token 字号。
5. （可选）`Composer` focus ring 与 Input 令牌一致（已接近则只去重复魔法数字）。

**验收**

- [ ] 主路径 Chat + Settings：同级按钮高度/hover/focus 一致。
- [ ] Markdown 样式修改只改一处即两侧生效。
- [ ] 新增业务 PR 检查清单：不新增手写 primary 三件套。
- [ ] 测试绿；无布局结构 diff。

**风险**：中低。注意 `buttonVariants` 与现有 `className` 覆盖兼容。

---

### Phase 3 — 质感扫尾与门禁（可选）

**范围**

1. 全库业务 `text-sm`/`text-xs` 扫尾（白名单：无）。
2. 间距微调仅限 ±2–4px 级、同一组件内，不改信息架构。
3. 硬编码门禁（CI 或文档约定脚本）：
   ```text
   # 示例：实现时定白名单
   rg -n 'shadow-\[|bg-\[var\(--|#[0-9a-fA-F]{6}' src/components --glob '!**/terminalTheme.ts'
   ```
   允许例外：`terminalTheme` ANSI、测试 mock、不可替代的 one-off。
4. 评估 Chip/Pill 是否值得抽组件（附件 chip × N）；不值得则不抽。
5. 更新本 spec 状态 → **已实现**；如有 plan 文件交叉链接。

**验收**

- [ ] 硬编码扫描结果可解释（白名单短）。
- [ ] 亮暗主题人工走查：New Conversation、进行中会话、Code 右栏、Settings、History、Modal、Command Palette。

**风险**：低；易 scope creep——**禁止**借机重排设置页 IA。

---

## 7. 任务拆分（实现用）

| # | 任务 | Phase | 风险 |
|---|------|-------|------|
| V.a | tokens：`--on-accent`、`--shadow-panel` + dark | 1 | 低 |
| V.b | tailwind 映射：on-accent、panel、glass、role.worker | 1 | 低 |
| V.c | Button + 导出 variants；AppLayout/TitleBar 消费新 token | 1 | 低 |
| V.d | DagEditor 变量对齐或兼容别名 | 1 | 低 |
| V.e | 手写 primary → Button | 2 | 中 |
| V.f | MarkdownBody / prose-hip | 2 | 中 |
| V.g | shell hover 统一 + Login 字号 | 2 | 低 |
| V.h | 扫尾 + 可选 CI rg 门禁 | 3 | 低 |

**禁止**同 PR：Phase 1 令牌 + 全库按钮替换 + Markdown 抽取 + 间距大改。按 phase 分 commit / 分 PR。

---

## 8. 实现注意事项

### 8.1 on-accent 实测

Dark 下 `--accent` 为浅 sage（约 `#a8b89a`）。`--on-accent` 取近黑前需在真实 Button 上确认对比 ≥ 现网可接受；若近黑仍差，可微调 dark `--accent` 填充（**优先改 on-accent 或略调 accent，不改布局**）。

### 8.2 tailwind-merge

新增语义 class 后，若出现 size/color 冲突，在 `utils.ts` `extendTailwindMerge` 登记（与现有 font-size 处理同模式）。

### 8.3 测试

- 优先修因 class 字符串断言失败的测试；不为此删除行为断言。
- 视觉无强制截图测试；以 token 存在性 + 组件测 + 人工亮暗对照为准。
- 不引入付费 LLM 测试。

### 8.4 i18n / a11y

- 不改文案 key 语义。
- 保留 `focus-visible` 环；不把 focus 仅做成 `outline-none` 无替代。

### 8.5 与「frontend-design」激进审美的边界

本项目是 **桌面 AI 工作台**。本 spec **拒绝**为「辨识度」引入：奶油底+衬线、酸绿黑底、报纸网格等模板化大胆皮肤。辨识度继续来自 **Sage + 扁平 chrome + 已有 hip 布局**，升级只做一致性与暗色可读。

---

## 9. 验收总表

| 项 | 标准 |
|----|------|
| 布局 | TitleBar / 主列 / 右栏结构与冻结表一致 |
| 品牌 | 仍为单色 chrome + Sage；无第二主题 |
| Token | 新色/阴影/on-accent 只改 `tokens.css`（+ tailwind 映射）即可全局生效 |
| Primary | Light/Dark 填充按钮文字均可读 |
| 代码 | 新代码无业务硬编码 hex / 任意 shadow；Phase 3 存量可解释 |
| 回归 | `yarn tsc`；相关 `yarn test` 绿 |
| 文档 | 本 spec 状态随 phase 更新；完成后标 **已实现** |

---

## 10. 建议验收口令（给执行 agent）

```text
Phase 1:
  - tokens 含 --on-accent --shadow-panel；tailwind 有 shadow-panel / role.worker / glass 映射
  - AppLayout 无 shadow-[0_2px…]; TitleBar 无 bg-[var(--glass-bg)]
  - Button primary 使用 on-accent；yarn tsc + 相关 test 绿
  - 人工：亮暗 primary 对比 OK；布局无结构变化

Phase 2:
  - 无 AgentToolbar/FileTree 手写 bg-accent text-white 三件套（或仅剩有注释的例外）
  - Markdown 样式单一入口；MessageBubble 无大段 [&_pre] 重复定义
  - 业务新增 text-sm 为 0（Login 已改）

Phase 3:
  - rg 硬编码结果有白名单说明
  - 走查清单勾完
```

---

## 11. 开放问题（实现前可定，默认可用括号内默认）

| # | 问题 | 默认 |
|---|------|------|
| Q1 | glass 映射命名：`bg-glass` vs `bg-surface/80`？ | **独立 `bg-glass`**，保留毛玻璃语义 |
| Q2 | hover 统一到 `state-hover` 还是保留 `accent-subtle`？ | Phase 1 **不动业务 hover**；Phase 2 文档等价，新代码用 `state-hover` |
| Q3 | Markdown 用组件还是 `@layer components`？ | **组件 `MarkdownBody`**（易测、易传 `className`）；内部可挂 `.prose-hip` |
| Q4 | DagEditor 改引用还是加别名？ | **tokens 兼容别名**，最小 diff |
| Q5 | Phase 3 CI 门禁是否上？ | 默认 **文档约定 + 手工 rg**；CI 可选 |

---

## 12. 跟踪方式

1. 实施清单：[`../plans/2026-07-11-visual-design-style-architecture.md`](../plans/2026-07-11-visual-design-style-architecture.md)（按 checkbox 推进）。
2. 每 phase 结束：本 spec 状态更新（`待实现` → `Phase 1 已实现` → … → `已实现`）；同步勾选 plan。
3. Commit：按 `AGENTS.md` 分 phase commit，勿与产品功能捆绑。
4. 不要求写入 pre-public polish 索引，除非产品明确把本项纳入公开前必做包。

---

## 附录 A — 主要触碰文件（预期）

| 文件 | Phase |
|------|-------|
| `src/styles/tokens.css` | 1 |
| `tailwind.config.js` | 1 |
| `src/components/ui/Button.tsx` | 1–2 |
| `src/routes/AppLayout.tsx` | 1 |
| `src/components/layout/TitleBar.tsx` | 1 |
| `src/components/workflow/DagEditor.css` | 1（或仅 tokens 别名） |
| `src/components/chat/MessageBubble.tsx` | 2 |
| `src/components/chat/MarkdownBody.tsx`（新建）或 tokens/components 层 | 2 |
| `src/components/account/AgentToolbar.tsx` 等手写 primary | 2 |
| `src/routes/LoginScreen.tsx` / `AuthButton.tsx` | 2 |
| `src/lib/utils.ts` | 仅当 merge 冲突需要 |

## 附录 B — 明确不在范围的文件类型

- `packages/sidecar/**`、协议层
- e2e 产品流（除非 class 选择器断言被破坏才最小修复）
- `public/gif/**`、品牌 logo 重绘（除非 on-accent 相关的小幅 SVG 适配——默认不做）
