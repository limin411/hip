# hip 视觉与动效提升方案 —— 参考 beautifului.dev

> 系列：`ui-enhancement-bui` ｜ 配套：`ui-enhancement-bui-preview.html`（高保真对照预览，浏览器直接打开）
> 参考素材：`/Users/lijiamin/Downloads/beautifului.dev`（beautifului.dev 19 个 AI 原生组件的原生 HTML 移植版）
> 当前基线：`DESIGN.md`（Flat Solid / 纯 fade / 无阴影 / 无位移缩放）与 `src/styles/tokens.css`

---

## 0. TL;DR

beautifului.dev 的「AI 原生感」不来自炫技，而来自三件事：**进程可视化语言**（每种"运行中"状态都有专属图形语言）、**微时刻反馈**（词级浮现、完成交叉过渡、展开动画）、**信息纹理**（等宽数字计时、+N/−N 色差、chip 胶囊行）。

hip 的克制原则（纯 fade ≤200ms、无位移缩放、无阴影渐变）**不需要推翻**。本方案的原则是**采纳思路、不照搬手法**：把 bui 的动效手法降级映射到 hip 允许的"纯 opacity / 背景色过渡"语汇内，仅引入两个明示例外（展开高度动画、词级浮现 opacity 过渡）。

- **P0（核心，约 2 天）**：流式文本词块浮现、思考轨迹展开动效、工具调用行 chip 化 + hover 展开、回合状态行等宽计时
- **P1（增强，约 2 天）**：消息动作行延迟浮现、Composer 微反馈、后台任务点阵加载态、列表 stagger 入场
- **P2（默认不做，需单独评审）**：shimmer 文本、blur 词级浮现、pop-in 缩放、微阴影体系、引入网络字体

---

## 1. 参考对象分析

### 1.1 beautifului.dev 是什么

19 个 AI 原生界面组件（`components/01..19/`），每个组件 = HTML 片段 + 专属 `style.css` + 行为 `script.js`，共享设计系统 `css/bui.css`（令牌 + 基础样式 + 关键帧）。组件清单：

| # | 组件 | 核心手法 |
|---|---|---|
| 01 | loading-state | 3×3 像素格波纹加载器 + shimmer 标签 + 等宽实时计时 |
| 02 | thinking-state | 可展开推理轨迹：网格行动画展开 + 左侧轨道线增长 + 行 stagger 入场 + spinner→check 交叉过渡 |
| 03 | streaming-text | 词级 blur→清晰浮现 + 行内引用 chip pop-in + 完成后动作行浮现 |
| 04 | approval-card | 审批卡片（同意/拒绝双按钮 + 关联 diff 摘要） |
| 05 | tool-chips | 工具调用行：行内 mono chip + hover 显露 chevron + 展开明细（+N/−N 色差） + 文件 diff 汇总 chips |
| 06 | task-rows | 任务行列表：状态点 + 进度 + 完成后整行降级 |
| 07 | chat-composer | 面板内对话 + 底部 composer：focus-within 边框加深、发送按钮 fill 过渡、回复"解决中"降级 |
| 08 | prompt-bar | 悬浮提示条（快捷指令条） |
| 09 | recommendation-card | 推荐卡片（建议提示） |
| 10 | context-cards | 上下文卡片（引用素材） |
| 11 | diff-table | diff 表格（+N/−N 彩色数字、行内 diff 高亮） |
| 12 | records-table | 记录表格（等宽数字列、hover 行） |
| 13 | filter-table | 筛选表格（列筛选 chips） |
| 14 | sidebar-nav | 侧栏导航（分段列表、hover 底色、active 态） |
| 15 | search | 搜索框（focus 放大效果、结果分组） |
| 16 | insight-cards | 洞察卡片（统计数字 + 微趋势） |
| 17 | code-block | 代码块（macOS 三色点、等宽、行号、复制按钮浮现） |
| 18 | fine-tune-card | 微调配置卡（分段控件） |
| 19 | selection-actions | 选区浮动操作条（selection 后浮现） |

### 1.2 三个「手感」来源（提取出的可迁移资产）

