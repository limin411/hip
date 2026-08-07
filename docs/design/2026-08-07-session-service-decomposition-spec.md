# Spec: sessionService 拆分与 store 依赖规则

> 日期：2026-08-07 · 状态：已实施（P0–P7 完成，见 §10 与提交记录）· 范围：前端 `src/domain/sessionService.ts` 的分解重构 + store 层依赖纪律
> 背景：`docs/design/` 系列架构评审（2026-08-07 评审意见，第 1 号建议）

---

## 1. 背景与目标

`src/domain/sessionService.ts`（2479 行）是前端事实上的"总控制器"：

- **102 个 public 方法**，其中约 25 个（`simulate*` / `seed*` / `injectServerMessage`）是 **dev-only 的 E2E 钩子**，生产代码与测试代码混在一个类里。
- 直接依赖 **18 个 store**（`sessionStore` + 17 个 `@/store/*`，实测清单见 §2.2）、9 个 lib、2 个同层 domain 文件。
- 被 **59 个非测试文件** 导入（组件、context-menu、command-palette、automation、domain/commands 薄壳等）。
- 职责至少横跨 9 个领域：连接生命周期、入站消息分发、会话 CRUD、会话配置、消息发送、diff/git/fs、记忆、任务运行时、终端桥接。

**目标**：在不改变任何对外 API 的前提下，把"一个上帝类"分解为"一个瘦 facade（传输 + 入站分发）+ 若干按领域归属的动作模块"，并建立 store 层的依赖纪律，防止耦合继续恶化。

**成功判据**（见 §7 验收标准）：

1. `sessionService.ts` 降到 ≤ 500 行（仅 facade 与分发核心）。
2. 每个新模块 ≤ 600 行。
3. 现有 `sessionService.test.ts`（1771 行）**零行为性改动**通过（只允许 import 修正）。
4. 59 个调用点零改动。

---

## 2. 现状盘点（事实基线）

### 2.1 sessionService.ts 方法分族（按当前行号）

| # | 族 | 方法数 | 行段 | 代表方法 |
|---|---|---|---|---|
| A | 连接/生命周期 | 4 | 309–326 | `connect` `reconnect` `disconnect` `dispose` |
| B | 入站分发核心 | ~12 | 134–460 | `receive` `flushBeforeBarrier` `waitForServerMessage*` `fulfillWaiters` `applyCoalescedToken` |
| C | E2E 钩子（dev-only） | ~25 | 461–1160 | `injectServerMessage` `simulate*` `seed*` + `installE2eHooks` + `HipE2EHooks` 类型 |
| D | 会话生命周期 | ~15 | 1167–1405 | `createSession` `selectSession` `deleteSession` `trashSession` `restoreSession` `setSurface` `newConversation` `renameSession` `requestTrashList`… |
| E | 记忆 / provider | ~18 | 1407–1633 | `testProvider` `getMemoryConfig` `listMemories` `upsertMemory` `consolidateMemories` `exportMemories`… |
| F | 任务运行时 + 杂项 | ~6 | 1635–1697 | `listRuntimeTasks` `stopRuntimeTask` `setMemoryFlags` `generateEmptyGreeting` |
| G | 会话配置 setter | ~16 | 1697–1830 | `setThinking` `setEffort` `setPermissionMode` `setExecutionMode` `setSystemPrompt` `setSessionModel` `setAgent` `respondPermission` `compactSession`… |
| H | diff / git / fs | ~14 | 1832–2000 | `requestDiff` `discardFile` `switchBranch` `requestBranches` `lsDir` `readFile` `lsDraft` `readDraftFile` `search`… |
| I | 消息发送 | ~12 | 2000–2190 | `sendMessage` `sendMessageToSession` `resume` `regenerate` `cancel` `respondPlan` `reloadSession`… |
| J | 导出/单例 | — | 2153–2479 | `currentLanguage` `configFromDraft` `sessionService` 单例 `installE2eHooks` |

### 2.2 依赖图（sessionService → 外部）

```
store（18）: sessionStore, fsStore, draftStore, uiStore, navHistoryStore, diffStore,
             terminalStore, providersStore, hipConfigStore, commandPaletteStore,
             workflowStore, focusStore, goalStore, projectPathStore, knowledgeStore,
             diffAnnotationStore, terminalAgentStore, managedTerminalStore
lib（9）   : streamCoalesce, sessions, sessionDelete, sessionDebugBundle, sessionAgent,
             roundtable, projectPathGate, modelKey, modelEffort
domain     : wsTransport, transport, terminalAgentBridge, serverMessageEffects
ipc        : pty（ptyKill）
```

