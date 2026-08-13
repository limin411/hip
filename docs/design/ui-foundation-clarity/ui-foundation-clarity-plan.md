# hip 基础视觉整改(层次 / 对比 / 焦点 / 动效语义) — 执行计划

- 系列:`docs/design/ui-foundation-clarity/`
- 配套:`ui-foundation-clarity-spec.md`(规格,含 token 级新值与验收标准);`ui-foundation-clarity-preview.html`(现状/提案对照 + 交互原型 + 实时对比度读数)
- 状态:待评审
- 日期:2026-08-13
- 前置基线:`DESIGN.md`(Flat Solid / 纯 fade / 中性灰阶)、`docs/design/ui-enhancement-bui/`(进程可视化语言,本系列不重复其内容)、`scripts/check-visual-dialects.mjs`(视觉方言门禁)

---

## 0. 问题来源

2026-08-13 全量 UI 体检(代码审计 + 运行态 DOM 实测,1280×720,亮/暗双主题)得出 12 项问题。本系列只承接**基础层**(token / 焦点 / 动效语义 / 布局),进程可视化相关的工具行 chip 化、±N 色差等继续归 `ui-enhancement-bui` 系列。

实测关键数据(详表见 spec §2):

| 指标 | 实测 | 结论 |
|---|---|---|
| hover 底 vs 所在面 | **1.05–1.14:1** | hover 几乎不可见 |
| 选中底 vs 所在面 | ~1.2:1 | 选中态与普通行区分微弱 |
| 暗色表面阶差(subtle/content vs app) | **1.04–1.06:1** | 分层不成立 |
| 暗色边框 vs 底色 | 1.52:1 | 分层只剩弱边框 |
| tertiary 文字 on bg-subtle / bg-muted | **4.23 / 4.08:1** | 11–12px 小字不达 AA |
| 文本输入焦点 | 无 ring(仅 outline-none) | 键盘焦点不可见 |
| 品牌橙出现率 | 仅焦点/状态点/下划线 | 产品无识别度 |

## 1. 总体策略

1. **只改 token 与少数字段组件,不改信息架构**:本轮不动页面结构、不动文案、不动功能;布局修整仅 3 处(侧栏默认宽、设置页最大宽、微命中区)。
2. **遵守既有纪律**:不引入阴影/渐变/位移/缩放;焦点环沿用中性灰(与 `check-visual-dialects` 的 ring-accent 禁令一致),仅补齐"输入域无焦点指示"缺口。
3. **对比度目标是规则不是色值**:hover 面 vs 所在面 ≥ 1.2:1;选中面 vs hover 面 ≥ 1.1:1;11–13px 文字 vs 任意所在面 ≥ 4.5:1。spec 给出的 hex 是满足规则的裁决值,改值必须重跑 spec §2 的对比度表。
4. **品牌橙只增加一处语义**:新增 `brand` 按钮变体(accent 实底),每屏至多 1 个 brand CTA(Composer 发送、空状态主 CTA);其余 36 处 `primary`(软黑)不动,避免橙噪音。
5. **每 PR 独立提交**,门禁 `yarn tsc` + `yarn test` + `yarn check:visual-dialects` 全绿;`DESIGN.md` 在最后一个 PR 同步。

## 2. PR 依赖图

```
PR-1 令牌整改(亮/暗 hover·选中·tertiary·暗色表面)   ← 独立,风险最高
PR-2 焦点环补齐 + focus 语言统一                   ← 独立
PR-3 品牌 CTA(brand 变体 + 3 处调用点)            ← 依赖 PR-1(暗色 on-accent 可读)
PR-4 右栏抽屉开合动画(宽度过渡,动效例外③)          ← 独立
PR-5 动效分层 + 主题切换原子化                     ← 独立
PR-6 布局修整(侧栏宽 / 设置 max-w / 微命中区)       ← 独立
PR-7 清理项 + DESIGN.md 同步                      ← 依赖 PR-1..6
```

可并行:PR-2 ∥ PR-4 ∥ PR-5 ∥ PR-6;PR-1 先行(它改变全部面的观感,后续 PR 的验收截图应基于新 token);PR-3 在 PR-1 后;PR-7 收尾。

## 3. PR 明细

### PR-1 令牌整改(亮/暗 hover·选中·tertiary·暗色表面)(0.5–1 天)