**A. 进程可视化语言** —— 每种运行状态有专属图形语言，用户一眼读懂"在干什么"：
- 后台长任务 → 像素格波纹；推理中 → 可展开轨迹 + 轨道线；工具调用 → chip 行 + 可展开明细；流式文本 → 词级浮现 + 行内引用；完成 → 图标交叉过渡 + 标签降级。

**B. 微时刻反馈** —— 小状态变化也有过渡，不硬切：
- 图标替换（spinner→✓）做 opacity 交叉；发送按钮 fill 随可用态过渡；动作行在流式结束后浮现；旧回复在新回合开始时"降级"（`is-resolving` 变暗）；hover 时主图标→chevron 切换。

**C. 信息纹理** —— 数据本身成为视觉：
- 耗时用等宽 + `tabular-nums` 实时跳动；diff 用 `+N −N` 彩色等宽数字；文件名/命令用 mono chip；来源 chip 用 1px hairline 描边。

---

## 2. 与 hip 现有设计哲学的冲突矩阵

hip 现有原则（`DESIGN.md`）：固体优先（禁玻璃）、边界优先（阴影全 none，仅 Modal 一档）、色块优先（禁渐变/glow/shimmer）、圆角矩形、**克制动画（只允许 opacity 与 background-color 过渡，无位移/缩放/弹性/循环，时长 ≤200ms）**、明度阶差。

| bui 手法 | 与 hip 原则冲突 | 处置 |
|---|---|---|
| hairline + 微阴影分层（shadow-btn/card/raised） | 冲突（边界优先） | **不采纳**，继续用 1px 边框分层；仅 Composer focus 提案"边框加深"一档 |
| `fade-up`（位移 8px）、`pop-in`（scale .95） | 冲突（禁位移缩放） | 降级为**纯 opacity** 入场，保留 stagger 节奏 |
| `stream-in`（blur 4px→0） | 冲突（禁模糊动画） | 降级为**纯 opacity 词块浮现**（P0）；blur 版本入 P2 备选 |
| shimmer 文本 / 渐变 | 冲突（色块优先） | **不采纳**；加载态用"点阵 + 静态标签 + 等宽计时" |
| `grid-template-rows 0fr→1fr` 展开 | 部分冲突（属布局动画，非位移） | **明示例外**采纳：无视觉漂移的标准展开解法，配合 opacity |
| spinner→check 交叉过渡 | 兼容（opacity/背景色） | 采纳 |
| 等宽 `tabular-nums` 计时、+N/−N 色差、mono chip | 兼容（无动效） | 采纳 |
| stagger 入场（行级延迟） | 兼容（纯 opacity） | 采纳，总量控制在 ≤300ms 内 |
| Inter / JetBrains Mono 字体 | 冲突（系统字体栈约定） | **不采纳**；hip 已内置 JetBrains Mono 终端字体子集，仅补 `font-variant-numeric: tabular-nums` |
| 行 hover 底色、hover 显露 chevron | 兼容 | 采纳 |
| 像素格波纹（opacity 相位差） | 兼容（纯 opacity 循环） | 采纳，作为现有 `dot-bounce` 的升级形态 |

结论：**无需修改 DESIGN.md 的哲学条款**，只需在 §6 动效一节新增"允许清单"（两个例外 + 时长档位）。

---

## 3. 差距诊断：bui 19 组件 → hip 落点映射