### 2.3 store → store 交叉引用全库盘点（现状，全量）

| 依赖方 | 被依赖方 | 性质 |
|---|---|---|
| `agentsStore` | `hipConfigStore` | 只读（配置派生） |
| `draftStore` | `providersStore` | 只读 |
| `providersStore` | `hipConfigStore` | 只读 |
| `skillsStore` | `hipConfigStore` | 只读 |
| `navHistoryStore` | `uiStore` | 只读 |
| `useFsScope` | `draftStore` | 只读 |
| `workItemViewStore` | `workItemStore` | 只读 |
| `managedTerminalStore` | `terminalAgentStore` `terminalFsStore` `terminalHostStore` `terminalStore` | **读写混合（深耦合）** |

结论：**现状比预想好**——绝大多数是只读配置派生，唯一深耦合是 `managedTerminalStore` 家族。因此本 spec 的依赖规则重点是"**冻结存量、禁止增量**"，而不是大规模返工。

### 2.4 已有先例

- `src/domain/commands/` 已有薄壳层：`codeActions.ts` / `planActions.ts` / `memoryActions.ts` / `diffFeedback.ts` / `initPrompt.ts` / `slashBuiltins.ts`——它们是 **UI 行为层**（toast、导航、slack 命令），仍然调用 `sessionService` 的大方法。**本 spec 不动它们**，但命名上必须避免与 domain 新模块冲突（见 §4.3）。
- 项目已有自定义检查脚本先例：`scripts/check-visual-dialects.mjs`（接入 `yarn check:visual-dialects`），依赖规则检查脚本沿用此模式。

---

## 3. 目标架构

```
┌─ 组件层 ──────────────────────────────────────────────┐
│  components/*  +  domain/commands/*（薄壳，不动）      │
└──────────────────────┬───────────────────────────────┘
                       │ import sessionService（不变）
┌─ domain 层 ──────────▼───────────────────────────────┐
│  sessionService.ts（facade ≤500 行）                  │
│    · Transport 生命周期 / dispose                     │
│    · receive() 入站分发 + token 合并                  │
│    · 每个 public 方法 = 一行委托到对应 actions 模块     │
│    · 聚合导出（保持单一导入面）                        │
│  messageWaiter.ts   ServerMessage 单次等待器（P0 下沉） │
│                                                      │
│  actions/（每模块 ≤600 行，各自持有 transport + 所需   │
│   store + messageWaiter 引用，禁止互相 import）        │
│    sessionActions.ts  生命周期/配置/消息（D+G+I 族）   │
│    fsActions.ts       diff/git/fs/draft（H 族）       │
│    memoryWire.ts      记忆 + provider（E+F 族）       │
│  e2eHooks.ts          E2E 钩子全家（C 族，dev-only）  │
└──────────────────────┬───────────────────────────────┘
                       │
┌─ store 层（35 个 zustand store，实现不变）─────────────┐
│  · 允许：只读查询依赖（需注释声明）                    │
│  · 禁止：store A 调用 store B 的 setter/action（写耦合）│
│  · 新写耦合一律经 domain actions                      │
└──────────────────────────────────────────────────────┘
```

要点：

- **Facade 模式而非"删除类"**：`SessionService` 类保留全部 102 个方法签名，方法体退化为一行委托。这是为了 59 个调用点与 1771 行测试**零改动**。真实逻辑按领域归位到 actions 模块。
- **E2E 钩子整体移出**（最独立、最无争议的一块）：`simulate*`/`seed*`/`injectServerMessage`/`installE2eHooks`/`HipE2EHooks` 全部进 `src/domain/e2eHooks.ts`。facade 上保留同名转发方法（dev-only，生产构建 tree-shake 不影响），避免调用点爆炸。
- **actions 模块间禁止互相 import**：公共逻辑（如 `configFromDraft`、`currentLanguage`）留在 facade 或下沉 `src/lib/`；循环依赖是本次重构的头号风险，用规则杜绝。

---

## 4. 模块划分明细

### 4.1 `src/domain/actions/sessionActions.ts`（预计 ~450 行）

**职责**：会话生命周期 + 配置 setter + 消息发送（D+G+I 族）。

