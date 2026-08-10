# DESIGN.md — hip 视觉风格设计

> 本文档描述 hip **当前**的视觉风格（现代扁平化 / Flat Solid UI）。
> 设计令牌的权威来源：`src/styles/tokens.css` 与 `tailwind.config.js`，本文档与之保持同步；若不一致，以代码为准。

## 1. 设计原则

1. **固体优先 Solid over Glass** —— 所有表面 100% 不透明；层级由明度阶差 + 1px 边框表达，禁止 `backdrop-filter`。原生 vibrancy（macOS sidebar / Win Mica / Acrylic）已全部拆除。
2. **边界优先 Border over Shadow** —— 浮层（下拉 / Modal / 面板）用实色 + 1px 边框 + scrim 分层；阴影只保留 Modal 一档极轻投影（`shadow-overlay`），其余全部 `none`。
3. **色块优先 Color over Gradient** —— 状态用纯色实底 chip / 色条 / 圆点，禁止渐变、glow、shimmer。effort-max 为纯色。
4. **直角优先 Sharp over Round** —— 按钮/输入框 2px、卡片 4px、浮层 6px；胶囊（`rounded-full`）仅保留给 avatar / 状态点 / 开关拇指。
5. **克制动画 Fade-only Motion** —— 只允许 `opacity`（与 `background-color` 过渡）入场；无位移、无缩放、无弹性、无循环动画。时长 ≤ 200ms。
6. **明度阶差 Hierarchy via Value** —— 层级由灰阶阶差 + 字重（400/500/600）支撑，不靠阴影。

整体气质：安静、稳定、工具化 —— 像专业开发工具（Linear / Vercel / GitHub Desktop），而非消费级 App。

## 2. 色彩系统

品牌强调色为**暖橙**，是唯一强调色；chrome 为无冷暖偏的中性灰阶。

### 2.1 亮色（默认）

| Token | 值 | 用途 |
|---|---|---|
| `--bg-app` | `#ffffff` | 窗口底色 |
| `--bg-subtle` | `#fafafa` | 侧栏等 chrome 面 |
| `--bg-muted` | `#f1f1f1` | 再退一阶的面 |
| `--bg-content` | `#ffffff` | 主内容列 |
| `--border` | `#e0e0e0` | 默认 1px 边框（轻而清晰） |
| `--border-strong` | `#c9c9c9` | 输入框 / 卡片外框 |
| `--text-primary` | `#111111` | 正文 |
| `--text-secondary` | `#5e5e5e` | 次级文字 |
| `--text-tertiary` | `#757575` | 时间戳 / 占位符 / 元数据（AA ≈4.4:1） |
| `--accent` | `#c2410c` | 品牌填充（按钮底、激活条、focus ring） |
| `--accent-hover` | `#9a3412` | 强调色 hover |
| `--accent-strong` | `#7c2d12` | 更深橙，正文/图标强调 |
| `--accent-subtle` | `#f0f0f0` | hover / 头像 / chip 底（**中性灰**，不带品牌色调） |
| `--accent-active` | `#e6e6e6` | 选中底（比 hover 深一档区分） |
| `--on-accent` | `#ffffff` | 强调底上的文字/图标 |
| `--btn-primary` | `#3a3a3a` | 主按钮实底（软单色，非纯黑） |
| `--btn-primary-hover` | `#2e2e2e` | 主按钮 hover |
| `--on-btn-primary` | `#fafafa` | 主按钮文字 |

**功能状态色**（保留语义）：

| Token | 值 | 用途 |
|---|---|---|
| `--success` | `#2f7d40` | 成功（AA on bg-app） |
| `--danger` | `#c63b3b` | 危险（AA on bg-app） |
| `--warning` | `#9a5d10` | 警告（替代硬编码 amber-600） |
| `--effort-max` | `#7c3aed` | 推理 effort 最高档（纯色紫，无发光） |

**智能体角色色**（功能性指示，实色块呈现）：

| 角色 | 亮色 | 暗色 |
|---|---|---|
| supervisor | `#5b5bd6` | `#7c7cf0` |
| planner | `#1a8cd8` | `#4db8ff` |
| coder | `#3d9a50` | `#5dc96c` |
| reviewer | `#c77a1a` | `#ffab40` |
| worker | `#0d8a8a` | `#2ee6e6` |

### 2.2 暗色（`.dark`）

- 底色压低：`--bg-app #121212` / `--bg-subtle #181818` / `--bg-muted #1f1f1f`；边框 `#2e2e2e / #3e3e3e`。
- 文字：`#f0f0f0 / #a3a3a3 / #7a7a7a`（tertiary 仍满足暗底可读）。
- 品牌：`--accent #ffb300`（更亮，贴 logo `#FF9800`，保证暗底可识别）、`--accent-strong #ffcc80`、`--on-accent #111111`。
- 交互底（对齐亮色，**中性灰、无品牌 tint**）：`--accent-subtle #222222`（hover）/ `--accent-active #2e2e2e`（选中，比 hover 深一档）；侧栏 active = `bg-state-active`。
- 状态色提亮：success `#4caf50`、danger `#ff5252`、warning `#ffb74d`、effort-max `#a78bfa`。
- 主按钮反转：`--btn-primary #d4d4d4`（软白底）+ `--on-btn-primary #141414`。
- 遮罩加重：`--overlay-scrim rgba(0,0,0,.48)`。