| bui 组件 | hip 对应面 | 现状 | 主要差距 |
|---|---|---|---|
| 01 loading-state | `LoadingScreen` / `TurnStatusLine` 初始态 | 居中 spinner + 文案 | 无计时、无点阵语言 |
| 02 thinking-state | `ThinkingDisclosure` / `TurnTimeline` | chevron rotate + **条件渲染硬切** | 展开无动画、无轨道线、行无 stagger、无完成交叉过渡 |
| 03 streaming-text | `MarkdownBody` streaming + `StreamingCursor` | 整段插入 + 光标 blink | 无词级浮现、无"完成→动作行浮现" |
| 04 approval-card | `PlanApprovalCard` | 已有卡片 | 差距小；可补 diff 摘要 chip 行 |
| 05 tool-chips | `RuntimeTaskStrip` / `ToolCallRow` | 状态点 + 文字行 + kind chip | 无 hover chevron、无展开明细、无 +N/−N 色差 |
| 06 task-rows | `RuntimeTaskStrip` / work items | 运行中即显即走 | 完成后无降级痕迹（bui 保留完成态弱化行） |
| 07 chat-composer | `Composer` / `InputBar` | focus ring 2px accent | 无 focus-within 边框加深、发送按钮 fill 过渡弱、无"新回合→旧回复降级" |
| 08 prompt-bar | 空会话快捷指令 / slash | 已有 | 差距小，可参考 chip 形态 |
| 09 recommendation-card | `NewConversation` 建议卡 | 已有 | 差距小 |
| 10 context-cards | 附件 / quote chip | 已有 chip | 可加 hairline 描边细节（1px 边框已有，足够） |
| 11 diff-table | `ChatPane` diff / artifact diff | 已有 | 可补 +N/−N 等宽色差 |
| 12/13 records/filter-table | Knowledge 表格 / 历史 | 已有 | 差距小 |
| 14 sidebar-nav | `AppSidebar` | 已有（active 中性灰底） | 可加列表 stagger 入场 |
| 15 search | Command palette / knowledge find | 已有 | 差距小 |
| 16 insight-cards | 统计类卡片 | 无强对应 | 不立项 |
| 17 code-block | `CodeBlock` | 已有 | 可加"hover 浮现复制按钮" |
| 18 fine-tune-card | Settings | 无强对应 | 不立项 |
| 19 selection-actions | 上下文菜单 / 选区 | 已有 | 差距小 |

**核心差距集中在聊天域一条主线**：`流式文本 → 思考轨迹 → 工具行 → 状态行 → Composer`。本方案 P0/P1 全部围绕这条主线，符合"最小代码解决最大手感差距"。

---

## 4. 提升项明细

### P0-1 流式文本词块浮现（streaming reveal）

- **目标面**：`MarkdownBody`（streaming 分支）+ `StreamingCursor`
- **现状**：文本随 token 流整段插入，光标 blink；无"内容正在生成"的视觉节奏。
- **参考**：bui 03 —— 每个词包一层 `animation: stream-in`（opacity 0 + blur 4px → 1，420ms），配合 2px 圆角光标。
- **提案**（降级为纯 opacity）：
  1. 新增 CSS 关键帧 `stream-chunk-in`：`opacity: 0 → 1`，时长 `--duration-stream: 240ms`，缓动 `--ease-standard`；禁用 blur（P2 备选）。
  2. 在流式渲染路径为**每批新增 token（约 6–12 词）包一个 `<span class="stream-chunk">`**，不改变 DOM 文本内容与 markdown 结构（只包叶子文本节点，可延用现有流式 chunk 边界）。
  3. 非流式渲染（历史消息）不包 span，零开销；`prefers-reduced-motion` 全局兜底已有，动画自然失效。
  4. 光标保持现有 `animate-blink`（opacity 循环，已合规）。
- **验收**：发送一条长回复，文本以 3–5 个词块依次浮现（每块 240ms），整体节奏与 token 流一致；无位移、无模糊、无布局抖动；历史消息渲染完全不变。

### P0-2 思考轨迹展开动效（thinking disclosure）

- **目标面**：`ThinkingDisclosure`（`TurnTimeline.tsx`）+ 展开内容区
- **现状**：chevron rotate 90°（已有 transition），但内容 `{open && <pre>}` **条件渲染硬切**，无高度动画、无轨道线、无完成态过渡。
- **参考**：bui 02 —— `grid-template-rows: 0fr → 1fr` + opacity 过渡展开（400ms `ease-out-strong`）；左侧 1px 轨道线 `height 0 → 100%`（500ms）；行 stagger `fade-up`（300ms，逐行 delay 60ms）；完成后 label 变淡 + spinner→✓ 交叉过渡。
- **提案**：
  1. **明示例外**：引入 `grid-template-rows 0fr→1fr` 展开（300ms，`--ease-standard`）——这是无位移的标准展开解法，不违反"禁位移/缩放"精神；`grid-rows` 未受支持时回退 max-height（不新增 polyfill）。
  2. 展开内容内部：若为步骤列表，各行加 `fade-in` + 行间 delay 40ms stagger（纯 opacity，总量 ≤300ms）。
  3. 左侧竖线 rail：用容器 `::before` + `transform: scaleY(0→1)` 会违反"禁缩放"——**降级为纯 opacity 段呈现**（rail 线直接渲染，仅做 fade-in），不做高度动画。
  4. 完成态：spinner→check 图标 opacity 交叉（100ms），`seconds` 标签保持等宽 `tabular-nums`。