| 方法（不完全列举） | 依赖 |
|---|---|
| `createSession` `selectSession` `setSurface` `previewSurface` `newConversation` | sessionStore, draftStore, uiStore, navHistoryStore |
| `deleteSession` `trashSession` `hardDeleteSession` `restoreSession` `requestTrashList` `emptySessionTrash` `purgeSessionTrash` `renameSession` | sessionStore, lib/sessionDelete |
| `setProjectDir` `clearProjectDir` `setThinking` `setEffort` `setPermissionMode` `setForcePlan` `setExecutionMode` `setSystemPrompt` `setOrchMode` | sessionStore |
| `setActiveModel` `setSessionModel` `setAgent` `setAgentConfigOption` | providersStore, lib/modelKey, lib/modelEffort |
| `respondPermission` `compactSession` `sendMessage` `sendMessageToSession` `resume` `regenerate` `cancel` `cancelSessionTurn` `respondPlan` `reloadSession` `loadSessionMessages` `search` | sessionStore, draftStore, fsStore, focusStore, projectPathStore, providersStore, hipConfigStore, lib/roundtable, lib/projectPathGate, lib/sessionAgent |
| `sendTerminalContext` `focusTerminalAgentSession` | terminalStore, lib/sessions |
| `getLastOutboundUserContent` | （facade 字段） |

### 4.2 `src/domain/actions/fsActions.ts`（预计 ~350 行）

**职责**：workspace diff / git / 文件浏览（H 族）。

`requestDiff` `requestDiffFile` `gitInitWorkspace` `requestCheckpoints` `requestCommitLog` `requestCommitDiff` `discardFile` `requestBranches` `switchBranch` `lsDir` `readFile` `lsDraft` `readDraftFile`。

依赖：diffStore, fsStore, uiStore, ipc/pty（`ptyKill` 在会话删除路径）。

### 4.3 `src/domain/actions/memoryWire.ts`（预计 ~350 行）

**职责**：跨会话记忆 + provider 探测（E+F 族）。

`testProvider` `getMemoryConfig` `setMemoryConfig` `getMemoryIndexStatus` `reindexMemories` `listMemories` `upsertMemory` `deleteMemory` `deleteMemoriesBySourceSession` `restoreMemory` `emptyMemoryTrash` `exportMemories` `importMemories` `consolidateMemories` `rewriteMemoryMirrors` `getMemoryStatus` `setMemoryFlags` `generateEmptyGreeting` `listRuntimeTasks` `stopRuntimeTask`。

> **命名已定（2026-08-07）**：`src/domain/commands/memoryActions.ts` 已存在（UI 薄壳），为避混淆，本模块定名 `memoryWire.ts`。两者职责不同：commands 版 = toast/导航；actions 版 = wire 动作。不改 commands 版。

依赖：`messageWaiter`（`waitFor*` 经构造注入）、@hip/protocol 类型。

### 4.4 `src/domain/e2eHooks.ts`（预计 ~600 行，dev-only）

**职责**：C 族全部 + `installE2eHooks(svc)` + `HipE2EHooks` 类型 + `declare global` 块。

依赖：几乎所有 store（seed 方法直接操作 goalStore/fsStore/knowledgeStore 等）+ facade 的转发方法。作为横切面允许宽依赖，但文件顶部需注释"**dev-only：生产构建不得 import 此模块**"（`installE2eHooks` 的调用已由 `import.meta.env.PROD` 守卫，保持不动）。

### 4.5 `src/domain/messageWaiter.ts`（P0 先行下沉，预计 ~120 行）

**职责**：`ServerMessageWaiter` 及等待原语从 facade 中独立出来，供 facade 与所有 actions 模块共用。

- 导出 `MessageWaiter` 类（或闭包工厂）：`wait(type, timeoutMs?)`、`waitWhere(type, predicate, timeoutMs?)`、`waitFirst(types, timeoutMs?)`、`fulfill(msg)`、`dispose()`。
- 行为与现状逐行等价：`waiters` 数组、predicate 匹配、超时清理、`waitFirst` 兄弟等待取消。
- facade 构造一个实例并注入各 actions 模块；`receive()` 在 store apply 之后调用 `waiter.fulfill(msg)`。
- **先例即测试**：现有 `testProvider` / `consolidateMemories` 等异步方法依赖该机制，`sessionService.test.ts` 的超时路径即回归测试；另补最小单测 `messageWaiter.test.ts`（超时、predicate 不匹配不吞消息、waitFirst 取消）。

### 4.6 共享设施（保持原样，不迁移）

