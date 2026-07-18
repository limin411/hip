# Spec: Chat / Code 丝滑体验（渐进交付 + 分阶段 e2e）

| Field | Value |
|-------|-------|
| **Title** | Chat/Code 丝滑：根因、最佳实践、界面体验、渐进交付与 e2e 门禁 |
| **Date** | 2026-07-18 |
| **Status** | **Phased delivery spec** — 目标能力完整定义（含**对话输出 + 右侧智能体面板 UI**）；**按阶段发布**；**每阶段必须过 e2e** |
| **Audience** | 产品 / 前端 / sidecar / 协议 / 测试 |
| **对照基线** | `/Users/lijiamin/data/code-repository/github/`（§2） |
| **e2e 基座** | `e2e/`（WebdriverIO + Tauri）；`yarn test:e2e:gate` / 分 tag 套件；见 `e2e/README.md` |
| **相关** | [upgrade/](../upgrade/)（远程 / Mobile / Design Mode 等超出本路线的项） |

---

## §0 交付原则（硬约束）

1. **目标完整、交付渐进**  
   §4 定义**终态能力全集**（对照最佳实践后的完整要求）。实现与发布按 **§5 阶段**推进；未列入当前阶段的能力可以不做，但**不得半吊子发布**（阶段内 MUST 必须齐）。

2. **每阶段强制 e2e 门禁**  
   阶段结束 = 功能完成 **且** §5 该阶段 **e2e 套件全绿** **且** **回归门禁全绿**（见 §6）。  
   无 e2e、或 e2e 不稳定跳过 = **阶段未完成**，不得合入视为「该阶段已交付」的发布说明。

3. **只进不退**  
   后阶段不得破坏前阶段已验收行为。回归集 = 既有 `yarn test:e2e:gate` + **本路线已关闭阶段的全部 e2e tag**。

4. **参考最佳实践，移植语义**  
   对照本地树（§2）；栈保持 Tauri + React + Node sidecar。

5. **智能面不降级**  
   plan / memory / knowledge / eval / HITL 保留；不得靠关能力假装丝滑。

6. **双通道输出（UI 硬约束）**  
   - **对话通道（Transcript）**：叙事答案 + 渐进过程（工具 / 推理 / 子代理摘要），默认可读、少噪音。  
   - **工作台通道（Workbench 右侧）**：多 agent 运行细节、文件 / diff / 终端；与对话**同源事件、双向跳转**。  
   不得只在一侧完整、另一侧空白，或两套互不同步的 UI。

7. **测试分层**  
   - **Unit / integration**（Vitest / sidecar）：协议、store、tool、context、**UI 展示纯函数**。  
   - **E2E unpaid**（默认 CI / 阶段门）：`e2e/specs` + harness 注入，**不依赖付费 LLM**。  
   - **E2E live / eval**（可选加强）：`E2E_LIVE_LLM=1` 或 `yarn test:e2e:eval*`，不挡 unpaid 阶段门，但 **P3+ 建议**至少一条 live smoke 人工或 nightly。

---

## §1 问题定义

### 1.1 「丝滑」维度

| ID | 维度 | 用户标准 | 当前缺口 |
|----|------|----------|----------|
| M1 | T_first | 发送后立即有确定性反馈 | 首反馈弱 |
| M2 | T_stream | 流式不卡、滚动不抖 | 每 token 全量 Markdown |
| M3 | T_tool | 工具默认可见、路径可点 | ActivityBar 折叠 |
| M4 | T_edit | 写文件后立刻预览 + inline diff | 等 turn 结束 |
| M5 | T_loop | 终端失败一键回 Composer | 终端附属 |
| M6 | T_review | Diff 批注进下一轮 | 闭环不完整 |
| M7 | T_open | 开局进入项目会话零摩擦 | 双 surface 税 |
| M8 | P_edit | 结构化编辑高成功率 | exact-only `edit_file` |
| M9 | P_ctx | 环境/打开文件与模型一致 | 静态 inject |
| M10 | P_simple | 简单任务不乱委派 | prompt 过宽 |
| M11 | P_parallel | 多 worktree 比方案 | 产品面未打穿 |
| M12 | **U_answer** | 答案区与过程区层次清晰，推理可折叠 | 过程/答案粘连、工具偏调试日志 |
| M13 | **U_agent** | 右侧 Agents 实时反映多 agent 进度，可跳回对话 | Dashboard 偏事后列表，与对话联动弱 |

### 1.2 现状路径（摘要）

```text
UI → WS → sidecar (LangGraph) → token/tool 事件
  → sessions[] 全表更新 → ReactMarkdown 全量 → 折叠工具条
  → write 后 debounce diff；preview 多等 message:complete
  → Agents 面板偏 turn 事后列表；对话内 SubAgentCard 与右侧 AgentCard 信息重复且不同步
```

### 1.3 对话 / 右侧面板现状（UI 缺口）

