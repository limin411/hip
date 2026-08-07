# Spec: sessionStore.ts 拆分

> 日期：2026-08-07 · 状态：草案（待评审）· 范围：`src/domain/sessionStore.ts`（1060 行）的分解重构
> 背景：架构评审第 3 号建议；`sessionService.ts` 分解（2026-08-07-session-service-decomposition-spec）完成后的下一块

---

## 1. 背景与目标

`src/domain/sessionStore.ts`（1060 行）是会话视图模型的单一载体：类型定义、消息纯函数、巨型 reducer（`applyServerMessage` 491 行）、store 接口与 zustand 实现全部挤在一个文件。它是 `sessionService` 分解后前端最大的单体文件，且被 **20+ 组件/模块** 经多种路径 import（`@/domain/sessionStore`、`./sessionStore`、`../sessionStore`）。

**目标**：按"聚合导出（index） + 类型 + 纯函数 + 分域 reducer + 薄 store 实现"拆分，**不改变 store 形状与任何导出符号**——所有现有 import 面、hooks、调用点、`sessionStore.test.ts`（1651 行）零改动。

**成功判据**：

1. `sessionStore.ts` 拆为目录 `src/domain/sessionStore/`，单文件 ≤ 400 行（store 实现 ~200 行、reducer 每域 ≤ 300 行）。
2. 现有导出符号（`useDomainStore`、`SessionVM`、`applyServerMessage`、`DEFAULT_CONFIG`、`clearPermission`、`emptySession`、`lastAssistantIndex` 等）在 `index.ts` 原样 re-export，**任何 import 路径不变**。
3. `sessionStore.test.ts`（1651 行）零行为性改动通过；`sessionService.test.ts` 等下游测试全绿。
4. `applyServerMessage` 行为逐位等价（`git diff --word-diff` 抽检）。

---

## 2. 现状盘点（事实基线）

### 2.1 行数分布

| 区域 | 行段 | 行数 | 内容 |
|---|---|---|---|
| 类型 | 8–66 | ~58 | `SessionError` `PendingPermission` `SessionVM` |
| 消息纯函数 | 67–291 | ~225 | `lastAssistantIndex` `lastNonNotice` `isCurrentTurnAssistant` `isStreamingAssistant` `popForRegenerate` `mapMessages` + step 应用 |
| **巨型 reducer** | 292–781 | **~491** | `applyServerMessage`（40 个 case + 分支） |
| 工具/常量 | 782–819 | ~38 | `clearPermission` `DEFAULT_CONFIG` `emptySession` |
| store 接口 | 820–868 | ~48 | `Connection` `McpServerStatusVM` + store 形状 |
| store 实现 | 869–1060 | ~192 | zustand `create`（apply/createSession/selectSession/… 20 个 action） |

### 2.2 applyServerMessage 的 40 个 case 分域

| 域 | case 数 | 代表消息 |
|---|---|---|
| `session:*` | 18 | created/loaded/deleted/trashed/status/thinking/effort/model/cwd/rename/systemPrompt/memoryFlags/… |
| `agent:*` | 7 | started/finished/interrupt/notification/… |
| `plan:*` | 4 | published/updated/approval 相关 |
| `tool:*` | 2 | started/finished（timeline 落位） |
| `plugin:*` | 2 | install 状态 |
| `permission:*` | 2 | request/respond 本地队列 |
| 单点 | 5 | `token:stream` `message:*` `task:*` `reasoning:delta` `error` |

> 消息流域（agent/tool/token/message/reasoning/error）共享回合状态机（turnId/agentRuns/timeline/status），**必须同文件**，不可按前缀硬拆。

### 2.3 外部引用面

- 20+ 组件 import store（`useDomainStore` 及其类型）；路径多样（`@/domain/sessionStore` / 相对路径）。
- 纯函数外部引用：`lastAssistantIndex`（1 文件）、`isStreamingAssistant`（1）、`clearPermission`（2）、`emptySession`（2）、`mapMessages`（1）；`popForRegenerate` 仅 store 内部使用。
- `src/domain/hooks.ts`（334 行）从本 store 派生全部选择器——**只依赖导出符号，不依赖文件结构** ✓。
- `sessionStore.test.ts` 直接测 `applyServerMessage`/`emptySession`/`clearPermission`/store actions。