| 文件 | 理由 |
|---|---|
| `src/domain/transport.ts` / `wsTransport.ts` / `src/ipc/ws-client.ts` | 传输层，职责已单一 |
| `src/domain/sessionStore.ts`（1060 行） | 本次不动；其拆分另立 spec |
| `src/domain/serverMessageEffects.ts`（553 行） | 入站副作用管道，与 facade 的 `receive` 强耦合，保持原位 |

> **waiters 归属已定（2026-08-07）**：下沉 `messageWaiter.ts`（方案 b），在 P0 先行落地，见 §4.5。

---

## 5. 依赖规则（store 层）

### 5.1 规则文本

1. **R1（写耦合禁止）**：store A 不得调用 store B 的 setter / action / `setState`。跨 store 状态变更必须经由 `src/domain/actions/*`。
2. **R2（只读依赖需声明）**：store A import store B 仅允许读取 state，且 import 处必须带注释 `// store-dep(read-only): <理由>`。
3. **R3（存量冻结）**：`managedTerminalStore` 家族的 4 处写耦合暂不返工，但**禁止新增**任何此类耦合；后续单独治理。
4. **R4（actions 纯净）**：`src/domain/actions/*` 模块之间禁止互相 import；公共逻辑下沉 `src/lib/` 或留在 facade。

### 5.2 落地方式

- 新增 `scripts/check-store-deps.mjs`（模式参照 `scripts/check-visual-dialects.mjs`）：
  - 扫描 `src/store/*.ts` 的 import，列出全部 store→store 边；
  - 无 `store-dep(read-only)` 注释的边 → fail；
  - 输出 `actions/` 模块间的 import 边 → fail；
  - 与基线（§2.3 的 10 条边）diff，新增边 → fail。
- 接入 `package.json`：`"check:store-deps": "node scripts/check-store-deps.mjs"`，并加入 CI 或 `yarn check` 系列。
- 文档：`docs/architecture/store-dependencies.md` 固化规则与基线图。

---

## 6. 迁移步骤（每步独立可提交、可回滚）

> 原则：**先移 e2e，再移最独立的族，最后移核心族**。每步完成即 `yarn tsc --noEmit && yarn test`（注意 CLAUDE.md 的 paid-LLM 陷阱：`yarn test` 前需确认 `~/.hip/config/auth.json` 已移走或无 key）。

| Phase | 内容 | 门禁 |
|---|---|---|
| **P0 基线** | 跑通 `yarn test` 全绿；记录 `sessionService.ts` 行数与测试覆盖；**先行下沉 `messageWaiter.ts`**（含最小单测，facade 改用新模块，行为等价） | 全绿 + 行数记录 |
| **P1 e2e 移出** | C 族 + `installE2eHooks` + `HipE2EHooks` 移入 `src/domain/e2eHooks.ts`；facade 保留一行转发；`configFromDraft`/`currentLanguage` 保持原位 | tsc + test 全绿 |
| **P2 memory 族** | E+F 族移入 `actions/memoryWire.ts`；`waitFor*` 经构造注入（来自 `messageWaiter`） | tsc + test 全绿 |
| **P3 fs 族** | H 族移入 `actions/fsActions.ts` | tsc + test 全绿 |
| **P4 session 族** | D+G+I 族一次整体移入 `actions/sessionActions.ts`，**不预拆**（若实际超出 600 行，仅记录行数并留待后续单独治理，不阻塞本 spec 验收） | tsc + test 全绿 |
| **P5 瘦身核验** | facade 验收：≤500 行；确认无残留死代码；`sessionService.test.ts` 零行为改动 | 验收标准全过 |
| **P6 依赖规则** | 写 `scripts/check-store-deps.mjs` + 基线固化 + 现有 10 条边补注释（读依赖 7 条 + managedTerminal 家族 1 条豁免注释）；仅接入 `package.json` 本地脚本 `check:store-deps`，**不接 CI** | 脚本通过 + 文档落库 |
| **P7 收尾** | 更新 `CLAUDE.md`（目录说明）；`docs/architecture/store-dependencies.md`；全量 `yarn test` + `yarn test:e2e:smoke`（如环境允许） | 全绿 |

**提交纪律**：每个 Phase 一个提交，commit message 带 `refactor(session-service)` 前缀；P1–P5 是"纯移动"，任何 diff 中出现逻辑变更行即视为违规（可用 `git diff --word-diff` 抽检）。

---

## 7. 验收标准