- **验收**：点击 chevron 后内容平滑展开（无跳变、无位移）、展开行带轻微 stagger；再次点击平滑收起；完成态图标交叉过渡；reduced-motion 下直接显示。

### P0-3 工具调用行 chip 化 + hover 展开（tool rows）

- **目标面**：`RuntimeTaskStrip`（Composer 上方运行条）与消息内 `ToolCallRow` / `ToolCallGroup`
- **现状**：运行条行 = 状态点 + 描述文字 + kind chip + stop 按钮；工具调用行已有分组，但**不可展开看明细**，无 hover 反馈。
- **参考**：bui 05 —— 每行：图标 + 动作标签（"Write 204 lines"）+ **mono chip**（文件名/命令）；hover 行底色 + 图标滑向 chevron；点击展开明细（mono 代码行、`+N` 绿 / `−N` 红）；底部文件 diff 汇总 chips（`flavors.css +13 −0`）。
- **提案**：
  1. 运行条行增加 hover 底色（`hover:bg-state-hover`）与 chevron 显露（主图标 opacity 0 ↔ chevron opacity 1 交叉，150ms，纯 opacity）。
  2. 行点击展开明细（grid-rows 例外，同 P0-2）：显示该任务的最近输出 / 命令与结果（数据源：taskRuntimeStore 已有的最近活动字段，或 ToolCall 的 input/output）。
  3. 明细中 diff 数据用等宽 + `tabular-nums` + `--success`/`--danger` 色差（与 `src/lib/activitySummary` 已有 add/del 数据对齐）。
  4. 文件级汇总 chips：`文件 +N −M` 一行一个 chip（1px 边框，mono），完成态整体降级为次级文字（bui 06 手法）。
- **验收**：hover 行有可感知反馈；点击展开不改变行高以外的布局（动画平滑）；diff 数字绿/红可辨；完成后的运行条行弱化为次级文字。

### P0-4 回合状态行等宽计时（status line）

- **目标面**：`TurnStatusLine`
- **现状**：spinner + 活动摘要文案 + 已用时长（`formatElapsed` 已有），但时长**非等宽、实时跳动感弱**；图标切换硬切。
- **参考**：bui 01/02 —— 计时器 `font-family: mono + tabular-nums` 实时跳动；spinner→check 交叉过渡；完成后 label 降级为 `--ink-2`。
- **提案**：
  1. 时长 span 加 `font-mono tabular-nums`（CSS 即可，类名 `tabular-nums` 已在 tokens 定义），字号保持 meta。
  2. spinner→✓/✗/⚠ 切换处加 100ms opacity 交叉过渡（图标容器做 `transition-opacity`，新图标先插入旧图标后卸载或直接 opacity 过渡）。
  3. 完成后整行文字从 `--text-primary` 降级到 `--text-secondary`（300ms opacity/color 过渡）。
- **验收**：计时数字跳动不抖（等宽）；完成瞬间有 100ms 级交叉而非硬切；文案降级可感知。

### P1-1 消息动作行延迟浮现（message actions）

- **目标面**：`MessageBubble` 底部 `MessageActions` 行
- **现状**：`!streaming` 后条件渲染，直接出现。
- **参考**：bui 03 —— 流式结束后 actions 行 `opacity 0→1`（400ms）+ 按钮 hover 底色。
- **提案**：动作行容器加 `message-actions-enter`（fade-in 200ms，`--duration-content` 档），仅首次显示时动画；无需 JS 定时器（CSS 动画触发时机=挂载时机即完成时机）。
- **验收**：回复完成 → 动作行 200ms 淡入；历史消息（已挂载）不受影响（首次渲染也淡入可接受，与现有 `view-enter` 一致）。