| 区域 | 现状（hip） | 体感问题 |
|------|-------------|----------|
| **MessageBubble** | ActivityBar 摘要 + 答案 Markdown；工具细节多在展开 Timeline | 过程像「调试折叠」，不像 coding agent 进度 |
| **ThinkingBubble / reasoning** | 有 reasoning 时间线，但与答案层次不统一 | 推理刷屏或找不到 |
| **ToolCallRow** | 通用 pre 展示 input/output | 缺 grep/shell/edit 专用呈现 |
| **SubAgentCard** | 对话内卡片，`showTools={false}` 常关工具 | 子代理「黑盒」 |
| **AgentDashboard / AgentCard** | 右侧按 turn 反序列表 + 协作结构 | 非「当前 live 焦点」；与对话点击弱联动 |
| **PreviewPanel / Files** | 预览与 tree | 与工具事件焦点未系统绑定 |
| **Timeline tab** | Git/checkpoint 向 | 与 agent 过程 timeline 命名易混 |

---

## §2 对照最佳实践（终态语义来源）

路径前缀：`/Users/lijiamin/data/code-repository/github/`。

| 来源 | 必须吸收的语义 | 主要落入阶段 |
|------|----------------|--------------|
| **OpenCode** `CONTEXT.md` + app e2e performance + `session` UI（timeline / todo collapse / reasoning summaries / followup dock） | Context Epoch；流式可观测；**时间线分区、推理摘要开关、队列消息 dock** | P1 流式/UI；P4 context |
| **Codex** `apply_patch*` + TUI chatwidget / composer 语义 | 结构化 patch；**过程 preamble + 清晰 turn 块** | P2 |
| **Pi** `edit-diff` + per-tool render（collapsed/expanded） | **工具类型专用渲染**、diff 详情、mutation 队列 | P1–P2 UI 渲染 |
| **Orca** agent status / worktree card / terminal scroll intent | **agent 状态点**（working/done/permission）、侧栏可扫；终端 intent | P3 面板；P5 并行 |
| **OpenHands** `event-message-components`（thought / observation-pair / finish / error / user-assistant） | **事件类型分流渲染**；observation 成对展示；错误/完成独立视觉 | P1–P3 对话 |
| **Kimi-code** `GOAL.md` | goal 状态机 + 边界注入 | P5 |
| **hermes / oh-my-openagent** | 技能/工具结果可读卡片 | P2 工具渲染参考 |

**不抄：** Electron 全量、Codex 整仓 Rust 替换、远程/Mobile/Computer Use（upgrade 另轨）。

### 2.1 界面体验专项对照（对话 + 右侧）

| 实践 | 来源细节 | hip 落点（§4.U） |
|------|----------|------------------|
| 事件分型渲染 | OpenHands：thought / observation-pair / finish / error 分组件 | U1、U3、U16 |
| 过程 vs 答案分区 | Codex TUI / OpenCode message timeline | U1、U4 |
| 推理可折叠 + 可选摘要 | OpenCode `reasoningSummaries` 设置语义 | U3 |
| 工具 collapsed/expanded 双视图 | Pi `renderResult({ collapsed, expanded })` | U2、U12、U15 |
| edit 结果即 diff | Pi `EditToolDetails.diff` + `firstChangedLine` | U5、B3、C3 |
| Agent 状态可扫 | Orca `WorktreeAgentActivitySummary`（live working/done/permission） | U11、U14 |
| 侧栏/卡片与内容焦点 | Orca focused agent row highlight | U10 |
| Session 侧面板布局 | OpenCode `session-side-panel` / file-tabs / terminal-panel | U13、U19、F* |
| 队列 follow-up 不插队视觉 | OpenCode followupDock collapse | U17 |
| 流式性能不靠感觉 | OpenCode performance RAF-gap / long-task | A*、K1、U4 |
---

## §3 终态产品架构（目标态，可分阶段逼近）

### 3.1 会话模型（终态）

| 概念 | 定义 |
|------|------|
| **Session** | 唯一对话实体 |
| **workspaceMode** | `sandbox` \| `project`（cwd 可选/必选） |
| **Permission** | `chat` \| `edit` \| `full` |
| 遗留 `surface` | 双读：`code`→project，`chat`→sandbox |

- **P0–P1**：可先保留双 surface UI，但 e2e 必须覆盖两路径不回归。  
- **P4**：完成统一 session 列表 + 空态 CTA（§4.J）；`surface` 仅兼容层。

### 3.2 终态布局（project）

```text
Sidebar | Transcript + Composer | Workbench (Files | Changes | Agents | Timeline | Terminal)
```

### 3.3 双通道信息架构（对话 × 右侧智能体）

```text
                    ┌── Transcript（对话输出）────────────────────────────┐
 User message  ──►  │  [Process rail] 工具/推理/子代理 渐进卡片（默认可读）   │
                    │  [Answer] 最终/流式答案 Markdown                      │
                    │  [Meta] 耗时 · tokens · actions · citations          │
                    └──────────────┬─────────────────────────────────────┘
                                   │ 同源事件（turnId / callId / agentId）
                                   ▼
                    ┌── Workbench（右侧）────────────────────────────────┐
                    │  Agents：live 焦点 agent + 树/列表 + 工具流 + 输出   │
                    │  Files：跟随 write/选中 path                         │
                    │  Changes：diff + 批注                                 │
                    │  Terminal：测改                                       │
                    │  Timeline：git/checkpoint（与 agent 过程区分命名）     │
                    └────────────────────────────────────────────────────┘
```

