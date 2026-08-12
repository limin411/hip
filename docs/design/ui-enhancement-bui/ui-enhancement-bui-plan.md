# hip 视觉与动效提升 —— 执行计划（参考 beautifului.dev）

> 系列：`ui-enhancement-bui` ｜ spec：`ui-enhancement-bui-spec.md` ｜ 预览：`ui-enhancement-bui-preview.html`
> 本文档按 spec §4/§5 落地，S1–S6 六个阶段，每阶段独立提交、可回滚。
> **执行状态：S1–S6 已全部实施（2026-08，commit `10000db1` / `23ea68a9` / 收尾提交）；落地差异见 spec §5 状态注。**

---

## 0. 范围与原则（执行约束）

- **动效语汇**：所有新动效 = 纯 `opacity` / `background-color` / `border-color` 过渡；仅两个明示例外：
  1. `grid-template-rows` 高度展开（`.clip-expand`，无位移的布局动画）；
  2. 词块级 opacity 浮现（`.stream-chunk`，≤240ms）。
- **不动的东西**：阴影体系、渐变（除既有 `composer-danger-*`）、blur、缩放、弹性、循环动画（除既有 `blink`/`dot-bounce`/`animate-pulse`/spinner）。
- **reduced-motion**：tokens.css 全局兜底已存在（`@media (prefers-reduced-motion)`），新增动画自动被冻结。
- **测试纪律**：行为断言不变（`textContent`/`data-testid` 保持）；新增渲染断言随文件补。
- **付费 LLM 测试护栏**：跑 `yarn test` 前按 CLAUDE.md 暂时移开 `~/.hip/config/auth.json`，或仅跑受影响文件的定向 vitest。

---

## S1 · tokens.css 动效资产（基础层）

**文件**：`src/styles/tokens.css`

1. `:root` motion 档位新增两档（紧跟 `--duration-celebrate` 之后）：
   ```css
   --duration-stream: 240ms;   /* 流式词块浮现（例外②） */
   --duration-expand: 300ms;   /* 展开动画（例外①） */
   ```
2. 新增关键帧 + 工具类（跟随既有 `.animate-greeting-enter` 模式，置于 roundtable-seat 块之后）：
   - `stream-chunk-in`（opacity 0→1）+ `.stream-chunk`：词块浮现，时长 `var(--duration-stream)`。
   - `.clip-expand` / `.clip-expand.is-open` / `.clip-expand-inner`：grid-rows 0fr↔1fr + opacity 过渡，时长 `var(--duration-expand)`；inner `overflow:hidden; min-height:0`。
   - `status-icon-in`（opacity 0→1）+ `.animate-status-icon`：状态图标替换时的 120ms 淡入。
   - `pixel-wave`（opacity 0.12↔1）+ `.px-grid` / `.px-grid i`（3×3，nth-child 相位延迟 80ms×n）：点阵加载。
   - `sidebar-row-enter` + `.animate-sidebar-row`（`animation-delay: calc(var(--row-i,0) * 12ms)`）：侧栏行 stagger。
3. 不新增 tailwind.config 别名（直接 CSS 类，与 greeting/roundtable 模式一致）。

## S2 · P0-1 流式文本词块浮现

**文件**：`src/lib/streamChunks.ts`（新）、`src/lib/streamChunks.test.ts`（新）、`src/components/chat/MarkdownBody.tsx`、`src/components/chat/MessageBubble.tsx`、`src/components/chat/MarkdownBody.test.tsx`（新）

1. `chunkStreamText(text)`：把文本切成 2–6 词 / 4–6 字的词块（拉丁按空白 token 累积 ≈3 词；CJK 无空白 run 按 6 字切片；混合 run 兜底按长度）。纯函数，可单测。
2. `MarkdownBody` 新增 `streaming?: boolean` prop：
   - `streaming` 时向 `components` 注入 `p` 渲染器：对 paragraph 子节点，字符串子节点按 `chunkStreamText` 切为 `<span key={i-j} className="stream-chunk">`，元素子节点（code/strong/a…）包 `stream-chunk` span（key 按索引）——append-only 增长下 React 复用旧 span（不重放动画），新 span 挂载即浮现。
   - 非 streaming 路径零改动（历史消息、文档、插件配置等调用方不受影响）。
3. `MessageBubble`：assistant 非 roundtable 分支 `<MarkdownBody content={displayContent} streaming={streaming} />`。
4. 测试：
   - `streamChunks.test.ts`：拉丁 3 词切块、CJK 6 字切块、空串/短串、混合文本不丢字符（拼接 = 原文）。
   - `MarkdownBody.test.tsx`：非 streaming 无 `.stream-chunk`；streaming 有且 `textContent` 不变；含 inline code 的段落不破坏结构。

**风险护栏**（spec §6）：若 inline 结构重排导致 span 重挂载（markdown 流式中括号闭合造成树形变化），表现为该段整体 240ms 淡入一次——与既有 `msg-enter-left` 行为同级，可接受；不改 DOM 文本内容。

## S3 · P0-2 思考轨迹展开动效

**文件**：`src/components/chat/TurnTimeline.tsx`、`src/components/artifact/ToolCallRow.tsx`