### P1-2 Composer 交互微反馈

- **目标面**：`Composer`（card 变体）/ `InputBar`
- **现状**：focus 为 2px accent ring；发送按钮状态色切换（`disabled` 灰 → 主按钮底）。
- **参考**：bui 07 —— `focus-within` 时边框 `--line → --line-strong` 加深（150ms）+ 极轻投影；发送按钮 fill 200ms 过渡 + `:active scale(.96)`。
- **提案**：
  1. Composer 容器 `focus-within` 边框加深一档（`--border → --border-strong`，150ms 过渡），**不加投影**（守边界优先）。
  2. 发送按钮保留现有 hover/active 过渡；`active` 缩放需评审（禁缩放原则）——默认不做，仅在 P2 备选。
  3. quote / 附件 chip 出现用 fade-in 120ms（现为条件渲染硬切）。
- **验收**：聚焦时边框加深平滑；chip 出现淡入；按钮状态切换平滑（现有 Button 已有 transition，补齐即可）。

### P1-3 后台任务点阵加载态（pixel-grid loader）

- **目标面**：`LoadingScreen` 与 `TurnStatusLine` 的初始"运行中"指示
- **现状**：`Loader2` spinner + 文案；`RuntimeTaskStrip` 状态点 `animate-pulse`（opacity 全相位一致）。
- **参考**：bui 01 —— 3×3 像素格、每格 opacity 相位差波纹（650ms 周期）、等宽计时器；`prefers-reduced-motion` 冻结为全 dim。
- **提案**：在 `tokens.css` 新增 `@keyframes pixel-wave`（纯 opacity，9 格用 `animation-delay` 错相，周期 700ms ≤ 现有 blink 节奏）；`LoadingScreen` 与运行条状态点改用点阵（或保留点 + 点阵二选一，由实施时截图决定）。shimmer 标签**不采纳**（色块优先）。
- **验收**：点阵呈波纹状呼吸（纯 opacity）；reduced-motion 冻结；与现有 dot-bounce 并存不冲突。

### P1-4 侧栏会话列表 stagger 入场

- **目标面**：`AppSidebar` 会话列表首屏
- **现状**：整列表同时出现。
- **参考**：bui 列表型组件行级 `fade-up` stagger（60ms/行）。
- **提案**：仅首次挂载时，每行 `fade-in` + `animation-delay: 12ms × index`（≤300ms 总量，纯 opacity）；切换会话/分组不重复动画（`key` 稳定即可，用现有 `view-enter` 语义扩展）。
- **验收**：首屏行自顶向下轻微错落淡入；滚动/切换无重复动画；reduced-motion 直出。

### P2（默认不做，需单独评审）

| 项 | 说明 | 不做原因 |
|---|---|---|
| shimmer 文本 / 渐变标签 | bui 01 标签 | 违反色块优先；静态标签 + 计时已够 |
| blur 词级浮现 | bui 03 原版 | 违反禁模糊；opacity 版（P0-1）已覆盖 80% 观感 |
| pop-in 缩放（chip、行） | bui 多处 | 违反禁缩放；opacity fade 已够 |
| 微阴影体系 | bui 全套 shadow-* | 违反边界优先；hip 用边框分层 |
| Inter / JetBrains Mono 打包字体 | bui 全站 | 违反系统字体栈约定；仅补 `tabular-nums` |
| 旧回复"解决中"降级（is-resolving） | bui 07 | 语义不明确（hip 多 agent 并行），需产品决策 |
| CodeBlock 复制按钮 hover 浮现 | bui 17 | 收益小，排期优先级低 |

---

## 5. 实施计划

### 阶段划分