| 规则 | 说明 |
|------|------|
| **单一事件源** | UI 不维护第二套 tool 状态；两侧均投影 `Message.timeline/toolCalls/agentRuns` |
| **对话偏摘要** | 对话内工具默认「人类进度」；完整 JSON/长输出在展开或右侧 |
| **右侧偏监控** | Agents 默认 **当前 turn live** 置顶；历史 turn 可折叠 |
| **双向跳转** | 对话 tool 行 → 打开右侧对应 tab + 高亮；Agents 卡 → `scrollTarget` 对话 turn |
| **焦点状态** | `focusedAgentId` / `focusedCallId` / `focusedPath`（uiStore 或 domain 投影）三端共享 |

---

## §4 功能需求全集（终态目录）

> 编号稳定，供阶段映射与 e2e 追溯。阶段未声明的 ID = 该阶段不做。

### A. 流式与渲染

| ID | 需求 |
|----|------|
| **A1** | token/reasoning UI 帧合并（rAF 或 ≤16ms）；complete 立即 flush |
| **A2** | store 热路径 O(1) 更新 active session，禁止每 token 全 sessions 深拷贝 |
| **A3** | 流式轻量 Markdown；complete 后完整 GFM + 高亮 |
| **A4** | transcript pinned-to-bottom；非 smooth 高频；上滚停止跟随 |
| **A5** | 长 transcript 虚拟化/窗口化 |

### B. 工具可见性

| ID | 需求 |
|----|------|
| **B1** | running turn 工具时间线默认展开（running + 最近 N≤8） |
| **B2** | 人类可读 title + 路径可点开预览 |
| **B3** | edit/write/patch **inline unified diff** |
| **B4** | 子 agent / task_batch 可进入详情 |
| **B5** | 工具错误可行动 |

### C. 编辑闭环 UI

| ID | 需求 |
|----|------|
| **C1** | write 类 `tool:finished` 立即 preview/tree/diff summary（preview 不等 turn 结束） |
| **C2** | auto-follow edits 默认开；手动选文件则本 turn 暂停 |
| **C3** | tool meta：`paths[]` / `diff?` / `firstChangedLine?` |
| **C4** | Changes 与 inline diff 同源；summary 实时 |

### D. 编辑工具

| ID | 需求 |
|----|------|
| **D1** | `apply_patch` 首选（Codex 语义子集） |
| **D2** | `edit_file` 多 edits + 唯一性 + 有限 fuzzy + CRLF |
| **D3** | 同文件 mutation 串行队列 |
| **D4** | 失败返回上下文/行号/多匹配信息 |
| **D5** | write 大内容 enforcement |
| **D6** | UI/模型真实路径展示 |
| **D7** | 简单任务防过度委派（prompt + 可选 soft-block） |

### E. Context

| ID | 需求 |
|----|------|
| **E1** | Context Source Registry |
| **E2** | Context Epoch |
| **E3** | Safe boundary 合并 mid-conversation system update |
| **E4** | sources：core/permission/skills/agents/cwd/open_file/diff_hot/terminal_pin/goal/memory |
| **E5** | 「修这个」命中当前预览文件 |
| **E6** | unavailable = stale-while-revalidate |

### F. 终端

| ID | 需求 |
|----|------|
| **F1** | project session ≥1 PTY，cwd 对齐 |
| **F2** | 切换 session 保留 scrollback |
| **F3** | scroll intent（pinned vs 用户上滚） |
| **F4** | 路径可点 |
| **F5** | 选区 → Composer / 修复快捷 |
| **F6** | Terminal 一等 tab，产品默认开 |

### G. Diff 批注

| ID | 需求 |
|----|------|
| **G1** | 行级 annotation CRUD |
| **G2** | Composer chip + Send 注入结构化块 |
| **G3** | 可测：outbound 含批注 |
| **G4** | 与 C3/E4 不冲突 |

### H. 并行 Worktree

| ID | 需求 |
|----|------|
| **H1** | 并行 N=2–5：worktree + session |
| **H2** | 状态机 UI |
| **H3** | 对比 + 采用方案 |
| **H4** | 删除 preflight（脏则不先杀 PTY） |
| **H5** | 主树不被污染 |
| **H6** | CLI 对齐 |

### I. Goal

| ID | 需求 |
|----|------|
| **I1** | UI 状态与完成标准 |
| **I2** | active driver 自动 continuation |
| **I3** | 结构化完成/阻塞；边界注入 |
| **I4** | 与 plan todos 职责划分 |

### J. 开局与 CLI

| ID | 需求 |
|----|------|
| **J1** | 空态：最近项目 / 打开文件夹 / sandbox |
| **J2** | session 列表 workspace 徽章 + 搜索跳转保持 |
| **J3** | CLI：session / worktree / diff / permission |
| **J4** | `--json` + HITL 退出码 |

### K. 观测

| ID | 需求 |
|----|------|
| **K1** | 本地可采集 TTFT / paint / edit→preview 等 |
| **K2** | 阶段 eval/e2e 轴登记 |
| **K3** | 流式压力不卡死 |

### L. 协议

| ID | 需求 |
|----|------|
| **L1** | 新字段 `@hip/protocol`，旧客户端可忽略 |
| **L2** | surface 双读兼容 |
| **L3** | 契约测试 |

### U. 界面体验 — 对话输出与右侧智能体面板

