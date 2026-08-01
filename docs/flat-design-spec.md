# Hip 扁平化视觉改造 Spec（Flat Design Redesign）

> 配套视觉预览：`docs/examples/flat-design-preview.html`（浏览器直接打开，支持 当前/扁平/对比 三态与明暗主题切换，窗口结构按真实代码绘制）。
> 目标读者：设计评审 + 前端实现。所有数值均以 `src/styles/tokens.css` / `tailwind.config.js` 现状为基线。
>
> **实施状态：P1–P6 已完成**（7 个 commit，`yarn tsc` 通过，全量测试与基线失败集合一致、无回归）。

## 1. 背景与目标

当前 hip 的视觉是「单色 chrome + 克制阴影 + 毛玻璃 + 弹性动画 + effort-max 全息紫」的混合风格，整体偏"消费级柔和感"。本次改造目标是把视觉整体迁移到现代扁平化（Flat / Solid UI）：

- **更工具化**：界面安静、稳定，像专业开发工具而不是消费 App；
- **更少的视觉噪声**：移除 blur / 渐变 / 发光 / 位移动画这些"动效装饰"；
- **层级靠结构与边框**，不靠阴影与透明度；
- **保留品牌**：暖橙 `--accent` 继续作为唯一强调色，产品识别度不丢。

## 2. 现状诊断

### 2.1 布局结构（真实，改稿必须对齐）

> 常见误解：不存在最左侧独立图标 rail；不存在底部账号/邮箱 footer。以下层级来自 `AppLayout.tsx`、`AppSidebar.tsx`、`MainToolbar.tsx`。

```
┌─────────────────────────────┬──────────────────────────────────────────┐
│ AppSidebar（264px 可拖宽）    │ 主列（flex-1）                             │
│ ┌ titlebar 行 40px ────────┐ │ ┌ MainToolbar 40px ────────────────────┐ │
│ │ 红绿灯 inset 90px · 折叠   │ │ │ 会话标题 · [⌘] · [●已连接] · [面板]    │ │
│ │ 后退 · 前进               │ │ └──────────────────────────────────────┘ │
│ ├──────────────────────────┤ │ ┌ 主内容（flex-1）                       │ │
│ │ HIP v0.9.4（版本号在顶部） │ │ │ ├ 无会话 → NewConversation 空状态     │ │
│ │ nav：会话/项目/知识库/      │ │ │ ├ 有会话 → GoalStatusChip + ChatPane │ │
│ │       终端/任务/自动化      │ │ │ │   transcript（居中阅读列）          │ │
│ │ 列表：组头（会话 + 新建）    │ │ │ └ InputBar（Composer 浮动圆角卡片）   │ │
│ │   └ 日期分组 → 会话行       │ │ └──────────────────────────────────────┘ │
│ │ footer：回收站/历史/设置    │ │ ┌ 右栏抽屉 26% 可拖（条件显示）          │ │
│ └──────────────────────────┘ │ │ ┌ PanelTabBar 紧凑下拉（文件 ▾）      │ │
└─────────────────────────────┴───│ │ Artifact / Preview / Outline / …   │ │
                                   │ └──────────────────────────────────┘ │
                                   └──────────────────────────────────────┘
```

要点：
- 导航（6 个 section）是侧栏内 `NavItem`（图标+文字+count），active 态 = `bg-state-active` 灰色底，无 accent 左条（`sidebarActiveRail.ts`）；
- 侧栏 titlebar 与 MainToolbar 是**两条并列**的 40px 行，均 `border-b-0`；红绿灯通过 `--titlebar-lights-inset: 90px` 各自让位，侧栏折叠后 MainToolbar 补位（`titlebarChrome.ts`、`AppLayout.tsx:263-334`）；
- 版本号 `HIP v0.9.4` 在侧栏顶部（titlebar 之下、nav 之上），**不在底部**；
- 底部 footer = 回收站 / 历史 / 设置 三个图标+文字按钮（`SidebarAccountFooter.tsx`）；
- 消息气泡：用户 = `rounded-2xl bg-surface-muted` 灰色气泡，agent = 无头像，元信息为文字行（"你 / hip"，`MessageBubble.tsx:152-223`）；
- Composer 底部工具栏（`ComposerLeftSlot` + `ComposerControlRow`）：左 = agent / 模型 / effort（chip + 5 根竖条强度表，非滑块）/ 权限 / 执行模式 / 附件 等 chip，右 = `TokenUsageChip` + 语音 + **圆形**发送按钮（`Composer.tsx:192-238`、`EffortLevelPicker.tsx:47-95`）；
- 右栏 tab 切换是紧凑下拉 `PanelTabBar`（当前标签 + chevron），不是平铺 tab 条（`PanelTabBar.tsx:58-80`）。