### 2.3 主题切换

- 三态：`system / light / dark`（`ThemeProvider.tsx` 在 `<html>` 上切换 `.dark` class）。
- `color-scheme` 随主题同步，影响原生表单控件与滚动条。
- 窗口失焦时通过 `data-window-focus` 静默 chrome（原生桌面感）。

## 3. 排版

- 系统字体栈（`system-ui` → PingFang SC / Hiragino / Microsoft YaHei / Noto Sans CJK），**不引入网络字体**。
- 默认字号 **13px**、行高 1.7、`-webkit-font-smoothing: antialiased`；Windows 改回 ClearType 子像素渲染。
- 等宽字体栈：`ui-monospace / SF Mono / JetBrains Mono / Consolas …`（代码、日志）。
- 链接：深色文字 + 下划线（不用蓝紫），仅 markdown 内容链接。

### 字阶（每级自带行高）

| 级别 | 字号 | 行高 | 用途 |
|---|---|---|---|
| `caption` | 11px | 1.4 | 最小辅助信息 |
| `meta` | 12px | 1.45 | 时间戳 / 元数据 |
| `body` | 13px | 1.5 | 默认正文 / 列表行 |
| `prose` | 14px | 1.7 | 阅读文本（markdown） |
| `title` | 16px | 1.4 | 标题 / 卡片标题 |
| `display` | 20px | 1.3 | 页面大标题 |
| `stat` | 24px | 1.2 | 统计数字 |
| `page` | 28px | 1.25，`-0.02em` | 仅文档页 H1（Knowledge 等） |

层级强化靠字重（400/500/600），不靠字号堆叠。

## 4. 布局与空间

### 4.1 窗口结构

```
┌─────────────────────────────┬──────────────────────────────────────────┐
│ AppSidebar（264px 可拖宽）    │ 主列（flex-1）                             │
│ ┌ titlebar 40px ───────────┐ │ ┌ MainToolbar 40px ────────────────────┐ │
│ │ 红绿灯 inset 90px · 折叠   │ │ │ 会话标题 · [⌘] · [●已连接] · [面板]    │ │
│ │ 后退 · 前进               │ │ └──────────────────────────────────────┘ │
│ ├──────────────────────────┤ │ ┌ 主内容（flex-1）                       │ │
│ │ HIP 版本号（顶部）          │ │ │ ├ 空会话 → NewConversation 空状态     │ │
│ │ nav：会话/项目/知识库/       │ │ │ ├ 会话 → GoalStatusChip + ChatPane   │ │
│ │       终端/任务/自动化      │ │ │ │   transcript（居中阅读列）           │ │
│ │ 列表：组头 + 日期分组 → 行    │ │ │ └ InputBar（Composer 圆角卡片）       │ │
│ │ footer：回收站/历史/设置     │ │ └──────────────────────────────────────┘ │
│ └──────────────────────────┘ │ ┌ 右栏抽屉 26% 可拖（条件显示）          │ │
└─────────────────────────────┴───│ Artifact / Preview / Outline / …    │ │
                                   └──────────────────────────────────────┘ │
```

- 侧栏 titlebar 与 MainToolbar 是**两条并列** 40px 行；macOS 时 `--titlebar-height: 48px`（内容中线对齐红绿灯 y=26）。
- 红绿灯让位 `--titlebar-lights-inset: 90px`（macOS）；Win/Linux 为 0。
- 侧栏导航 active 态 = `bg-state-active` 中性灰底，**无 accent 左条**（`sidebarActiveRail.ts`）。
- 侧栏宽度 264px 可拖宽；右栏抽屉 26% 可拖宽。
- 密集行高：`--row-h-sidebar 34px`；消息元信息行 20px；meta 间距 6px。

### 4.2 密度（data-density）

- `comfortable`（默认）：侧栏行 34px、会话行 `py-2`、worktree 行 `py-1`。
- `compact`：侧栏行 28px、会话行 `py-1`、worktree 行 `py-0.5`、meta 间距 4px。
- 消费端一律用 `var(--row-h-*)` / `var(--trail-min-h)` 等变量，不得硬编码。

## 5. 圆角与阴影

### 圆角（扁平化收敛）

| Utility | 值 |
|---|---|
| `rounded-sm` | **2px**（按钮、输入框） |
| `rounded / md / lg` | **4px**（卡片） |
| `rounded-xl / 2xl / 3xl` | **6px**（浮层：Modal、下拉、palette） |
| `rounded-full` | 仅 avatar / 状态点 / 开关拇指 |

### 阴影