> 本类是 **产品可见的 UX 迭代**，与 A/B/C 性能与工具数据配合；对照 §2.1。

#### U.1 对话输出（Transcript）

| ID | 需求 | 对照 |
|----|------|------|
| **U1** | **Turn 视觉层次**：每条助手消息固定三区 — Process rail（过程）→ Answer（答案）→ Meta（耗时/tokens/操作）。答案区字号/对比度高于过程区；过程区使用次要色与紧凑行高 | OpenHands 事件分型；Codex turn 块 |
| **U2** | **渐进工具卡片（默认可见）**：running turn 以卡片流展示工具（图标 + titleHint + 状态 + 可选一行摘要），**不**再把唯一入口藏进需点击的 ActivityBar；ActivityBar 可保留为**折叠后的摘要条** | Pi collapsed 行；Claude/Codex 式进度 |
| **U3** | **推理 / Thinking**：独立 disclosure；默认折叠为「思考了 Ns」或摘要一行；设置项「显示推理摘要」（对齐 OpenCode reasoningSummaries 语义）；流式推理不抢答案滚动焦点 | OpenCode；OpenHands `thought-event-message` |
| **U4** | **首帧与流式态**：user 发送后立即出现 assistant 占位（skeleton 或「正在处理」+ 可选 preamble 槽）；流式答案轻量渲染（A3）；完成瞬间无布局跳变（预留 meta 高度） | OpenCode stream 稳定几何 |
| **U5** | **代码块体验**：一键复制、换行切换、语言标签；`apply`/「插入 Composer」可选；超长 fence 默认限高 + 展开 | 桌面 coding UI 标配 |
| **U6** | **工具分组**：连续同 category（search/read/browse）可折叠为「搜索 3 次」组，组内可展开（复用/强化 `ToolCallGroup`） | 降噪 |
| **U7** | **子代理在对话内**：SubAgentCard 展示 task 摘要、状态点、耗时；running 时显示**最新工具一行**；点击「在 Agents 中打开」切右侧并 focus（U10） | Orca agent row；OpenHands |
| **U8** | **消息操作**：复制、重新生成、引用、调试导出保持；危险操作确认；streaming 中隐藏或禁用会破坏状态的操作 | — |
| **U9** | **密度**：`comfortable` \| `compact` 阅读密度（行距/padding），持久化到 ui 设置 | OpenCode/IDE 习惯 |
| **U15** | **完成态折叠**：turn 结束后过程区默认折为摘要条（工具数/改文件数/耗时）；一键「展开过程」；用户手动钉开则记住至 session | Pi collapsed result |
| **U16** | **错误 / 中断 / 完成分型**：error、cancelled、HITL waiting、finished 使用独立视觉（色条/图标/文案），禁止与普通答案无差别混排 | OpenHands error/finish events |
| **U17** | **队列消息**：running 时用户再发送进入队列时，Composer 上方 dock 显示排队条数/预览，可折叠（对齐 followupDock 语义）；发送后不伪装成已完成 turn | OpenCode followupDock |
| **U18** | **Meta 行统一**：耗时、tokens、可选费用、模型短名同一 meta 行；不与过程工具行抢宽度 | OpenCode context stats 思路 |

#### U.2 右侧智能体 / Workbench 输出

| ID | 需求 | 对照 |
|----|------|------|
| **U10** | **焦点同步**：`focusedCallId` / `focusedAgentId` / `focusedPath`；对话点工具 → 右侧切 Files 或 Agents 并高亮；Agents 点卡片 → 对话 scroll 到 turn；写工具默认 path 焦点（配合 C1） | Orca focused row |
| **U11** | **Agents 面板 Live 模式**：默认视图 = **当前 running turn** 置顶；展示 agent 树（supervisor + children）、每节点 **status 点**（running/done/error/waiting）、**当前工具名**、短输出尾部流；历史 turn 手风琴折叠 | Orca activity summary；OpenHands 可扫状态 |
| **U12** | **按工具类型的结果渲染**（对话展开态 + Agents 详情共用组件库）： | Pi per-tool renderer |
| | · `grep`/`glob`/`ls`：行列表 + 计数 | |
| | · `read_file`：路径 + 行号范围 + 限高代码 | |
| | · `run_script`：exit code 徽章 + stdout/stderr 分色 | |
| | · `edit`/`write`/`apply_patch`：inline diff（B3）+ 跳转 firstChangedLine | |
| | · `task`/`dispatch`/`task_batch`：子任务状态表 | |
| **U13** | **Tab 语义澄清**：`Agents` = 智能体运行；`Timeline` = git/checkpoint（文案/图标区分，避免「两个时间线」）；空态各 tab 有引导 CTA | OpenCode side panel 分区 |
| **U14** | **Live 条（可选常驻）**：session running 时 Workbench 顶或 Agents 顶显示 sticky strip：当前 agent · 当前 tool · 已用时 · 点按展开 Agents | Orca live working 点 |
| **U19** | **空态 / 加载态**：Agents 无 turn 时说明「发送消息后在此监控」；Files 无 cwd 引导打开项目；切换 tab 不闪白无结构 | — |
| **U20** | **动效**：status 点 pulse、流式光标尊重 `prefers-reduced-motion`；高亮 focus 2s 后淡出（对齐消息搜索高亮） | a11y |
| **U21** | **输出限高与虚拟化**：单工具 output、子代理 output、Agents 列表在极端 turn 下可滚动且不撑破布局；与 A5 协调 | OpenCode 长会话 |
| **U22** | **协作结构可读**：多 agent 时保留/强化 `CollaborationStructure`，并与 U11 树一致（同一数据 `groupByAgent`） | 现有 hip + OpenHands |

