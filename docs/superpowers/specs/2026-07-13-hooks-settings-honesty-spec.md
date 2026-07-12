# 挂钩配置页诚实化 Spec（声明 vs 运行时路径）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-13 |
| 状态 | **Implemented** |
| 范围 | 设置页「挂钩配置」：文案、图例、事件说明、展开面板、可选路径 chip；**不改** sidecar 触发逻辑 |
| 前置 | [`2026-07-12-hooks-workflow-parity-spec.md`](./2026-07-12-hooks-workflow-parity-spec.md) 已实现：主循环 / task 子 agent / 工作流 agent 节点共享 `HookRegistry` 工具钩 |
| 现状代码 | `src/components/account/HookConfig.tsx`、`HookLifecycleDiagram.tsx`、`hookCatalog.ts`、`hookFishbone.ts`；`src/i18n/{en,zh-CN,zh-TW}.ts`；扫描侧 `src-tauri` plugins hook scan |
| 关联 | 业务分析：页面 = 静态声明总览；runtime = 多路径执行（对话 / 子 agent / 工作流），语义不完全等同 |
| 关联 plan | [`../plans/2026-07-13-hooks-settings-honesty.md`](../plans/2026-07-13-hooks-settings-honesty.md) |

---

## 1. Overview

### 1.1 问题

Hooks **runtime 贯通**后，设置页与真实行为的主要矛盾不再是「工具钩不跑」，而是 **信息架构与用词过满**：

| 用户从页面读到的 | 实际 |
|------------------|------|
| 「已配置」= 会生效 | 仅表示**静态扫描到声明**；加载失败 / external 会话 / 路径策略仍可不跑 |
| 鱼骨 = 唯一生命周期 | 产品有三条线：主循环、task 子 agent、智能体工作流（run 级） |
| `PermissionRequest` 可 ask 用户 | 工作流默认无 HITL；ask 无法「问人」 |
| `Stop` + continue 再跑一轮 | **仅主会话**可靠；工作流忽略 continue |
| `TurnStart` = 每个 agent 节点一轮 | 工作流是 **整个 DAG run 一次** |
| 高亮节点 = 当前会话已注册 | 与当前会话类型无关；external ACP 不加载插件 hook |

页面定位仍是只读总览，**正确**；但文案若继续用「配置/生效」混谈，会在工作流场景制造二次误导。

### 1.2 产品定位（锁定）

**挂钩配置页 = 插件声明了哪些生命周期事件的只读总览。**

- **不是** 运行时探针 / 会话调试台  
- **不是** 可编辑 hook 编辑器  
- **不是** 保证「声明的事件在所有路径、所有会话类型上行为完全一致」  

运行时规则仍以 sidecar + workflow-parity spec 为准；本页只负责 **诚实表述**。

### 1.3 目标

| ID | 目标 |
|----|------|
| H1 | **术语诚实** — 图例与节点 badge 区分「已声明 / 未声明」，避免「已配置 = 已生效」 |
| H2 | **路径可见** — 用户一眼看到：主循环 · 子 agent · 工作流 agent 节点；不含 gate / 外部 ACP |
| H3 | **事件说明带路径脚注** — 尤其 `PermissionRequest`、`Stop`、`TurnStart`、`SessionStart`、`UserPromptSubmit` |
| H4 | **展开面板补生效范围** — 不只列插件路径，还有一句固定「在哪些产品路径会 fire」 |
| H5 | **数据源一句说清** — 声明来自安装插件静态扫描，非当前会话 live registry |
| H6 | **三语一致** — en / zh-CN / zh-TW；translation-keys 测试绿 |
| H7 | **最小 UI 改动** — 不重做鱼骨布局；不新增设置页导航结构 |

### 1.4 非目标

| ID | 非目标 |
|----|--------|
| NG1 | 改 sidecar fire 顺序、策略 A/B、Stop continue 行为 |
| NG2 | 运行时「最近一次 hook fire」遥测 / 调试条（P2 可选，本期不做） |
| NG3 | 工作流面板与挂钩页双向深链（P1 可选，本期可只做文案） |
| NG4 | 鱼骨拆成多图（对话图 / 工作流图） |
| NG5 | 可编辑 hook、在线试跑 handler |
| NG6 | 扫描算法升级为 AST 级（保持现有 CJS 文本扫描） |
| NG7 | 新增 `SubagentStart/Stop` 等协议事件到图上 |