---

## 3. 目标结构

```
src/domain/sessionStore/
  index.ts            # 聚合导出（唯一对外面；所有旧路径语义不变）
  types.ts            # SessionError/PendingPermission/SessionVM/McpServerStatusVM/
                      # PluginInstallState/Connection + store 形状接口（~100 行）
  messageUtils.ts     # 纯函数：lastAssistantIndex/mapMessages/popForRegenerate/
                      # isStreamingAssistant/… + step 应用（~225 行，原样移动）
  constants.ts        # DEFAULT_CONFIG + emptySession + clearPermission（~40 行）
  reducers/
    session.ts        # session:* 18 case（~180 行）
    flow.ts           # 回合状态机：agent/tool/token/message/reasoning/error（~200 行）
    plan.ts           # plan:* + permission:*（~90 行）
    misc.ts           # plugin:* + search/mcp/connection 等杂项（~60 行）
    index.ts          # applyServerMessage 聚合：按 msg.type 分派到各域（~40 行）
  store.ts            # zustand create 薄实现（~200 行，原样移动）
```

要点：

- **方案 A（reducer 拆分，推荐）**：单 store 形状不变，`applyServerMessage` 变分派器。侵入最小、测试零适配、与 `sessionService` facade+模块风格一致。
- **方案 B（zustand slices，备选不推荐）**：按 slice 拆分 create；状态形状不变但 slices 共享 `set/get` 的适配与测试改动大，收益（多 store）当前无消费方。
- **分域边界以"状态机耦合"为准**：`flow.ts` 聚合所有回合状态机消息（不可按前缀拆）；`session.ts` 是纯字段投影；`plan.ts` 聚合 plan+permission（共享 `planApprovalPending`/`pendingPermission` 状态）；`misc.ts` 是独立杂项。
- **reducer 间禁止互相 import**：共享 helper（如消息追加）放 `messageUtils.ts`。

---

## 4. 迁移步骤

| Phase | 内容 | 门禁 |
|---|---|---|
| **P0 基线** | 跑通 `yarn test`（无 key）；记录行数与导出清单 | 全绿 |
| **P1 目录化** | 建 `src/domain/sessionStore/`；`index.ts` re-export 全部现有导出；旧 `sessionStore.ts` 删除（若旧路径 import 因 Vite 别名失效则保留薄转发文件，验证后删） | tsc + 全量测试绿（此步验证 import 面） |
| **P2 纯移动** | `messageUtils.ts` / `constants.ts` / `types.ts` 原样移动；store 实现移入 `store.ts` | tsc + 测试绿；`git diff --word-diff` 无逻辑变更 |
| **P3 reducer 拆分** | `applyServerMessage` 按 §3 分域拆为 4 个 reducer + 聚合分派器（**纯移动**，分派顺序与现状一致） | tsc + `sessionStore.test.ts` 零改动全绿 |
| **P4 收尾** | 死代码检查（`popForRegenerate` 等私有符号确认归属）；更新 CLAUDE.md 目录说明 | tsc + 全量相关测试绿 |

提交纪律：每 Phase 独立提交，前缀 `refactor(session-store)`；P2/P3 禁止任何逻辑变更（`git diff --word-diff` 抽检）。

---

## 5. 验收标准

1. `src/domain/sessionStore.ts` 消失；目录内单文件 ≤ 400 行（`reducers/flow.ts` 允许 ≤ 300 行上限内）。
2. 现有 import 面零改动（20+ 组件、hooks、actions、测试均按原路径/符号解析）。
3. `sessionStore.test.ts`（1651 行）零行为性改动通过；`yarn test` 全量失败集与基线一致（仅 sidecar 无 key 环境失败）。
4. `applyServerMessage` 分派顺序与现状等价（case 覆盖 40 个消息类型全部保留）。
5. `yarn check:store-deps` 仍通过（本重构不新增 store→store 边）。

---

## 6. 非目标