#### U.3 共享组件与测试挂钩

| ID | 需求 |
|----|------|
| **U23** | 抽取 `ToolResultView`（按 name 分发 U12），对话 `ToolCallRow` 与 `AgentCard`/`ToolTrace` **必须复用**，禁止两套 markdown/pre 逻辑分叉 |
| **U24** | 稳定 `data-testid`：`message-process`、`message-answer`、`tool-card`、`tool-card-running`、`agent-card`、`agent-live-strip`、`focus-highlight` 等，供 e2e |
| **U25** | i18n：过程/状态/空态文案进 `en`/`zh-CN`/`zh-TW`，无硬编码中文残留在组件 |

---

## §5 渐进交付阶段

每阶段结构：**目标 → 范围（需求 ID）→ 非本阶段 → 实现要点 → e2e 门禁 → 退出标准**。

**全局回归（每一阶段结束都要跑）：**

```bash
yarn test:e2e:gate          # 既有 smoke + core + harness（无付费 LLM）
# + 本路线已关闭阶段的 tag，见各阶段 E2E_GREP
```

约定 tag 前缀：`@smooth-p0` … `@smooth-p5`（文件可放 `e2e/specs/smooth-*.spec.ts`）。

---

### P0 — 基线加固与可测骨架（约 1–2 周）

**用户感知：** 现有 Chat/Code 不更差；后续改动有稳定 e2e 挂钩点。

| 项 | 内容 |
|----|------|
| **范围** | **L1–L3** 最小扩展位（可先空 meta）；**K2** 登记本路线 tag；修复已知 flaky 阻挡 gate 的用例；双 surface **现状**行为固化测试 |
| **需求 ID** | L1（预留）、L2 文档化映射、K2 |
| **不做** | A–J 新 UX（除非修 bug） |

#### P0 e2e（MUST）

| 用例 ID | 场景 | 断言 | Tag |
|---------|------|------|-----|
| P0-E1 | App 冷启动到可交互 | 主 shell / composer 可见 | `@smooth-p0` `@smoke` |
| P0-E2 | Chat 新建 sandbox 会话 | 可创建 session 或进入 draft 可发送路径 | `@smooth-p0` |
| P0-E3 | Code/project 选 cwd 后可进入会话 | Folder/project 路径可用（对齐现 NewConversation） | `@smooth-p0` |
| P0-E4 | 会话切换不炸 | 两 session 来回，无白屏/错误 toast 风暴 | `@smooth-p0` |
| P0-E5 | 既有 write→changes harness | 保持 `harness-cancel-keeps-diff` / `diff-workspace` 等绿 | 既有 gate |

**命令：**

```bash
yarn test:e2e:gate
E2E_GREP=@smooth-p0 yarn test:e2e
```

**退出：** gate + `@smooth-p0` 全绿；无新增 P0 外行为回归。

---

### P1 — 跟手：流式 + 对话过程 UI + 写盘跟随（约 2–3 周）

**用户感知：** 流式更顺；对话里**默认看见**过程卡片与清晰答案区；Code 写下文件右侧马上跟上。

| 项 | 内容 |
|----|------|
| **范围** | **A1–A4**，**B1–B2**，**C1–C2**，**C3** 最小（paths），**K1/K3**，**U1 U2 U3 U4 U6 U15 U16 U18 U24**（对话层），**U10** 路径焦点最小（点 path → Files/preview） |
| **需求 ID** | A1–A4 B1–B2 C1–C2 C3(partial) K1 K3 U1–U4 U6 U10(partial) U15 U16 U18 U24 |
| **不做** | A5；B3 完整 diff；D apply_patch；U11 Live Agents 全量；F/G/H/I/E |

#### P1 e2e（MUST，unpaid / harness）

| 用例 ID | 场景 | 断言 | Tag |
|---------|------|------|-----|
| P1-E1 | Harness 模拟 token 流 | `[data-testid=message-answer]` 出现文本；无崩溃 | `@smooth-p1` |
| P1-E2 | 上滚后不强制贴底 | 用户 scroll 位置保持；「回底部」才贴底 | `@smooth-p1` |
| P1-E3 | 工具卡片默认可见 | `tool:started` → `[data-testid=tool-card-running]` **无需点击**可见 title/path | `@smooth-p1` |
| P1-E4 | Turn 层次 | 同条消息存在 `message-process` 与 `message-answer` 分区 | `@smooth-p1` |
| P1-E5 | 推理折叠 | 有 reasoning 时默认不占满答案区；可展开 | `@smooth-p1` |
| P1-E6 | 路径可点 | tool path → preview/active path | `@smooth-p1` |
| P1-E7 | write 跟随 | turn 未 complete 前 preview 更新 | `@smooth-p1` |
| P1-E8 | auto-follow 暂停 | 手动选文件后不被抢焦点 | `@smooth-p1` |
| P1-E9 | 完成态摘要 | `message:complete` 后过程可折为摘要条（或等价） | `@smooth-p1` |
| P1-E10 | 错误分型 | harness error/cancel → 可见错误/中断样式（非普通答案） | `@smooth-p1` |
| P1-E11 | 回归 P0 | `@smooth-p0` + gate | 回归 |