### 1.5 原则

1. **Declare ≠ Dispatch** — 高亮只表达声明；路径脚注表达 dispatch 范围。  
2. **One spine, many footnotes** — 保留单脊鱼骨，用文案解决多路径，不画三张图。  
3. **Surgical** — 以 i18n + 少量 JSX 为主；`hookFishbone` 布局不动。  
4. **Fail loud in words** — 特殊语义（工作流无 HITL、Stop 不续跑）必须写在用户看得到的地方。  
5. **Match runtime docs** — 与 `packages/sidecar/src/session/hooks/README.md` 路径表一致，避免双源说法。

---

## 2. 背景：两层模型

```text
┌─────────────────────────────────────────────────────────┐
│  挂钩配置页（本 Spec）                                    │
│  PluginMeta.hookEvents / hookCount  ← 静态扫描            │
│  「声明了什么」                                           │
└───────────────────────────┬─────────────────────────────┘
                            │ 用户用插件 CJS 配置
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Sidecar Session.hooks（runtime，已实现）                 │
│  loadPluginComponents → register → fire                   │
│  主循环 / task / workflow agent 节点                      │
│  「这次会话会不会跑」                                     │
└─────────────────────────────────────────────────────────┘
```

| 维度 | 声明层（本页） | 运行层（sidecar） |
|------|----------------|-------------------|
| 数据 | 磁盘插件文件扫描 | `require` + function handler |
| 时间 | 打开设置页 / 刷新插件列表 | 会话创建 / reloadPlugins |
| 会话类型 | 无关 | external 跳过插件 hook |
| 高亮 | 有声明即亮 | 有注册且路径 fire 才生效 |

---

## 3. 信息架构

### 3.1 页面结构（自上而下）

```text
[标题] 挂钩配置
[introShort] 只读 + 路径范围 + 点节点 + 改文件
[可选 summary] N 插件 · M 条 · K 事件已声明

[路径 chip 行] 主循环 | 子 agent | 工作流 agent | 不含 gate/ACP   ← 新增
[数据源 hint]  高亮 = 静态扫描到的声明，非当前会话探针           ← 新增（可并入 legend 行）

[图例] 已声明 | 未声明 | 点击展开
[鱼骨图] 不变
[展开面板] 事件说明 + 路径脚注 + 插件列表                       ← 增强
[空态] 无声明提示
```

### 3.2 不改的结构

- 设置导航 `SettingsPageId` / 命令面板入口  
- React Flow 鱼骨节点坐标与边  
- 点击展开/收起交互  
- 插件 dir 列表展示  

---

## 4. 术语表（规范性）

| 旧用词（避免主导） | 新用词（UI 主文案） | 含义 |
|--------------------|---------------------|------|
| 已配置 | **已声明** | 静态扫描到该 event 出现在某插件 hooks 中 |
| 未配置 | **未声明** | catalog 内事件，无任何已装插件声明 |
| 已配置的挂钩 | **已声明的挂钩**（summary 可保留「条」计数） | hook 条目计数仍可说「条」 |
| On / Off（en 图例） | **Declared / Not declared** | 与 zh 对齐 |

**代码标识符**：可保留 `configured` / `data-configured` 内部命名（避免大范围 rename），**用户可见字符串**必须换。测试若断言 i18n key 文本，同步改 mock/期望。

**「条」vs「事件」**：

- `hookCount` 汇总 → 「N 条」= 扫描到的 hook 条目数（可含重复 event）  
- `eventsOn` → 「K 个事件已声明」  

---

## 5. 文案规格

### 5.1 introShort（三语）

**意图**：只读、路径、声明源、如何改。

**zh-CN 目标稿**（定稿可微调字数，语义不可删）：

> 只读概览：展示插件**声明**的生命周期事件（静态扫描，非当前会话探针）。工具类挂钩生效于主循环、task 子智能体与工作流 agent 节点；不含 gate 与外部 ACP 会话。点击节点查看来源与路径说明；修改请编辑插件 hooks 文件。

**en 目标稿**：