| 档位 | 值 | 用途 |
|---|---|---|
| 默认档（sm…xl、pop、float、card-hover、sticky-top） | 全部 `none` | — |
| `shadow-panel` | `none` | 右栏浮动卡 —— 实底 + 1px 边框 |
| `shadow-menu` | `none` | 下拉 —— 实底 + 1px 边框 + scrim |
| `shadow-overlay` | `0 12px 32px -12px rgba(17,17,17,.12)` | **唯一**保留的投影（Modal），主体补 1px 边框 |

**浮层分层规则**：overlay scrim `rgba(17,17,17,.28)`（暗色 `.48`）；嵌套 confirm/task 用更轻的 `.12` / `.28`。

## 6. 动效

- 三档时长：`--duration-chrome 100ms`（按钮/行 hover）、`--duration-content 120ms`（内容进场）、`--duration-celebrate 200ms`（庆祝/欢迎语）。
- 缓动：`--ease-standard cubic-bezier(0.2, 0, 0, 1)`（linear 化 decelerate，无弹性）。
- 入场全部**纯 fade**：`message-enter`、`menu-in`、`modal-in`、`overlay-in`、`panel-in`、`view-enter`、`greeting-enter`。
- 保留的循环动画：`blink`（状态点）、`dot-bounce`（纯 opacity，打字指示器）。
- 交互反馈：hover 仅改底色（`hover:bg-state-hover`）；focus ring 2px 方形描边（`--focus-ring` = accent）；`transition-[background-color,color,border-color]`。
- 无障碍：`prefers-reduced-motion` 兜底 —— 全局动画/过渡压至 0.01ms、滚动切为 auto。

## 7. 关键组件样式

| 组件 | 样式 |
|---|---|
| `Button` | 主按钮 = 软单色实底（`--btn-primary`，**不用品牌橙填充**）；secondary = 浅底 + hover 灰；ghost = 纯文字；outline = 1px 边框；danger / dangerSoft。圆角 2px（`rounded-sm`）。禁用 `opacity-40` |
| `Input / Textarea` | 2px 圆角（`rounded-sm`）、`--border` 边框、聚焦 2px accent focus ring |
| `Switch / SegmentedControl` | 胶囊仅保留给开关拇指；分段控制为直角块 + 实底选中 |
| `Tabs` | 下划线指示（扁平经典形态） |
| `DropdownMenu / Popover` | 实底 + 1px 边框 + scrim；纯 fade 入场 |
| `Modal` | 唯一保留投影档 `shadow-overlay` + 1px 边框 + scrim；纯 fade |
| `MessageBubble` | 用户气泡：灰底（`bg-surface-muted`）4px 圆角（`rounded-lg`）；agent 消息无头像，元信息为文字行（"你 / hip"） |
| `Avatar` | 圆形/方形（方形 4px）；首字母回退底 = `--accent-subtle` 中性灰 + `--accent-strong` 文字；`gradient` 时用品牌橙实底 + 白字 |
| `Composer / InputBar` | 浮动圆角卡片（`rounded-lg` 4px）+ 1px 边框；底部 chip 行（agent / 模型 / effort / 权限 / 执行模式 / 附件）；发送按钮为方形 2px |
| `EffortIntensityMeter` | 5 根竖条强度表（非滑块）；MAX 档实底纯色紫 + 16% 底 + 2px 边框 chip，无发光 |
| 右栏 `PanelTabBar` | 紧凑下拉形态（当前标签 + chevron），非平铺 tab 条 |
| 滚动条 | 5px 细滚动条，thumb = `--border`，hover 加深 |

## 8. 平台差异

| 平台 | 差异 |
|---|---|
| macOS | 标题栏 48px、红绿灯让位 90px；无 vibrancy，恒为实色 |
| Windows / Linux | 标题栏 40px、无红绿灯让位；Windows 文字渲染用 ClearType |
| 全平台 | 无半透明材质（`data-vibrancy` 恒为 `solid`）；标题栏实色 |

## 9. 无障碍约定

- `--text-tertiary` 对比度承诺 AA（亮 `#757575` ≈4.4:1 / 暗 `#7a7a7a`）；所有灰阶色经过对比度核验。
- 状态不只靠颜色：danger/warning 文案 + 实色块并用。
- `prefers-reduced-motion` 全局兜底。
- 焦点可见：所有交互控件带 2px accent 方形 focus ring。

## 10. 相关文件

| 文件 | 内容 |
|---|---|
| `src/styles/tokens.css` | 全部颜色/间距/动效/滚动条 token（权威来源） |
| `tailwind.config.js` | 颜色映射、字阶、圆角、阴影、keyframes/animation |
| `src/components/theme/ThemeProvider.tsx` | 主题/密度/window-focus 数据集切换 |
| `src/components/ui/*` | 通用控件皮肤（Button / Input / Modal / Dropdown 等） |
| `src/components/layout/*` | 侧栏 / 工具栏 / 标题栏 chrome |