**辅助单测：** token coalesce；write 跟随 effects；Turn 分区组件 shallow render。

```bash
yarn test:e2e:gate
E2E_GREP='@smooth-p0|@smooth-p1' yarn test:e2e
```

**退出：** 上表全绿；dogfood：过程/答案一眼可分、工具不用点开才知道。

---

### P2 — 改得对：编辑工具 + 类型化工具渲染 + inline diff（约 2–3 周）

**用户感知：** 少重试；对话里直接看 diff / grep 列表 / shell 退出码；代码块好用。

| 项 | 内容 |
|----|------|
| **范围** | **D1–D7**，**B3 B5**，**C3–C4**，**U5 U12 U23 U25**，强化 **U2** 展开态 |
| **不做** | E 全量；F 终端产品化；U11 完整 Live Agents |

#### P2 e2e（MUST）

| 用例 ID | 场景 | 断言 | Tag |
|---------|------|------|-----|
| P2-E1 | apply_patch 成功 | 文件变更；tool 卡 **inline diff** 可见 | `@smooth-p2` |
| P2-E2 | edit 失败可行动 | 非仅 `not found` 的错误 UI | `@smooth-p2` |
| P2-E3 | fuzzy 匹配成功 | fixture 可 edit | `@smooth-p2` |
| P2-E4 | 同文件串行写 | 无撕裂 | `@smooth-p2` |
| P2-E5 | Changes ↔ inline | summary 与 path 一致 | `@smooth-p2` |
| P2-E6 | 真实路径展示 | UI 相对/绝对真实路径 | `@smooth-p2` |
| P2-E7 | grep/ls 专用渲染 | harness 工具结果为列表而非纯 JSON 墙 | `@smooth-p2` |
| P2-E8 | run_script 退出码 | 可见 exit 徽章或等价 | `@smooth-p2` |
| P2-E9 | 代码块复制 | fence 上 copy 控件可点（clipboard mock/权限允许时） | `@smooth-p2` |
| P2-E10 | ToolResultView 同源 | 对话展开与（若已挂）Agents 详情 class/testid 一致策略 | `@smooth-p2` |
| P2-E11 | 回归 P0–P1 | gate + smooth tags | 回归 |

```bash
yarn test:e2e:gate
E2E_GREP='@smooth-p0|@smooth-p1|@smooth-p2' yarn test:e2e
```

**退出：** 编辑单测 + P2 e2e 全绿；工具结果「像产品不是日志」。

---

### P3 — 工作环：终端 + Diff 批注 + 右侧 Agents Live（约 3 周）

**用户感知：** 测改 / review 在 hip 内完成；**右侧 Agents 实时监控**多 agent，与对话双向跳转。

| 项 | 内容 |
|----|------|
| **范围** | **F1–F6**，**G1–G4**，**B4**，**U7 U10(full) U11 U13 U14 U19 U20 U21 U22** |
| **不做** | H 并行 Studio；E 全 epoch（terminal_pin 数据通路可预留） |

#### P3 e2e（MUST）

| 用例 ID | 场景 | 断言 | Tag |
|---------|------|------|-----|
| P3-E1 | Terminal tab | 可见可聚焦 | `@smooth-p3` |
| P3-E2 | PTY cwd | 与 session 根一致 | `@smooth-p3` |
| P3-E3 | scroll intent | 上滚不跟飞；回底跟随 | `@smooth-p3` |
| P3-E4 | 选区回灌 Composer | chip/插入 | `@smooth-p3` |
| P3-E5 | 终端路径可点 | 打开 preview | `@smooth-p3` |
| P3-E6 | session 切换 scrollback | 保留 | `@smooth-p3` |
| P3-E7 | Diff 批注注入 | outbound 含结构化块 | `@smooth-p3` |
| P3-E8 | Agents Live | harness 多 agent running → Agents tab 可见 status 点 + 当前工具 | `@smooth-p3` |
| P3-E9 | 对话 → Agents 跳转 | 点 SubAgentCard/tool「在 Agents 打开」→ tab=agents + focus | `@smooth-p3` |
| P3-E10 | Agents → 对话跳转 | agent-jump-turn → 消息进入视口/高亮 | `@smooth-p3` |
| P3-E11 | Live strip | running 时 `agent-live-strip`（或等价）可见 | `@smooth-p3` |
| P3-E12 | Tab 语义 | Timeline 与 Agents 文案/testid 不混用 | `@smooth-p3` |
| P3-E13 | 回归 P0–P2 | gate + tags | 回归 |

```bash
yarn test:e2e:gate
E2E_GREP='@smooth-p0|@smooth-p1|@smooth-p2|@smooth-p3' yarn test:e2e
```

**退出：** 终端 + 批注 + **Agents 与对话联动** dogfood；P3 e2e 全绿。

---

### P4 — 大脑一致：Context Epoch + 会话统一 + CLI + 阅读体验（约 2–3 周）

**用户感知：** 「修这个」准；开局不懵；可脚本化；长会话与排队消息不乱。