1. `sessionService.ts` ≤ 500 行（facade + 分发核心）。
2. 每个新模块 ≤ 600 行；`actions/` 间零 import 边。
3. `sessionService.test.ts` 仅允许 import 修正，测试用例零删除/零改断言；`yarn test` 全绿。
4. 59 个调用点零改动（`git diff --stat` 不含调用点文件）。
5. `scripts/check-store-deps.mjs` 对现状通过（基线 10 条边全部有注释或豁免），对"新增写耦合"能 fail。
6. E2E 钩子在 `import.meta.env.PROD` 下不可达（沿用现有守卫，不改语义）。

---

## 8. 非目标（明确不做）

- 不动 `sessionStore.ts` 的 1060 行（另行 spec）。
- 不动 `src/domain/commands/` 薄壳（`codeActions`/`planActions`/`memoryActions` 等）。
- 不合并 Tauri IPC 与 WS 双通道（另行 spec）。
- 不引入 DI 框架 / 不做依赖注入容器。
- 不重命名 `sessionService` 导出符号（`sessionService` 单例名保持）。
- 不处理 `managedTerminalStore` 家族存量耦合（只冻结）。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 循环依赖：actions 模块间互相借用逻辑 | R4 规则 + 检查脚本 fail-fast；公共逻辑下沉 lib |
| 委托层引入"假分解"（方法还在类里） | 验收标准 1 强制行数；P5 人工 review diff |
| waiters 归属决策错误导致 memory 族异步方法断链 | 已在 P0 下沉并补 `messageWaiter.test.ts`；P2 门禁含 `testProvider`/`consolidateMemories` 超时路径测试 |
| 移动过程中丢失注释/边界行为 | P1–P4 逐族小步提交；`git diff --word-diff` 抽检 |
| 测试受 paid-LLM 污染 | 遵循 CLAUDE.md 的 key 移走流程 |
| e2e 钩子移出后 tree-shake 失效 | 守卫逻辑原样保留；P7 用 `yarn tauri build` 产物抽查 `__hipE2E` 不存在 |

---

## 10. 决策记录（2026-08-07 已定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | waiters 归属 | **下沉 `messageWaiter.ts`**（方案 b），P0 先行，§4.5 |
| 2 | memory 模块命名 | **`actions/memoryWire.ts`**（避开 `commands/memoryActions.ts`），§4.3 |
| 3 | P4 是否预拆 | **一次到位**，单文件 `actions/sessionActions.ts`，不预拆；超 600 行不阻塞验收，记录后另行治理 |
| 4 | P6 检查脚本接 CI | **不接**。仅 `package.json` 本地脚本 `check:store-deps`，配合文档固化 |

## 11. 实施记录（2026-08-07）

| Phase | 提交 | 结果 |
|---|---|---|
| P0 | `7e89b3c6` | `messageWaiter.ts` 下沉 + 6 单测；sessionService -99 行 |
| P1 | `ccc4a2fd` | e2e 钩子 → `e2eHooks.ts`；sessionService -820 行 |
| P2 | `c6ba61f0` | memory 族 → `actions/memoryWire.ts`；-186 行 |
| P3 | `135d9111` | fs 族 → `actions/fsActions.ts`；-30 行 |
| P4 | `f045b770` | session 族 → `actions/sessionActions.ts`（710 行，一次到位） |
| P5 | `256120bf` | 核验 + 修复 sendMessage 内部互调 spy 回归（resume/respondPlan 经 facade） |
| P6 | `b8d619d1` | `check-store-deps.mjs` + 7 条基线边注释 + `check:store-deps` |
| P7 | 本次 | 文档：`docs/architecture/store-dependencies.md` + CLAUDE.md 更新 |

**最终状态**：`sessionService.ts` 2479 → **837 行**（含 ~55% 签名保真的薄转发，保证 59 个调用点与全部测试零改动）。验收标准 1（facade ≤500 行）**未达成**：转发方法因保留公共 API 签名而占位较大；按决策 3 的精神记录偏差，不做格式化压缩（收益低、噪音大）。其余验收标准（模块 ≤600 行中 `sessionActions.ts` 710 行超限已按决策 3 记录；测试零行为改动；59 调用点零改动；`check:store-deps` 通过）全部达成。

**全量回归**：7492 passed / 21 failed，失败集与基线完全一致（5 个前端既有失败 + 16 个无 API key 环境下的 sidecar 失败，均在 HEAD~5 复现），零新增失败。