| 维度 | 现状 | 与扁平目标的冲突 |
|---|---|---|
| 原生窗口材质 | macOS 侧栏 `Effect.Sidebar` / Win11 `Mica` / Win10 `Acrylic`（`windowVibrancy.ts` 经 Tauri `setEffects` 启用，写入 `html[data-vibrancy]`）；失败/浏览器回退 `solid`。CSS 另有 `--glass-bg` 半透明回退与 `.glass-surface` utility（`tokens.css:67,359`），但组件侧栏/标题栏本身用实色 `bg-surface-subtle/content` | 半透明穿透（能看到桌面壁纸/DWM 背景）是最大的"非扁平"元素；跨平台表现不一致、有性能成本 |
| 阴影 | Tailwind 默认档全部压成 `none`，但保留三档：`panel`（右栏浮动卡）、`menu`（下拉）、`overlay`（Modal），`tailwind.config.js:114-131` | 扁平化要求浮层也优先用边框 + scrim 分层 |
| 圆角 | `sm 4px / DEFAULT 6px / lg 8px / xl–3xl 12px` + `full` 胶囊，`tailwind.config.js:101-111` | 偏圆润；扁平应收到 2–6px |
| 动画 | springy `ease-out (0.16,1,0.3,1)`、`message-enter` 位移 8px、`menu-in` 位移+缩放、`modal-in` 缩放、`greeting-enter`、`dot-bounce`、`active:scale-95` | 弹性与位移是"拟物"残留 |
| effort-max 全息 | 紫色渐变文字 + `shimmer` + `glow-pulse` + 呼吸光晕 + 高光轨道，`tokens.css:392-604` | 全局最大视觉噪声源 |
| 状态色 | `success/danger/warning` + 5 个角色色（supervisor/planner/coder/reviewer/worker） | 保留，但呈现方式改为实色块 |
| 排版 | system-ui 13px，`caption/meta/body/prose/title/display/stat/page` 七级字阶 | 保留，扁平化下靠字重（400/500/600）强化层级 |

## 3. 设计方向

### 3.1 六条原则

1. **固体优先 Solid over Glass** —— 所有表面 100% 不透明；层级由明度阶差 + 1px 边框表达，禁止 `backdrop-filter`。
2. **边界优先 Border over Shadow** —— 浮层（下拉 / Modal）用实色 + 1px 边框 + scrim 分层；阴影最多保留 1 档极轻投影（仅 Modal），否则全删。
3. **色块优先 Color over Gradient** —— 状态用纯色实底 chip / 色条 / 圆点，禁止 `linear-gradient`、glow、shimmer。effort-max 全息系统整体拆除，降级为纯色。
4. **直角优先 Sharp over Round** —— 按钮 2px、输入框 2px、卡片 4px、浮层 6px；胶囊只允许保留给 avatar / 状态点 / 开关拇指。
5. **克制动画 Fade-only Motion** —— 只允许 `opacity` 与 `background-color` 过渡，时长 ≤ 120ms，无位移、无缩放、无弹性、无循环动画。
6. **明度阶差 Hierarchy via Value** —— 层级由 30–50px 级的灰阶差支撑，配合 500/600 字重，不依赖阴影。

### 3.2 视觉参考

- 工具栏 / 设置类：Linear、Vercel、GitHub Desktop；
- 终端 / 运维工具：终端模拟器、代码审查工具；
- 品牌锚点：暖橙 `#C2410C`（亮）/ `#FFB300`（暗）作为唯一强调，不引入第二主色。

## 4. 设计令牌改动（Token 层）