1. `ThinkingDisclosure`：`{open && <pre>…}` → `.clip-expand` 包裹（pre 的既有 `mt-1 border-l pl-3` 视觉不变）。
2. `ToolCallRow`：`{open && <div data-testid="tool-result-view">…}` → `.clip-expand` 包裹（内层 `mt-0.5 space-y-1.5` 结构不变，收起时 `overflow:hidden` 生效）。
3. 不改 rail/行级 stagger（轨迹内容为单块 pre，无行列表；rail 线不做高度动画 —— 遵守禁缩放原则，spec 已裁决）。
4. 测试：既有 `TurnTimeline.test` / `ThinkingBubble.test` 的 `thinking-disclosure` / `tool-result-view` testid 与 DOM 顺序断言不变；补一条「open 后内容在 `.clip-expand` 内」的结构断言（可选，低价值则跳过）。

## S4 · P0-3 运行任务条行展开

**文件**：`src/components/chat/RuntimeTaskStrip.tsx`

1. 抽 `RuntimeTaskRow` 局部组件：状态点 + description + kind chip + chevron（`transition-transform duration-chrome`，open 旋转 90°）+ 既有 stop 按钮。
   - 展开按钮与 stop 按钮**平级**（避免 button 嵌套）：行内 `flex items-center gap-2`，左为可点击展开区（`flex-1`，`disabled` 当无明细），右为 stop。
   - 明细 = `task.detail` 或 `task.logTail`（mono `pre`，`whitespace-pre-wrap break-words`，`.clip-expand` 展开）。
2. 说明：spec preview 中「hover 显露 chevron」落地为**常显 chevron**（可发现性更好、触屏友好）；hover 底色 `hover:bg-state-hover` 保留。
3. 测试：`RuntimeTaskStrip.test.tsx` 补展开/收起用例（点击行 → detail 可见；无明细行 chevron 缺失/禁用）。

## S5 · P0-4 回合状态行

**文件**：`src/components/chat/TurnStatusLine.tsx`、`src/components/chat/TurnStatusLine.test.tsx`

1. 图标替换：`statusIcon(...)` 外包 `<span key={streaming ? 'live' : status} className="animate-status-icon">`（挂载即淡入 120ms；`Loader2` 内部自带 `animate-spin`，互不干扰）。
2. 时长等宽：`turn-status-text` 内拆 `{summaryText}` + ` · <span className="font-mono tabular-nums">…</span>`；`elapsedLabel` 即 `t('chat.activity.elapsed') = '{{time}}'`，`formatElapsed` 输出 `3s` / `1m 30s`。
3. 测试：`toHaveTextContent` 断言不变（textContent 仍含时间）；补一条 elapsed span 携带 `font-mono`/`tabular-nums` 的断言。

## S6 · P1 四项增强 + 收尾

**P1-1 动作行浮现** — `MessageBubble.tsx`：`!streaming` 的动作行容器加 `animate-view-enter`（既有 240ms fade，零新增 CSS）。
**P1-2 Composer 微反馈** — `Composer.tsx`：card 变体外壳加 `transition-colors focus-within:border-border-strong`（150ms 边框加深，不加投影）；quote / diff-annotations / attachments 三个条件块加 `animate-view-enter`。`Composer.test` 的 className 包含断言（`border`、`rounded-lg`、`bg-surface-subtle`）不受影响。
**P1-3 点阵加载** — `LoadingScreen.tsx`：保留 HipLogo 脉冲；文案行改为 `.px-grid`（9 格）+ 文案 + mono `tabular-nums` 计时（useEffect 1s interval，`data-testid="loading-elapsed"`）。
**P1-4 侧栏 stagger** — `AppSidebar.tsx`：`SidebarSessionRow` 增 `enterIndex?: number`，根 `<li>` 加 `.animate-sidebar-row` + `style={{ '--row-i': enterIndex }}`；chats / projects 两处 map 传 `enterIndex={i}`。key 稳定行不重放；组折叠展开重现 stagger（可接受，作为展开反馈）。
**收尾**：
1. `DESIGN.md` §6 动效节新增「允许清单」：`--duration-stream` / `--duration-expand` 两档 + 两个例外（grid-rows 展开、词块 opacity 浮现），其余维持纯 fade 纪律。
2. `docs/design/ui-enhancement-bui/` 补「已实施」标注（spec §5 状态列）。
3. 全量验证：受影响组件定向 vitest → `yarn tsc` → `yarn check:store-deps` → （auth.json 移开后）`yarn test` 相关子集。
4. 逐阶段 commit。

## 验收对照（spec §7 条目映射）

| spec 验收 | 落地点 |
|---|---|
| 词块浮现，无位移无模糊 | S2 `.stream-chunk`（240ms opacity） |
| 轨迹平滑展开/收起 + 完成交叉 | S3 `.clip-expand` + S5 `.animate-status-icon` |
| 运行条 hover/chevron/展开明细 | S4 |
| 等宽计时实时跳动 | S5 mono + tabular-nums（既有 1s tick） |
| 动作行 / chips / 列表 ≤300ms 淡入 | S6 |
| 材质仍是 hip（无阴影玻璃渐变） | 全程未引入 |
| reduced-motion 直出 | tokens.css 全局兜底 |

## 风险与回滚

| 风险 | 处置 |
|---|---|
| `stream-chunk` span 破坏 markdown 渲染 | S2 单测覆盖 inline code/链接；失败则降级「整段一次 fade」（spec §6 预案） |
| `.clip-expand` 在超大 tool 输出上性能 | 内容天然 `max-h` 约束（ToolCallRow 已有）；必要时仅对 `ThinkingDisclosure` 启用 |
| 侧栏 stagger 在会话频繁增删时反复动画 | key 稳定（session.id）；组展开的 stagger 作为正向反馈保留 |
| Composer focus-within 边框与既有 `border-border` 冲突 | 同一 class 字符串追加，Tailwind 优先级由书写顺序裁决（后者生效），预览已验证 |