- 不改变 store 形状/字段（`SessionVM` 字段冻结；字段级重构另立 spec）。
- 不拆分 `hooks.ts`（334 行选择器层，依赖本 store 导出，保持原位）。
- 不动 `sessionStore.test.ts` 的测试用例（仅允许 import 修正）。
- 不引入方案 B（slices）与任何状态管理库替换。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 旧路径 import 在目录化后失效（Vite 别名 `@/domain/sessionStore` 解析到目录时歧义） | P1 先行验证：`index.ts` 就位后 tsc + 全量跑；若有歧义保留 `src/domain/sessionStore.ts` 薄转发文件（一行 `export * from './sessionStore/index'`）直至确认可删 |
| reducer 拆分时 case 顺序/分支顺序变化导致行为漂移 | P3 分派器按现状顺序排列；`git diff --word-diff` 抽检；`sessionStore.test.ts` 是行为锁 |
| 回合状态机跨域耦合（如 `session:loaded` 重置 flow 状态） | 分域前先列"跨域状态依赖清单"（P0 产出），flow 与 session 的交叉状态归 `session.ts` 的 reducer 显式委托 |
| 测试受 paid-LLM 污染 | 遵循 CLAUDE.md 的 key 移走流程 |

---

## 8. 待评审决策点

1. **方案确认**：A（reducer 拆分，推荐）vs B（slices）。
2. **`flow.ts` 与 `session.ts` 的边界**：`session:loaded` 需要同时重置回合状态——采用"`session.ts` 返回完整状态、`flow.ts` 只处理回合字段"的委托方式（推荐）还是 `flow.ts` 导出子 reducer 由聚合器组合。
3. **薄转发文件的去留**：P1 后若旧路径无歧义，直接删；有歧义则保留 `sessionStore.ts` 转发并记录（推荐保留至 P4 验证后再删，稳妥）。

---

## 9. 实施记录（2026-08-07）

**决策**：方案 A（单 store + reducer 分域）；边界"每消息只归属一个 reducer"，跨域字段写入由归属 reducer 完成并注释声明（`session:loaded` 全量重置在 session.ts；`agent:interrupt` 写 `planApprovalPending`、`error` 清 plan 字段在 flow.ts）；薄转发保留至 S-4 验证后删除。

**Phase 执行**：

| Phase | 结果 |
|---|---|
| S-1+S-2 | 目录化纯移动：`index/types/messageUtils/constants/store.ts` + `reducers/index.ts`（整块 applyServerMessage 原样）；旧 `sessionStore.ts` 改薄转发。body 与 `git show HEAD` 原文件逐字节 diff 验证（messageUtils 12 个私有 helper 加 export 供 reducer 使用；PluginInstallState 移至 types.ts；`clearPermission` 的 JSDoc 随函数归位 constants.ts；公共导出面不变）。`sessionStore.test.ts`（130）零改动全绿；全量消费方 790 测试绿。✅ |
| S-3 | 4 域拆分：`helpers.ts`（SessionState + updateSession，原闭包 helper 加显式 state 参数）+ `flow.ts`（14 case）+ `session.ts`（18 case）+ `plan.ts`（6 case）+ `misc.ts`（2 case + default）。case body 按行号 sed 提取逐字搬运；分派器用 Set 白名单 + `session:` 前缀，未知类型落 misc default → state。`sessionStore.test.ts` 零改动全绿；domain+chat+layout+artifact 1675 测试绿。✅ |
| S-4 | 删除薄转发（tsc 验证 `./sessionStore`、`../sessionStore`、`@/domain/sessionStore` 全部解析到目录 index，无歧义）；死代码检查（popForRegenerate 等私有符号归属确认，无孤儿）；CLAUDE.md 目录说明更新；本记录。✅ |

**验收**：`src/domain/sessionStore.ts` 消失；目录内单文件 ≤ 400 行（store.ts 250、flow.ts 225、session.ts 216）；现有 import 面零改动；`sessionStore.test.ts` 零行为改动通过；40 个消息类型分派覆盖与现状等价；`yarn check:store-deps` 通过（未新增 store→store 边）。