> 策略：**全部改动收敛在 `tokens.css` + `tailwind.config.js`**，组件代码尽量不改（除了去类名、去动效类的地方）。Token 一变，全局自动生效。

### 4.1 颜色（亮色）

| Token | 现状 | 扁平后 | 说明 |
|---|---|---|---|
| `--bg-app` | `#ffffff` | `#ffffff` | 不变 |
| `--bg-subtle` | `#ffffff` | `#fafafa` | 侧栏等 chrome 面，从纯白退一阶以区隔内容列 |
| `--bg-muted` | `#f2f2f2` | `#f1f1f1` | 微调 |
| `--bg-content` | `#ffffff`（注释遗留"淡黄纸感"） | `#ffffff` | 消灭"纸感"残留语义 |
| `--border` | `#bdbdbd` | `#e0e0e0` | 边框是扁平下的唯一分层手段，需轻而清晰；深色文字附近避免网格感 |
| `--border-strong` | `#a0a0a0` | `#c9c9c9` | 输入框/卡片外框档 |
| `--accent` | `#c2410c` | `#c2410c` | 品牌色不变 |
| `--accent-subtle/active` | 中性灰 `#f0f0f0/#e6e6e6` | 同左 | hover/选中底保持中性，不引入色偏 |

### 4.2 颜色（暗色）

`--bg-app #0f0f0f / --bg-subtle #171717 / --bg-muted #222222` → 微调为 `#121212 / #181818 / #1f1f1f`；
`--border #3a3a3a / --border-strong #4a4a4a` → `#2e2e2e / #3e3e3e`；`--accent #ffb300` 不变。

### 4.3 圆角

| Utility | 现状 | 扁平后 |
|---|---|---|
| `rounded-sm` | 4px | **2px** |
| `rounded`（DEFAULT） | 6px | **4px** |
| `rounded-md` | 6px | **4px** |
| `rounded-lg` | 8px | **4px** |
| `rounded-xl / 2xl / 3xl` | 12px | **6px** |
| `rounded-full` | 胶囊 | 保留（avatar / 状态点 / 开关），按钮与 chip 不再用 |

### 4.4 阴影

| 档位 | 现状 | 扁平后 |
|---|---|---|
| `shadow-panel` | 弥散双层投影 | **none**（右栏浮动卡改用实底 + 1px 边框） |
| `shadow-menu` | 双层投影 | **none**（下拉改用实底 + 1px 边框 + scrim） |
| `shadow-overlay` | 大投影 | 保留为唯一一档，但减弱至 `0 12px 32px -12px rgba(17,17,17,.12)`，Modal 主体再补 1px 边框 |
| Tailwind 默认档 | 已全 `none` | 不变 |

### 4.5 原生材质 → solid（拆除半透明穿透）

- `windowVibrancy.ts`：`enableNativeVibrancy` 直接 `markVibrancyMode('solid')`（或删除 Tauri `setEffects` 调用，仅保留 `setTheme`），`data-vibrancy` 恒为 `solid`；
- `tokens.css`：`--glass-bg` → `var(--bg-subtle)`（100% 不透明），`--glass-backdrop` → `none`；`data-vibrancy` 各分支（mac-sidebar / win-mica / win-acrylic / native）CSS 统一为实色，`solid` 分支成为唯一形态；
- `.glass-surface` utility 与 `html[data-window-focus='false']` 的降透明度规则一并删除（当前无组件引用该类，见 §5）；
- 侧栏/标题栏背景维持实色 `bg-surface-subtle / bg-surface-content`，视觉层级改由 `--border` 与明度阶差承担。

### 4.6 Effort Max 全息拆除

- `--effort-max*` 系列保留为**纯色**：亮色 `#7c3aed`、暗色 `#a78bfa`；
- 删除：`effort-max-shimmer / glow-pulse / thumb-pulse / ambient-breathe` 全部 keyframes，`.effort-max-track`（渐变滑块轨道）、`.effort-max-ambient` 光晕、`.effort-max-icon` 的 drop-shadow（真实 UI 中 effort 控件为竖条强度表 `EffortIntensityMeter`，无滑块，`EffortLevelPicker.tsx:47-95`）；
- 保留形态：MAX 档竖条与 chip 用实底纯色（`--effort-max`），普通档沿用 `bg-ink`；`.effort-max-text` 降级为纯色文字；`.effort-max-chip` 用实底 16% + 2px 边框；移除竖条上的 `shadow-[0_0_4px_rgba(168,85,247,0.55)]`。