> Read-only overview of lifecycle events **declared** by plugins (static scan, not a live session probe). Tool hooks run on the main loop, task subagents, and workflow agent nodes—not gates or external ACP sessions. Click a node for sources and path notes; edit plugin hook files to change config.

**zh-TW**：与 zh-CN 同义繁体。

> 现有 introShort 已含路径一半信息；本 Spec 要求补上 **「声明 / 静态扫描 / 非探针」** 三要素。

### 5.2 图例（legend）

| Key（建议） | zh-CN | en |
|-------------|-------|-----|
| `diagram.legendConfigured` → 语义改为已声明 | 已声明 | Declared |
| `diagram.legendAvailable` | 未声明 | Not declared |
| `diagram.configuredBadge`（节点上） | 已声明 | Declared |
| `diagram.notConfigured` | 未声明 | Not declared |
| 新增 `diagram.scanHint`（可选独立 key） | 高亮来自插件文件静态扫描 | Highlight = static plugin scan |

节点 badge 旁仍可显示 `· N` 来源数（声明该 event 的插件数）。

### 5.3 Summary 行

| Key | 调整 |
|-----|------|
| `eventsOn` | 「{{count}} 个事件已声明」/「{{count}} events declared」（已接近，确认用「声明」） |
| `configuredSummary` | 可保留「插件 · 条」；不必改成「运行中」 |

### 5.4 路径 chip（新增 UI + i18n）

展示 4 个 chip（或 3+1 排除项），**非交互**（本期不筛选鱼骨）：

| Chip id | zh-CN | en | 对应 runtime |
|---------|-------|-----|--------------|
| `pathMain` | 主循环 | Main loop | processInput + runTurn + ToolRunner |
| `pathSubagent` | 子智能体 | Task subagents | runSubagent / managed |
| `pathWorkflow` | 工作流 agent | Workflow agents | runWorkflowTurn worker/invoker |
| `pathExcluded` | 不含 gate / 外部 ACP | Not gates / external ACP | 明确排除 |

可选第五条弱文案：`pathWorkflowNote` — 「工作流回合事件按整次 run，非每节点」。

### 5.5 事件说明（`settings.hooks.events.*`）

每条 = **主语义一句** + **路径脚注一句**（可用空格或「·」连接；或展开面板用独立 key `events.notes.*`）。

| Event | 主语义（保持/微调） | 路径脚注（必须） |
|-------|---------------------|------------------|
| `SessionStart` | 会话首条消息路径触发 | 工作流直入 `workflow:run` 不重复；deny 是否阻断以实现为准（若仍 void，脚注写「当前实现为通知级，勿依赖 deny 中止」） |
| `UserPromptSubmit` | 用户提交后、模型前；deny → HOOK_DENIED | 对话：processInput；工作流：`workflow:run` 有文本时；`message+dag` 不双 fire |
| `TurnStart` | 回合/运行开始前；deny 可中止 | **主会话每 turn 一次；工作流每 DAG run 一次（非每节点）**；子 agent 不单独 fire |
| `PreToolUse` | 工具前 allow/deny/ask/modify | 主循环、子 agent、工作流 **agent 节点**；**gate 不 fire** |
| `PostToolUse` / `Failure` | 工具后 | 同上 |
| `PermissionRequest` | HITL 弹窗前 auto-allow/deny/ask | **主要用于对话权限流**；工作流默认无 HITL，一般不弹窗；ask 在无 transport 时无法问用户 |
| `Stop` | 收尾；主会话 continue+prompt 可续跑 | **continue 仅主会话**；工作流 run 结束会 fire 但不注入第二轮 DAG |
| `TurnComplete` | 结束 fire-and-forget | 主会话每 turn；工作流每 run；子 agent 结束不单独 fire |
| `Activity*` | Activity 生命周期 | **依赖会话 activity 路径**；纯 workflow:run 通常不走；与工具环并行概念保留 |

**SessionStart deny 脚注**：实现前对照 `session-turn-runner`——若仍为 `void fire`，脚注必须诚实；若后续 hardening，再改文案。本期以代码为准写脚注，**禁止**写「一定可中止」若代码不阻断。

### 5.6 展开面板（ExpandPanel）

现有：

- event 名 + 主描述  
- 插件列表 / 空提示  
- 收起  

新增：