| 项 | 内容 |
|----|------|
| **范围** | **E1–E6**，**J1–J4**，**A5**，**U8 U9 U17**，会话 **workspaceMode** 主路径（§3.1 终态） |
| **不做** | H 并行；I goal driver 全量（goal source 可占位） |

#### P4 e2e（MUST）

| 用例 ID | 场景 | 断言 | Tag |
|---------|------|------|-----|
| P4-E1 | 空态 CTA | 可见打开文件夹/最近项目；能进入 project 会话 | `@smooth-p4` |
| P4-E2 | open_file context | 预览某文件后 harness/agent 路径命中（可用 debug 面板或 inject 断言 context 含 path；或固定 mock runner） | `@smooth-p4` |
| P4-E3 | permission/cwd 变更 | 变更后下一 turn 行为/可观测 context 更新（不要求展示 raw system） | `@smooth-p4` |
| P4-E4 | compaction epoch | 触发 compact 后会话仍可用、无错误状态 | `@smooth-p4` |
| P4-E5 | surface 兼容 | 旧 chat/code 入口仍能工作或重定向 | `@smooth-p4` |
| P4-E6 | CLI session | `hip session create/send/status`（或 yarn cli）无 UI 完成一轮 harness | `@smooth-p4`（可 CLI 集成测 + 薄 e2e） |
| P4-E7 | 长列表/虚拟化 | 大量消息 fixture 下可滚动、跳转 message 仍可用 | `@smooth-p4` |
| P4-E8 | 密度设置 | compact/comfortable 切换后 transcript padding 变化且持久 | `@smooth-p4` |
| P4-E9 | 队列 dock | running 时再发送 → followup dock 可见排队（若产品启用队列） | `@smooth-p4` |
| P4-E10 | 回归 P0–P3 | 全 tag | 回归 |

```bash
yarn test:e2e:gate
E2E_GREP='@smooth-p0|@smooth-p1|@smooth-p2|@smooth-p3|@smooth-p4' yarn test:e2e
yarn cli:test   # 若 CLI 有单测
```

**退出：** Context/会话/CLI 文档与 e2e 齐；无「双宇宙」主路径必经。

---

### P5 — 规模化：并行 Worktree + Goal（约 2–4 周）

**用户感知：** 可并行比方案；长任务有 goal 状态。

| 项 | 内容 |
|----|------|
| **范围** | **H1–H6**，**I1–I4**，E4 `goal.state` 接真 |
| **不做** | 远程/Mobile/Design Mode/自动 merge 主分支 |

#### P5 e2e（MUST）

| 用例 ID | 场景 | 断言 | Tag |
|---------|------|------|-----|
| P5-E1 | 并行创建 N=2 | 两 slot/session/worktree 出现；状态非空 | `@smooth-p5` |
| P5-E2 | 主树干净 | 并行运行中 primary `git status` 无 agent 污染（fixture repo） | `@smooth-p5` |
| P5-E3 | 采用方案 | select slot 后进入对应 session | `@smooth-p5` |
| P5-E4 | 删除 preflight | 脏 worktree 删除失败且 **PTY/终端不无故消失**（或明确报错） | `@smooth-p5` |
| P5-E5 | Goal UI | 创建/暂停/恢复或 blocked 展示；complete 后清除 | `@smooth-p5` |
| P5-E6 | Goal continuation | active 时 harness 模拟多 turn 自动续（若可注入 driver） | `@smooth-p5` |
| P5-E7 | CLI worktree/parallel | list/create 与 UI 一致 | `@smooth-p5` |
| P5-E8 | 并行 slot 在 Agents/侧栏状态点 | 与 H2 一致可扫 | `@smooth-p5` |
| P5-E9 | **全路线回归** | gate + `@smooth-p0`…`@smooth-p5` | 回归 |

```bash
yarn test:e2e:gate
E2E_GREP='@smooth-p0|@smooth-p1|@smooth-p2|@smooth-p3|@smooth-p4|@smooth-p5' yarn test:e2e
# 建议 nightly：
# E2E_LIVE_LLM=1 yarn test:e2e:live 或 eval-smoke
```

**退出：** §7 终态 dogfood 清单通过；全 tag e2e 绿 → **路线完成**。

---

## §6 e2e 工程规范（所有阶段共用）

### 6.1 原则

| 规则 | 说明 |
|------|------|
| **无异常** | 用例不得吞错；失败必须有截图（`E2E_SCREENSHOT_DIR`）与可定位 selector |
| **确定性** | unpaid 用例禁止依赖真实 LLM 输出文案；用 harness / `sessionService` 模拟事件 / fixture agent |
| **可并行注意** | 固定 `E2E_DATA_DIR` 或每测隔离；不抢死端口 1420 |
| **Tag** | 新文件 `e2e/specs/smooth-pN-*.spec.ts`；describe/it 带 `@smooth-pN` |
| **Page objects** | 复用 `e2e/page-objects`；新 Workbench/Terminal/Annotation 抽 PO |
| **禁止 skip 顶门禁** | `it.skip` 不得进入阶段退出标准；flaky 必须修或降级为已知 issue 并挡发布 |
| **超时** | 遵循 `e2e/README` tier；流式/PTY 可单测提高 timeout，需注释原因 |