**文件**:`src/styles/tokens.css`(权威)、`tailwind.config.js`(仅同步 --x-rgb 三通道,值已在 tokens 中)

**任务**(具体值见 spec §3–§6):
1. 亮色:`--accent-subtle #f0f0f0 → #dfdfdf`;`--accent-active #e6e6e6 → #d3d3d3`;`--text-tertiary #757575 → #6a6a6a`;`--tbl-row-hover 0.045 → 0.07`。
2. 暗色:`--bg-app/subtle/content/muted` 拉开为 `#101010/#1c1c1c/#161616/#262626`(修复"主列比侧栏还暗"的层级反向);`--border/--border-strong → #3a3a3a/#4d4d4d`;`--accent-subtle/--accent-active → #2f2f2f/#3d3d3d`。
3. RGB 三通道同步(所有 `--*-rgb` 与 hex 一致,`state-hover-rgb` 派生自 `accent-subtle-rgb` 已自动跟随)。

**测试**:新增 `tokens` 快照单测(读 tokens.css 解析 hex,断言 spec §3–§6 的对比度规则)——放 `src/styles/tokens.test.ts`(纯函数计算 WCAG 对比度,不渲染 DOM)。

**验收**:spec §2 对比度表全部达标;亮/暗各截图 3 张(侧栏 hover、消息列表、设置页)目检无"糊成一片"。

### PR-2 焦点环补齐 + focus 语言统一(0.5 天)

**文件**:`src/components/ui/focusClasses.ts`、`src/components/ui/Textarea.tsx`、`src/components/ui/Input.tsx`、`src/components/chat/Composer.tsx`(去 `focus-visible:ring-0`)

**任务**(spec §7):
1. `focusField`:`focus-visible:outline-none` → `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25`(中性灰,与 `focusChrome` 同族,不触犯 ring-accent 门禁)。
2. Composer textarea 的 `focus-visible:ring-0` 删除,继承 ring;卡片保留 `focus-within:border-border-strong`(双重指示)。
3. 全仓排查自定义 `focus-visible:outline-none` 裸用(输入域类),统一走 `focusField`/`focusChrome`。

**测试**:`Tab` 走查清单(设置页 3 个输入、Composer、命令面板)——ring 可见且为灰;`check:visual-dialects` 保持 OK。

**验收**:键盘 Tab 焦点在任意输入域可见;无新增橙色焦点噪音。

### PR-3 品牌 CTA(0.5 天)

**文件**:`src/components/ui/Button.tsx`、`src/components/chat/Composer.tsx`、`src/components/chat/FirstRunSetupCard.tsx`、`src/components/chat/NewConversation.tsx`(空状态主 CTA 如有)