1. **路径范围行**（所有事件统一组件，内容按 event 查表）：  
   - Key 建议：`diagram.pathScope.<Event>` 或一张 `EVENT_PATH_SCOPE: Record<HookEvent, i18nKey>`  
2. **数据源微文案**（面板底部或顶部一次）：  
   - 「下列插件通过静态扫描声明了此事件；是否在本会话注册取决于插件加载与会话类型。」

空态 `expandEmptyHint`：改为「未有插件**声明**此事件。」

### 5.7 空态 / 其它残留文案

| Key | 调整 |
|-----|------|
| `configuredEmpty` / `configuredEmptyHint` | 「尚未声明」 |
| `configuredDesc`（若仍引用） | 强调静态扫描 |
| `howToStep3`（若页内仍不用可不动） | 与「声明计数」一致 |
| diagram `subtitle` / `subtitleFishbone`（若仍渲染） | 同步「声明」用语 |

---

## 6. UI 组件改动范围

### 6.1 必改

| 文件 | 改动 |
|------|------|
| `src/i18n/en.ts` | 全量 hooks 文案 |
| `src/i18n/zh-CN.ts` | 同上 |
| `src/i18n/zh-TW.ts` | 同上 |
| `HookLifecycleDiagram.tsx` | 图例 key 文案效果；路径 chip 行；ExpandPanel 路径脚注；badge 文案 |
| `HookConfig.tsx` | 可选：路径 chip 上移到标题区；或全部放 diagram 内（推荐 **diagram 内** 以免双处维护） |
| `HookConfig.test.tsx` | mock `t()` 返回 key 时，若断言可见中文则改；优先断言 testid / key |

### 6.2 建议小改

| 文件 | 改动 |
|------|------|
| `hookCatalog.ts` | 导出 `HOOK_EVENT_PATH_NOTE_KEYS` 与 `HOOK_EVENT_DESC_KEYS` 并列，保证 event 穷尽 |
| `packages/sidecar/.../hooks/README.md` | 已有路径表；补一句「设置页展示声明层」交叉引用本 Spec |

### 6.3 不改

| 文件 | 原因 |
|------|------|
| `hookFishbone.ts` | 布局与事件集合不变 |
| Rust `scan_hooks` | 扫描语义仍是声明 |
| protocol `HookEvent` | 无新事件 |
| workflow-runner | 本 Spec 零 runtime |

---

## 7. 路径范围矩阵（展开面板与 chip 的单一真相）

实现时用代码表 + i18n，避免 JSX 硬编码中文。

| Event | 主循环 | 子 agent | 工作流 agent | Gate | 外部 ACP | 面板摘要（zh 概念） |
|-------|--------|----------|--------------|------|----------|---------------------|
| SessionStart | 首轮 | — | 不重复 | — | 通常无插件 hook | 主要对话会话启动 |
| UserPromptSubmit | ✅ | — | run 有 text | — | — | 对话提交；workflow:run 有文本时 |
| TurnStart | 每 turn | — | 每 run | — | — | 对话每轮；工作流整 run |
| Pre/PostTool* | ✅ | ✅ | ✅ | ❌ | ❌ | 三工具路径；非 gate |
| PermissionRequest | HITL 时 | 有 approval 时 | 默认无 | — | ACP 自有权限 | 对话权限流为主 |
| Stop | ✅+continue | — | fire 无 continue | — | — | 续跑仅主会话 |
| TurnComplete | 每 turn | — | 每 run | — | — | 收尾通知 |
| Activity* | activity 路径 | — | 通常不 | — | — | 目标/预算路径 |

---

## 8. 验收标准

### 8.1 文案

| ID | 验收 |
|----|------|
| A1 | 图例可见「已声明 / 未声明」（或 en Declared / Not declared），**不再**以「已配置/未配置」作图例主文案 |
| A2 | introShort 含：只读、声明/静态扫描、三路径、排除 gate/ACP |
| A3 | 路径 chip 行可见至少主循环 / 子智能体 / 工作流 / 排除项 |
| A4 | 展开 `PermissionRequest`：说明工作流默认无 HITL |
| A5 | 展开 `Stop`：说明 continue 仅主会话 |
| A6 | 展开 `TurnStart`：说明工作流为每 run 非每节点 |
| A7 | 节点 badge 与图例用语一致（声明） |
| A8 | 三语 key 齐全；`translation-keys` 测试通过 |