### 4.7 动画

| Token | 现状 | 扁平后 |
|---|---|---|
| `--duration-chrome` | 140ms | **100ms** |
| `--duration-content` | 240ms | **120ms** |
| `--duration-celebrate` | 450ms | **200ms** |
| `--ease-out` | springy `(0.16,1,0.3,1)` | `linear` 或 `(0,0,0,1)` |
| `message-enter` | 位移 8px + fade | **纯 fade**（`translate` 置 0） |
| `menu-in / modal-in / overlay-in` | 位移/缩放 + fade | 纯 fade |
| `dot-bounce / blink / pulse` | 循环位移 | 保留 `blink`（状态点），`dot-bounce` 改纯 opacity |
| `active:scale-95` | 按压缩放 | 移除（改为 `bg` 加深一档） |
| `prefers-reduced-motion` 兜底 | 已有 | 保留，且成为默认行为的一个子集 |

## 5. 组件级改造清单

| 组件 / 文件 | 改造 |
|---|---|
| `AppLayout.tsx` / `AppSidebar.tsx` / `MainToolbar.tsx` / `OverlayShellHost.tsx` | 侧栏/标题栏已是实色 `bg-surface-subtle/content`；配合 §4.5 关掉原生 vibrancy 后无需改背景，仅调整 `titlebarChrome.ts` 的按钮圆角 `rounded-md` → 2px |
| `windowVibrancy.ts` / `WindowLifecycleHost.tsx` | 按 §4.5 统一 `data-vibrancy="solid"`；`tokens.css` 中所有 vibrancy 分支、`.glass-surface`、`--glass-backdrop` 删除 |
| `Button.tsx` / `Input.tsx` / `Textarea.tsx` / `Switch.tsx` | 圆角 2px、去 `scale-95`、hover 仅改底色、focus ring 保持 2px 但改方形描边 |
| `DropdownMenu.tsx` / `Popover.tsx` / `Modal.tsx` | `shadow-menu` → 边框 + scrim；`modal-in` 纯 fade |
| `SegmentedControl.tsx` / `Tabs.tsx` | 分段控制改直角块 + 实底选中；Tabs 用下划线指示（扁平经典形态） |
| `MessageBubble.tsx` / `ThinkingBubble.tsx` / `motionClasses.ts` | `message-enter` 纯 fade；用户气泡 `rounded-2xl` → 4px，去软阴影 |
| `EffortLevelPicker.tsx` | 5 根竖条强度表（`EffortIntensityMeter`）去掉 MAX 档紫条 glow，全部改实底（普通档 `bg-ink`，MAX 档纯色 `--effort` 且可加 2px 边框）；chip 去阴影 |
| `RoundtableStarter.tsx` / `RoundtableBody.tsx` / `CouncilEdges.tsx` | 渐变/发光 → 纯色块 |
| `Avatar.tsx` | `gradient` 渐变底 → 纯色底 + 白字；圆角按需求收敛 |
| `Composer.tsx` / `ComposerLeftSlot.tsx` / `ComposerControlRow.tsx` | 卡片 `rounded-xl` → 4px、去 `shadow`；发送/停止按钮 `rounded-full` 圆形 → 2px 方形；effort chip 与竖条见上 |
| `PanelTabBar.tsx` / `ArtifactPanel.tsx` / `PreviewPanel.tsx` | 右栏保持紧凑下拉形态；卡片实底 + 1px 边框 + 4px 圆角；去 `shadow-panel` |
| `AgentCard.tsx` / `SettingsPanel.tsx` 及设置各页 | 卡片实底 + 1px 边框 + 4px 圆角；去 `shadow-panel` |
| `DagEditor.css`（workflow） | 节点圆角与阴影随 token 自动变，人工复查一次 |

## 6. 实施计划