### 6.2 每阶段 PR / 合并检查表

```text
[ ] 阶段范围需求 ID 已实现或显式移出（更新本 spec 修订记录）
[ ] 新增/更新 unit 覆盖热路径
[ ] 新增 @smooth-pN e2e 且本地绿
[ ] yarn test:e2e:gate 绿
[ ] 回归：所有已关闭阶段 @smooth-p* 绿
[ ] 无 console error 风暴（e2e 可断言无 uncaught）
[ ] 协议变更有 contract test
[ ] 功能 flag：若有，默认对 dogfood 构建为阶段目标态
```

### 6.3 CI 建议

| Pipeline | 内容 |
|----------|------|
| PR | `yarn test:e2e:gate` + 变更触及的 `@smooth-pN` |
| merge to dev | gate + **全部已发布阶段** smooth tags |
| nightly | 全 smooth tags + 可选 live/eval |

### 6.4 「无异常」的操作性定义

e2e 通过外，阶段退出前抽查：

- 无未处理 promise / React error boundary  
- Stop/取消后 session 回 idle，无永久 running  
- 断线重连后可再发（若本阶段触达连接逻辑）  
- 权限 HITL 弹层可取消且不卡死（回归 harness-permission）

---

## §7 路线完成时的终态验收（P5 退出）

在真实 git 仓库 dogfood：

1. ≤30s 进入 project 并发出消息  
2. 对话内工具卡片默认可见；**过程区 / 答案区层次清晰**  
3. edit/patch 后 ≤300ms 级 preview 更新 + **inline diff**  
4. 右侧 **Agents** 显示 live 状态；与对话 **双向跳转**  
5. 终端失败 → 回 Composer → 再改  
6. Diff 批注驱动修改  
7. 并行 N=3，主树干净，preflight 删除  
8. Goal 长任务状态正确  
9. Session 切换终端/scroll 意图正确  
10. CLI 无 UI 完成一轮  
11. sandbox 快聊 + 产物预览仍可用  

自动化：§5 P0–P5 全部 e2e tag + `yarn test:e2e:gate`。

---

## §8 阶段总览（一览）

| 阶段 | 主题 | 需求焦点 | UI 体验焦点（U*） | e2e tag | 依赖 |
|------|------|----------|------------------|---------|------|
| **P0** | 基线 + 可测骨架 | L/K2 | testid 挂钩点 | `@smooth-p0` | — |
| **P1** | 跟手 + **对话过程 UI** | A*, B1–2, C1–2 | U1–4, U6, U15–16, U18 | `@smooth-p1` | P0 |
| **P2** | 改得对 + **类型化渲染** | D*, B3/5 | U5, U12, U23 | `@smooth-p2` | P1 |
| **P3** | 测改/review + **Agents Live** | F*, G* | U7, U10–14, U19–22 | `@smooth-p3` | P1（建议 e2e 含 P2） |
| **P4** | Context + 会话 + CLI | E*, J*, A5 | U8–9, U17 | `@smooth-p4` | P1 |
| **P5** | 并行 + Goal | H*, I* | 并行状态进侧栏/Agents | `@smooth-p5` | P3+P4 |

**并行开发：** P3 与 P2 可双轨；**合并发布顺序**建议 P2 → P3（工具渲染稳定后再接 Agents 复用 U23）。P5 不得先于 P3/P4 稳定。

---

## §9 非目标（整条路线不做）

- 迁 Electron / 整仓 Rust agent  
- SSH 远程、Mobile、Design Mode、Computer Use、商店级自动更新（upgrade 另轨）  
- 自动 merge 多 worktree 到主分支 / 自动开 PR  
- 用 skip e2e 换进度  

---

## §10 风险

| 风险 | 缓解 |
|------|------|
| 阶段范围蔓延 | 严格按 §5 需求 ID；新增能力先进修订记录再排期 |
| e2e flaky | P0 先稳 gate；PTY 用例隔离 data dir；禁止 sleep 盲等 |
| 双 surface 迁移痛 | P4 双读；P0–P3 e2e 双路径覆盖 |
| apply_patch 成本 | P2 语义子集 + 夹具；edit 多 edits 保底 |
| 并行磁盘泄漏 | H N 上限 + preflight + 清理命令 |

---

## §11 锁定决议

```text
策略       = 渐进交付 P0→P5；终态能力见 §4（含 U 界面体验）
双通道     = Transcript（可读过程+答案）× Workbench Agents（live 监控）同源双向跳转
门禁       = 每阶段 MUST e2e（@smooth-pN）+ yarn test:e2e:gate + 已关闭阶段回归
异常       = e2e 失败或 flaky 未修 = 阶段未完成
最佳实践   = OpenCode / Codex / Pi / Orca / OpenHands / Kimi → §2 / §2.1 / §4.U
栈         = Tauri + React + sidecar
```

---

## §12 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 初版分析 + 渐进草案 |
| 2026-07-18 | 改为一次性完整交付 |
| 2026-07-18 | 改回渐进交付 P0–P5；每阶段强制 e2e |
| 2026-07-18 | **增加界面体验迭代**：§1.3 / §2.1 / §3.3 双通道；**§4.U** 对话输出 + 右侧智能体；P1–P5 映射与 e2e 扩充 |