### 8.2 行为回归

| ID | 验收 |
|----|------|
| B1 | 鱼骨节点集合仍 12 个 catalog 事件 |
| B2 | 点击展开/收起、插件列表逻辑不变 |
| B3 | `data-configured` 等测试 id 语义可仍表示「有声明」；测试不依赖旧中文「已配置」 |
| B4 | 无 sidecar / protocol 行为 diff（本 Spec 纯 UI） |

### 8.3 手动

1. 无插件：图全「未声明」，空态文案正确。  
2. 有 PreToolUse 插件：PreToolUse 高亮为「已声明」，展开有路径脚注 + 插件 dir。  
3. 切换语言：en/zh-CN/zh-TW 关键读，无串 key。  

---

## 9. 分阶段交付

| Phase | 范围 | 价值 |
|-------|------|------|
| **P0** | 图例/badge/summary/empty「声明」用语；introShort 补扫描/探针；PermissionRequest + Stop + TurnStart 事件脚注 | 消除最高误导 |
| **P1** | 路径 chip 行；ExpandPanel 统一 pathScope；`hookCatalog` 穷尽 path keys | 结构清晰 |
| **P2**（可选） | 工作流 UI 链到挂钩页；SessionStart deny 与代码对齐后的文案；runtime 调试条 | 跨产品面 |

**建议一次 PR 做完 P0+P1**（改动集中在 i18n + 一个 diagram 组件）。

---

## 10. Key Decisions

| # | 决策 | 理由 |
|---|------|------|
| D1 | 用户文案用「声明」，内部可保留 configured 标识符 | 改动面小、语义清 |
| D2 | 保留单脊鱼骨，不加第二张工作流图 | 符合精简页；脚注足够 |
| D3 | 路径 chip 非筛选、非路由 | 本期只教育，不引入状态 |
| D4 | 事件脚注以 ExpandPanel + events.* 为主，title tooltip 可共用同一 key | 避免三处文案漂移 |
| D5 | 本 Spec 不改 runtime | 职责分离；runtime 已由 parity spec 覆盖 |
| D6 | SessionStart deny 文案以代码为准 | 禁止文档夸大控制力 |

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 「声明」对普通用户偏技术 | intro 用「插件里登记的事件」同义一次 |
| 脚注过长挤面板 | 主描述一行 + 脚注 `text-caption` 灰色一行 |
| 与 README 双源 | README 链到本 Spec；改路径表时双改 checklist |
| 测试绑死中文 | 测试优先 testid / i18n key |

---

## 12. Open Questions（默认已锁定）

| Q | 锁定默认 |
|---|---------|
| 是否 rename 代码 `configured` → `declared`？ | **否**（仅 UI 字符串） |
| 路径 chip 是否可点击过滤鱼骨？ | **否**（P2 再议） |
| 是否在工作流页加入口？ | **本期否**（P2） |
| SessionStart deny 是否本期改 runtime？ | **否**（只诚实写脚注） |

---

## 13. PR Plan（实现时）

| PR | 标题 | 内容 |
|----|------|------|
| **PR1** | `docs(ui): honest hooks settings copy (declared vs runtime paths)` | i18n P0+P1 文案 + HookLifecycleDiagram 路径 chip/脚注 + hookCatalog keys + 测试 + 可选 README 一句 |

单 PR 足够；若需拆分：PR1a 仅 i18n 术语，PR1b chip+面板。

---

## 14. 参考

- Runtime 路径：`packages/sidecar/src/session/hooks/README.md`  
- 贯通实现：`docs/superpowers/specs/2026-07-12-hooks-workflow-parity-spec.md`  
- 页面组件：`src/components/account/HookConfig.tsx`、`HookLifecycleDiagram.tsx`  
- 业界：Claude Code hooks 文档（事件语义）；本页不引入新事件类型  

---

## 15. 成功标准（产品）

完成后，产品经理用一句话验收：

> 一个只写过工作流、没看过 sidecar 代码的用户，打开「挂钩配置」后，**不会**认为「图上亮的 PermissionRequest 会在工作流里弹窗问我」，也**不会**认为「Stop continue 会让 DAG 再跑一轮」；他能理解高亮是插件声明，工具拦截在主循环/子 agent/工作流节点生效。