**任务**(spec §8):
1. `Button` 新增 `brand` 变体:`bg-accent text-on-accent hover:bg-accent-hover`(亮暗自动可读:暗色 accent #ffb300 + 近黑字)。
2. 调用点替换(仅 3 处):Composer 发送按钮、FirstRunSetupCard"打开模型设置"、EmptyState `friendly` 主按钮(若无则跳过)。
3. 文档规则落地:每屏至多 1 个 brand CTA;danger 确认流保持 danger 实底。

**测试**:按钮快照测试补 `brand`;e2e 选择器不变(`data-testid` 不动)。

**验收**:空状态与 Composer 发送按钮为品牌橙实底;设置页/模态内无橙实底噪音;暗色下文字对比达标。

### PR-4 右栏抽屉开合动画(动效例外③)(0.5–1 天)

**文件**:`src/routes/AppLayout.tsx`、`src/styles/tokens.css`(新增 `--duration-panel 220ms`)、全局 CSS 的 `[data-panel]` 过渡

**任务**(spec §9):
1. react-resizable-panels v2 面板加 CSS 宽度过渡(`transition: flex-basis var(--duration-panel)`);`collapsedSize` 保持 0。
2. 打开:内容先挂载,面板宽度 0→目标 220ms;关闭:先收起宽度,动画结束后再卸载内容(状态机:`panelClosing` 标志 + `onTransitionEnd` 兜底 220ms 定时器)。
3. `widenWindowForRightPanel` 的窗口加宽保留,但与面板过渡解耦(窗口先变宽,面板再展开,避免挤压主列)。

**测试**:组件测试:open→展开类出现→220ms 后内容挂载;close→220ms 后卸载。reduced-motion 下直切(全局兜底已覆盖 transition,需确认 flex-basis 过渡被 0.01ms 规则压掉)。

**验收**:右栏开合为平滑宽度过渡,无"闪出/闪没";拖拽手柄在动画期间禁用。

### PR-5 动效分层 + 主题切换原子化(0.5 天)

**文件**:`src/styles/tokens.css`、`tailwind.config.js`(animation 时长)、`src/components/theme/ThemeProvider.tsx`、`src/components/ui/motionClasses.ts`(仅注释)

**任务**(spec §10):
1. 时长分层:`menu-in/out` 110/90ms;`modal-in/out` 160/120ms;`view-enter` 200ms;`panel-in` 200ms;`message-enter` 240ms(流式例外保留)。
2. 主题切换原子化:ThemeProvider 切换 `.dark` 时先给 `<html>` 加 `data-theme-switching`,全局强制 `transition: background-color .12s, color .12s, border-color .12s !important`,150ms 后移除——所有表面同步渐变,消除"半亮半暗"中间态。

**测试**:单测:theme toggle 后 150ms 内 `data-theme-switching` 存在且随后移除;视觉:手动快切主题截图对比。

**验收**:主题切换无混合中间帧;菜单/模态/视图切换节奏可感知差异。

### PR-6 布局修整(0.5 天)

**文件**:`src/components/layout/sidebarWidth.ts`、`src/components/account/SettingsPanel.tsx`(或 SettingsPage 容器)、`src/components/layout/ConnectionStatus.tsx`、`src/components/layout/AppSidebar.tsx`(新建按钮)、`DESIGN.md` §4

**任务**(spec §11):
1. `SIDEBAR_WIDTH_DEFAULT 300 → 280`(T 裁决:文档 264 与代码 300 折中;6 个导航项中文标签 + 知识库树受益)。
2. 设置页内容加 `max-w-[880px] mx-auto`(行不再在宽屏拉满)。
3. 微命中区:侧栏"新建对话/新建任务"等文字按钮 `min-h-6`;ConnectionStatus 重试链接 `px-0.5 py-0.5` 扩命中。
4. DESIGN.md §4.1/§4.2 同步侧栏宽度。

**测试**:e2e 快照若断言侧栏宽度(如 300),同步更新。

**验收**:1280 宽窗口下侧栏 280;设置页在 1600 宽窗口行宽 ≤880;微按钮命中区 ≥24px。

### PR-7 清理项 + DESIGN.md 同步(0.5 天)

**文件**:`src/components/ui/Switch.tsx`、`tailwind.config.js`、`src/components/chat/ChatPane.tsx`(类名)、`DESIGN.md`

**任务**(spec §12):
1. `Switch` 移除 `active:scale-90`(违禁缩放)。
2. `msg-enter-left/right` keyframes 弃用:`ChatPane` 改用 `animate-message-enter`,保留 keyframes 一个版本(注释 deprecated)。
3. Composer danger:空闲态改为静态 `border-danger-soft`(移除无限呼吸 glow),仅运行中保留 `danger-flow`。
4. DESIGN.md 全量同步:色彩表(§2)、圆角(§5)、动效(§6,新增例外③ 面板宽度过渡)、关键组件表(§7,Button 增 brand / 焦点环描述更正)、布局(§4,侧栏 280、设置 max-w)。

**测试**:全量 `yarn test` + `yarn check:visual-dialects` + `yarn tsc`。

**验收**:DESIGN.md 与 tokens.css/tailwind.config.js 无矛盾项(§2 色表逐行核对)。

## 4. 门禁与回归

| 门禁 | 命令 |
|---|---|
| 类型/构建 | `yarn tsc` |
| 单测(含新增 tokens 对比度测试) | `yarn test` |
| 视觉方言 | `yarn check:visual-dialects` |
| 手动走查 | spec 附录 A 走查清单(亮/暗 × 侧栏/消息/设置/右栏/主题切换) |

风险提示:PR-1 改变全局观感,合入后需在真实项目会话(侧栏 50+ 会话、工具行密集的消息)各截 1 张图留档;若"中性灰更重"与 DESIGN.md "安静"气质冲突,回退方案是只加深到 #e8e8e8(≈1.18:1)并在行 hover 同时加深文字色。