> 原则：**Token 先行、全局生效、每阶段可验证可回滚**。每阶段结束跑 `yarn tsc` + `yarn test`，并提交（AGENTS.md §4）。

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P0 基线** | 截图当前亮/暗两套主界面存档；确认测试基线 | `yarn test` 全绿 |
| **P1 Token 层** | 4.1–4.4（颜色/圆角/阴影/动画 token）一次改完 | 全 app 自动生效；跑测试（大量快照断言需同步更新）；人工过一遍主界面截图 |
| **P2 材质拆除** | 4.5：原生 vibrancy 统一 `solid`，删 `.glass-surface` / `--glass-backdrop` / focus 降透明度逻辑 | `grep -rn "setEffects\|glass-surface\|backdrop-filter" src` 无残留 |
| **P3 全息拆除** | 4.6：effort-max 全部 keyframes / 渐变 / glow 删除 | `grep -rn "effort-max-glow\|effort-max-shimmer\|effort-max-ambient" src` 无残留；更新 `EffortLevelPicker.test.tsx` 等断言（目前约 10+ 处断言 `effort-max-chip` 等类） |
| **P4 动画降级** | 4.7：duration / ease / 纯 fade；删 `active:scale-95` | 动效类测试（`motionClasses.test.ts`、`message-enter` 相关）更新 |
| **P5 巡检** | Avatar 渐变、胶囊按钮、`rounded-xl` 残留、图标 stroke（1.75→1.5 可选） | 全文件 `grep -rn "linear-gradient\|shadow-panel\|rounded-full" src --include=*.tsx` |
| **P6 验收** | 对比截图 + 对比度人工核验 + 发布 CHANGELOG | 见 §7 |

## 7. 验收标准（Acceptance Criteria）

1. **无残留**：`grep -rn "backdrop-filter\|linear-gradient\|effort-max-glow\|shadow-panel" src` 全部为空（含暗色分支）。
2. **阴影收敛**：`box-shadow` 仅剩 `overlay` 一档（或全无）。
3. **对比度不倒退**：`--text-tertiary`（#757575 亮 / #7a7a7a 暗）等 AA 承诺保持；`--border` 变浅后确认输入框占位符/边框仍可辨。
4. **动效收敛**：无位移/缩放/弹性/循环动画残留；`prefers-reduced-motion` 兜底保留。
5. **测试全绿**：`yarn tsc && yarn test` 通过（注意：跑测试前按 CLAUDE.md 暂移 `~/.hip/config/auth.json` 避免触发付费 LLM 测试）。
6. **明暗一致**：亮/暗两套扁平皮肤人工比对截图，无玻璃/渐变/发光残留。

## 8. 风险与取舍

| 风险 | 对策 |
|---|---|
| 原生材质与全息是当前识别度来源，拆除后可能显得"普通" | 用暖橙实色块 + 排版字重 + 1px 精密边框维持品质感；扁平≠廉价，关键在于边框色阶与间距 |
| 测试 / 快照断言更新量大（约 10+ 文件断言 effort-max/rounded 类） | P1–P4 每阶段就地更新断言，不攒到最后 |
| macOS/Win 关闭 vibrancy 后窗口不再穿透桌面（壁纸不可见） | 属预期行为变化，写进 CHANGELOG 与发布说明；`setTheme` 调用保留以维持标题栏明暗同步 |
| 边框变浅（#bdbdbd→#e0e0e0）后弱对比处可读性下降 | 输入框等交互面用 `--border-strong`，验收标准 3 强制核验 |

## 9. 相关文件索引

- `src/styles/tokens.css` —— 全部颜色/玻璃/全息/动画 token
- `tailwind.config.js` —— 圆角/阴影/keyframes/animation 映射
- `src/components/layout/{AppLayout,AppSidebar,MainToolbar,titlebarChrome,OverlayShellHost,SidebarAccountFooter}.tsx` —— chrome（侧栏/工具栏/footer）
- `src/lib/windowVibrancy.ts` —— 原生材质开关（P2 改造点）
- `src/components/chat/{EffortLevelPicker,MessageBubble,ThinkingBubble,motionClasses}.tsx` —— 全息与入场动画
- `src/components/ui/*` —— 通用控件皮肤
- `docs/examples/flat-design-preview.html` —— 本 spec 的视觉预览