| 阶段 | 内容 | 涉及文件（预估） | 工作量 |
|---|---|---|---|
| S1 | P0-1 词块浮现 | `MarkdownBody.tsx`（流式分支包 span）、`tokens.css`（`--duration-stream` + `stream-chunk-in`）、`tailwind.config.js`（如需 animation 别名） | 0.5d |
| S2 | P0-2 思考轨迹展开 | `TurnTimeline.tsx`（grid-rows 展开容器 + stagger）、`tokens.css` | 0.5d |
| S3 | P0-3 工具行 chip 化 | `RuntimeTaskStrip.tsx`、`ToolCallRow.tsx`（展开明细 + 色差数字） | 1d |
| S4 | P0-4 状态行计时 | `TurnStatusLine.tsx`（mono 计时 + 图标交叉） | 0.5d |
| S5 | P1 四项 | `MessageBubble.tsx`、`Composer.tsx`、`LoadingScreen.tsx`、`AppSidebar.tsx` | 1d |
| S6 | 收尾 | DESIGN.md §6 动效新增"允许清单"；`docs/design` 截图对比；视觉 QA 清单走查 | 0.5d |

> **实施状态（2026-08）**：S1–S6 已全部落地（`10000db1` / `23ea68a9` / 收尾提交）。落地差异：
> - S2 未做 rail 行级 stagger（轨迹为单块 pre，无行列表；rail 高度动画违反禁缩放，按 spec 裁决跳过）；
> - S3 hover 显露 chevron 落地为**常显 chevron**（可发现性 + 触屏友好）；
> - S4 图标"交叉过渡"落地为 keyed 挂载淡入（`animate-status-icon` 120ms，spec §4 的"或直接 opacity 过渡"分支）；
> - P1-3 点阵加载仅用于 `LoadingScreen`，运行条状态点保留原 `animate-pulse`（点阵与其共用的视觉噪声重复）。

### 动效"允许清单"（写入 DESIGN.md §6）

1. 时长新增一档：`--duration-stream: 240ms`（流式词块）、`--duration-expand: 300ms`（展开）。
2. 例外一：`grid-template-rows` 高度展开（无位移的布局动画）。
3. 例外二：词块级 opacity 浮现（≤240ms）。
4. 其余维持：纯 opacity / background-color / border-color 过渡，禁位移缩放模糊渐变 shimmer。

### 测试与回归

- 现有组件单测（`ThinkingBubble.test`、`TurnStatusLine.test`、`Composer.test` 等）均为行为测试，**纯 CSS + span 包装不影响断言**；新增渲染断言（如 span.stream-chunk 存在性）随组件测试补。
- `prefers-reduced-motion` 全局兜底已存在（tokens.css §355），无需新逻辑。
- `yarn check:store-deps` / `yarn tsc` 保持绿；视觉回归用 preview 页人工对照。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 词块 span 破坏 markdown 流式渲染（inline 结构） | 只包叶子文本节点；实现时以现有 chunk 边界复用；若结构风险大，改为**整段 fade-in 一次**（收益减半但零风险） |
| grid-rows 展开在超大内容（长轨迹）时性能 | 内容 ≤ 40 行直接展开；更大时退化为 opacity-only（条件渲染） |
| stagger 在列表滚动时触发观感差 | 仅首次挂载动画；key 稳定防重复 |
| 视觉 QA 通过但产品侧认为过度 | 全部动效集中在 `tokens.css` + 少量 span 包装，删除即回滚；S6 前任何阶段可整体降级 |

---

## 7. 验收标准（对照 bui 逐条）

1. 发送长回复：文本以词块浮现（P0-1）✓ 无位移无模糊
2. 点击"推理"chevron：平滑展开 + 行 stagger + 完成交叉过渡（P0-2）✓ 收起同样平滑
3. 运行条行 hover：底色 + chevron 显露；点击展开明细含 +N/−N 色差（P0-3）✓
4. 回合状态行：等宽计时实时跳动；完成瞬间交叉过渡（P0-4）✓
5. 动作行 / chips / 列表首屏均有 ≤300ms 的 opacity 淡入（P1）✓
6. 全屏截图对比 bui 同场景：**进程可视化语言对齐，材质语言仍是 hip**（无阴影、无玻璃、无渐变）✓
7. `prefers-reduced-motion: reduce` 下所有新增动效直出 ✓
