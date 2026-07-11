# hip 记忆系统真实 E2E — 产品与技术 Spec（全 PR）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **Implemented (code landed)** — 本地 T0–T3 已提交；L2/L3 需 debug 二进制 + 手动 live 验证 |
| 概述计划 | [`../plans/2026-07-11-memory-real-e2e-test-plan.md`](../plans/2026-07-11-memory-real-e2e-test-plan.md) |
| 实现计划（PR 切片） | [`../plans/2026-07-11-memory-real-e2e-prs.md`](../plans/2026-07-11-memory-real-e2e-prs.md) |
| 前置 | Memory V1 + A+B+C 已在本地 `dev`；A1.1–A1.9 矩阵绿 |
| 相关设计 | [`2026-07-11-cross-session-memory-system-design.md`](./2026-07-11-cross-session-memory-system-design.md)、[`2026-07-11-memory-phase-next-spec.md`](./2026-07-11-memory-phase-next-spec.md) |
| App E2E 基线 | [`../../../e2e/README.md`](../../../e2e/README.md) |

---

## 1. Overview

记忆功能已有厚 **unit + 进程内 integration（mock LLM、`:memory:` SQLite）**，但缺少：

1. **真文件 DB / handlers 边界** 的 process 级回归  
2. **真 Tauri + Settings/slash/chip UI** 的 WDIO 覆盖  
3. **真 LLM 跨会话 extract → recall** 的 opt-in live 路径  

本 Spec 定义 **真实 E2E** 的产品验收与技术边界，并按 **4 个 PR** 交付（见 §6）。

**真实 E2E 定义：**

> 覆盖 **用户可感知闭环** 与 **进程 / UI 边界**，而不是再堆同进程 mock 断言。  
> **默认 CI / gate 不付费、不打真实模型**；live 路径与现有 `E2E_LIVE_LLM` 一致，opt-in。

---

## 2. Goals & Non-Goals

### 2.1 Goals

| ID | 目标 |
|----|------|
| G1 | 无 LLM 路径可稳定回归：开关、CRUD、回收站、slash、pin/list、citations UI |
| G2 | Sidecar 侧：真 `hip.db` 文件 + handlers + mock pipeline 闭环 |
| G3 | App 侧：WDIO `@memory` 不依赖 assistant 真实回复 |
| G4 | Live 侧：Session A 写入偏好 token → Session B 可观测召回（硬/半硬断言） |
| G5 | hybrid / FTS 降级在 **文件 DB + vec probe** 环境下可证 |
| G6 | Live flaky / 费用 **不污染** PR gate |

### 2.2 Non-Goals

| ID | 非目标 |
|----|--------|
| N1 | 替换 unit 或 A1.x 矩阵 |
| N2 | Prompt 质量评测、红队、长程 benchmark |
| N3 | 云同步 / 多设备 |
| N4 | Wave D（skill 晋升、project remount） |
| N5 | 默认 CI 调用真实 embeddings / chat API |
| N6 | 新增面向用户的「立即提取」产品按钮（靠 `idleMinutes=0` + consolidate） |
| N7 | 改 production 默认 idle（仍为 15） |

---

## 3. 测试金字塔（锁定）

```text
L3  Live product E2E     @live @memory     opt-in E2E_LIVE_LLM=1
L2  App UI E2E (WDIO)    @memory           无付费；seed / harness
L1  Sidecar process E2E  vitest            真文件 DB + mock LLM/embed
L0  Unit + A1 matrix     已有              保持，不删
```

**原则：** 能在 L1 证明的不放到 L2；能在 L2 无 LLM 证明的不放到 L3。

---

## 4. 已锁定技术决策

| # | 决策 | 锁定值 | 说明 |
|---|------|--------|------|
| Q1 | PR 数量 | **4 PR**（T0→T3） | 见 §6；比「3 坨」更易 review |
| Q2 | `idleMinutes: 0` | **合法且立即 debounce 到期** | 当前实现 `0 * 60_000 → setTimeout(0)`；**补单测锁定语义**，不改默认 15 |
| Q3 | `minExtractIntervalHours: 0` | **不节流** | 已满足；补断言 |
| Q4 | L1 形态 | **vitest + 真文件 DB + handlers/service** | 不强制起 sidecar 子进程（留观察项） |
| Q5 | L2 LLM | **禁止** | 仅 seed / injectServerMessage / 真实 UI |
| Q6 | L3 LLM | **opt-in** | `E2E_LIVE_LLM=1`；与 chat live 同 auth 拷贝机制 |
| Q7 | Fixture LLM 进进程 | **L1 用 mock client 注入** | 不新增 production 分支；可选 `HIP_MEMORY_E2E=1` 仅文档/调试，**非 PR 必做** |
| Q8 | `@memory` 进 gate | **首轮不进** `test:e2e:gate` | 独立 `E2E_GREP=@memory`；稳定后再议 |
| Q9 | Live hybrid | **默认关** | M3.6 单独 tag `@live @memory-hybrid`，非 MVP |
| Q10 | 断言语言 | **testid 优先** | i18n 文案仅作辅助 |

---

## 5. 可测性契约（全 PR 共享）

### 5.1 配置加速（落盘 `memory.json`）

| 字段 | 生产默认 | E2E 加速值 |
|------|----------|------------|
| `useMemories` / `generateMemories` | false | 场景显式 true |
| `idleMinutes` | 15 | `0`（立即 Phase1 调度） |
| `minExtractIntervalHours` | 6 | `0` |
| `maxExtractsPerDay` | 20 | live 可 `50` |
| `hybridSearchEnabled` | false | 仅 hybrid 场景 true |

路径：`HIP_DATA_DIR/config/memory.json`（与 `HIP_MEMORY_CONFIG_PATH` / 现有 config 解析一致）。

### 5.2 `__hipE2E` 记忆扩展（PR-T1 交付，PR-T2 使用）

仅非 production 构建（与现有 hooks 相同 `import.meta.env.PROD` 守卫）。

| Hook | 签名（示意） | 用途 |
|------|----------------|------|
| `getMemoryConfig` | `() => Promise<MemoryFileConfig>` | 读配置 |
| `setMemoryConfig` | `(p: Partial<MemoryFileConfig>) => Promise<MemoryFileConfig>` | 加速 idle / 双开 |
| `seedMemoryItem` | `(partial) => Promise<MemoryItem>` | 绕过表单 seed |
| `listMemories` | `(filter?) => Promise<MemoryItem[]>` | 列表断言 |
| `deleteMemory` | `(id, hard?) => Promise<…>` | 可选 |
| `restoreMemory` | `(id) => Promise<…>` | 可选 |
| `triggerMemoryConsolidate` | `(opts?) => Promise<void>` | 触发 Phase2 |
| `getActiveSessionMemoryFlags` | `() => { use?, generate?, incognito? }` | slash 断言 |

实现：委托已有 `sessionService.getMemoryConfig / setMemoryConfig / listMemories / upsertMemory / …`，**不**新增 sidecar RPC。

### 5.3 data-testid（已有则复用）

| 区域 | testid |
|------|--------|
| 面板 | `memory-config-empty`, `memory-config`, `memory-enable-both`, `memory-enable-use-only` |
| 开关 | `memory-switch-use`, `memory-switch-generate`, `memory-switch-hybrid` |
| 列表 | `memory-list`, `memory-list-empty`, `memory-item-{id}`, `memory-filter-active/trash` |
| 操作 | `memory-pin-{id}`, `memory-edit-*`, `memory-delete-*`, `memory-restore-{id}`, `memory-empty-trash*` |
| 索引 | `memory-index-status`, `memory-reindex`, `memory-hybrid-needs-embed` |
| Chip | `memory-citations-chip`, `memory-citations-list` |
| 导航 | `settings-nav-memory` |

### 5.4 标签与命令

| Tag | 含义 | 默认 gate |
|-----|------|-----------|
| `@memory` | 无付费 memory UI/process 相关 WDIO | 否（首轮） |
| `@live` | 真 LLM | 否 |
| `@live @memory` | 真 LLM 记忆故事 | 否 |
| `@live @memory-hybrid` | 真 embed hybrid | 否 |

```bash
# L1（随 yarn test）
yarn test packages/sidecar/src/memory/process.e2e.test.ts

# L2
E2E_GREP=@memory yarn test:e2e

# L3
E2E_LIVE_LLM=1 E2E_GREP=@live.*memory yarn test:e2e
```

---

## 6. PR 目录（全量）

依赖：

```text
PR-T0  Testability（idle=0 语义锁定）
  │
  ├─► PR-T1  L1 process E2E（文件 DB + handlers + mock pipeline）
  │
  └─► PR-T2  __hipE2E memory hooks + L2 WDIO @memory
                │
                └─► PR-T3  L3 live memory + docs/CI 说明
```

| PR | 标题 | 层 | 付费 | 合入后可用 |
|----|------|----|------|------------|
| **PR-T0** | `test(memory): lock idleMinutes=0 extract scheduling` | 产品微 + 单测 | 否 | 加速配置可信 |
| **PR-T1** | `test(memory): process e2e on file db` | L1 | 否 | CI `yarn test` |
| **PR-T2** | `test(e2e): memory settings slash citations harness` | L2 + hooks | 否 | `E2E_GREP=@memory` |
| **PR-T3** | `test(e2e): live memory cross-session recall` | L3 + docs | 是（opt-in） | `E2E_LIVE_LLM=1` |

---

## 7. PR-T0 — Testability：idle / interval 语义

### 7.1 产品 / 技术要求

| 项 | 要求 |
|----|------|
| `idleMinutes: 0` | `scheduleMemoryExtractAfterTurn` 在下一 macrotask 内调用 `maybeEnqueueMemoryExtract`（debounce 重置行为保持） |
| `idleMinutes` 缺省 / 非法 | 保持现有 coalesce（`?? 15`）；**不**把 0 当成缺省 |
| `minExtractIntervalHours: 0` | 不因「距上次成功过近」跳过 |
| 生产默认 | **仍为** `idleMinutes: 15`、`minExtractIntervalHours: 6` |
| 文档 | 在 memory 设计或本 Spec 注明「0 = 立即调度，供测试 / 高级用户」 |

### 7.2 验收

| # | 验收 |
|---|------|
| T0.1 | 单测：`idleMinutes: 0` + fake timers → advance 0/1 tick 后 mock LLM 被调一次 |
| T0.2 | 单测：两次 schedule 仍合并为一次（debounce） |
| T0.3 | 单测：`minExtractIntervalHours: 0` 允许紧接第二次成功后 enqueue（在 daily limit 内） |
| T0.4 | 不改默认 defaults 快照测试（若已有） |

### 7.3 非范围

- 不引入 `HIP_MEMORY_E2E` 强制覆写（可选后续）  
- 不改 UI 暴露 idle 字段（若已有则不动）

### 7.4 主要文件

- `packages/sidecar/src/memory/pipeline/queue.ts`（仅当语义不符时改）  
- `packages/sidecar/src/memory/pipeline/queue.test.ts` 或 `integration.matrix` 增补  
- 可选：protocol 注释 `idleMinutes`

---

## 8. PR-T1 — L1 Process E2E

### 8.1 产品目标

在 **不启 Tauri** 的前提下，用 **临时目录文件 `hip.db` + MemoryService/handlers** 证明配置、CRUD、回收站、flags、mock Phase1/2、hybrid/FTS、citations 落库等主路径。

### 8.2 场景表（必须 / 可选）

| ID | 场景 | 必须 | 断言要点 |
|----|------|------|----------|
| M1.1 | setConfig 落盘 | ✓ | `memory.json` + getConfig |
| M1.2 | CRUD + soft delete + restore | ✓ | status / search 可见性 |
| M1.3 | emptyTrash | ✓ | hard 消失 |
| M1.4 | session memory flags 持久化 | ✓ | updateConfig + echo 语义（能测到 store 即可） |
| M1.5 | pinned → loadCoreSnapshot | ✓ | title 在 core 文本 |
| M1.6 | Phase2 mock + deleteBySourceSession hard | ✓ | item 真删 + sourceSessionId |
| M1.7 | Phase1：idle=0 + mock LLM + 长 transcript | ✓ | stage1 succeeded |
| M1.8 | Phase2 consolidate from stage1 | ✓ | active items |
| M1.9 | maxExtractsPerDay | ✓ | 第二次 skip / rate limit |
| M1.10 | hybrid mock + file DB + vec | ✓* | 序正确；*vec 不可用则 skip 或断言降级 |
| M1.11 | hybrid off / 无 embed → FTS | ✓ | 不崩溃，FTS 命中 |
| M1.12 | citations parse + strip + 持久化字段 | ✓ | 若走 store 列；否则 citations 模块 + message save 路径 |
| M1.13 | export jsonl → import | 可选 | 往返 |
| M1.14 | AGENTS 优先于 memory header | 可选 | 与 A1.4 重复度高，可不做 |

\* M1.10：若 CI 环境 sqlite-vec 加载失败，测试必须 **明确** `vecEnabled === false` 时走 M1.11 分支，**不得**红炸。

### 8.3 技术要求

| 项 | 要求 |
|----|------|
| DB | `mkdtemp` + 文件路径 `openDatabase(dbPath)`，**至少 1 条**不用 `:memory:` |
| LLM | mock `MemoryLlmClient` / spy `createDefaultMemoryLlmClient`，**零网络** |
| Embed | 确定性 mock factory（对齐 A1.8） |
| 与 A1 关系 | **不删除** `integration.matrix.test.ts`；process 文件补文件 DB / handlers 边界 |
| 命名 | 新建 `process.e2e.test.ts`；瘦身或重命名误导性的 `e2e.integration.test.ts` |

### 8.4 验收

| # | 验收 |
|---|------|
| T1.1 | `yarn test packages/sidecar/src/memory/process.e2e.test.ts` 全绿 |
| T1.2 | 全量 `yarn test` 不触发付费 LLM |
| T1.3 | M1.1–M1.9、M1.11 必过；M1.10 有条件通过或显式降级断言 |
| T1.4 | 文档交叉链接本 Spec §8 |

### 8.5 主要文件

```
packages/sidecar/src/memory/process.e2e.test.ts   # create
packages/sidecar/src/memory/e2e.integration.test.ts  # merge/delete/redirect
packages/sidecar/src/memory/handlers.ts           # only if bugs
packages/sidecar/src/memory/service.ts
packages/sidecar/src/persistence/open.ts          # file path smoke
```

---

## 9. PR-T2 — E2E Hooks + L2 App `@memory`

### 9.1 产品目标

用户在 **真应用** 中：打开 Memory 设置、双开、列表操作、回收站、slash 命令、citations chip（harness 注入）— **全程无真实模型回复**。

### 9.2 Hooks 验收

| # | 验收 |
|---|------|
| T2.H1 | DEV/e2e 构建 `window.__hipE2E.seedMemoryItem` 可用 |
| T2.H2 | PROD 不安装（现有守卫保持） |
| T2.H3 | `e2e/helpers/e2e-hooks.ts` + `e2e/helpers/memory.ts` 封装 |
| T2.H4 | 单测或类型：`HipE2EHooks` 扩展编译通过 |

### 9.3 UI 场景表

| ID | 场景 | 必须 | 断言 |
|----|------|------|------|
| M2.1 | Settings → Memory | ✓ | empty 或 config 面板 |
| M2.2 | enable both | ✓ | switches + list 区域 |
| M2.3 | enable use-only | 可选 | generate off |
| M2.4 | seed → list 可见 | ✓ | unique token |
| M2.5 | pin | ✓ | badge 或 hook 读回 pinned |
| M2.6 | edit save | ✓ | title 更新 |
| M2.7 | soft delete → trash → restore | ✓ | active 再可见 |
| M2.8 | empty trash | 可选 | list empty |
| M2.9 | `/memory` | ✓ | 打开 memory 设置 |
| M2.10 | `/memory-on` `/memory-off` | ✓ | flags via hook |
| M2.11 | `/memory-incognito` | 可选 | incognito true |
| M2.12 | `/memory-status` | 可选 | 有反馈 |
| M2.13 | hybrid 无 embed 时 disabled | ✓ | needs-embed 文案/testid |
| M2.14 | citations harness | ✓ | inject 带 memoryCitations 的 assistant → chip |
| M2.15 | DeleteSession 衍生记忆文案 | 可选 | i18n/testid |

### 9.4 技术要求

| 项 | 要求 |
|----|------|
| Spec 文件 | `e2e/specs/memory-settings.spec.ts`、`memory-slash.spec.ts`、`memory-citations-harness.spec.ts`（可合并，但 tag 清晰） |
| Tag | `describe('… @memory')` |
| Page object | `SettingsPage.nav` 支持 `'memory'` |
| 超时 | 单测默认 suite 180s 内；元素 wait ≤ 20s |
| 隔离 | 每测 unique id/token；不依赖 live auth |

### 9.5 验收

| # | 验收 |
|---|------|
| T2.1 | `E2E_GREP=@memory yarn test:e2e` 绿（本地 debug 二进制） |
| T2.2 | 未设 `E2E_LIVE_LLM` 时不发模型请求（无 generate 触发） |
| T2.3 | `e2e/README.md` 增加 `@memory` 行 |
| T2.4 | **不** 修改 `test:e2e:gate` grep（本 PR） |

### 9.6 主要文件

```
src/domain/sessionService.ts          # HipE2EHooks + installE2eHooks
e2e/helpers/e2e-hooks.ts
e2e/helpers/memory.ts                  # create
e2e/page-objects/SettingsPage.ts
e2e/specs/memory-settings.spec.ts      # create
e2e/specs/memory-slash.spec.ts         # create
e2e/specs/memory-citations-harness.spec.ts  # create
e2e/README.md
e2e/specs/settings-smoke.spec.ts       # optional memory nav
```

---

## 10. PR-T3 — L3 Live + 文档 / 运维

### 10.1 产品目标

在 **真实 API key + 真实模型** 下验证：用户教 agent 一条带 **唯一 token** 的偏好 → 异步 extract（idle=0）→（可选 consolidate）→ **新会话** 能召回。

### 10.2 场景表

| ID | 场景 | MVP | 断言策略 |
|----|------|-----|----------|
| M3.1 | Session A 教偏好（unique token） | ✓ | **硬**：`listMemories` / Settings 含 token；或 stage 可观测 |
| M3.2 | Session B 提问约定 | ✓ | **半硬**：hook 侧 core/prefetch 含 token；**软**：回复匹配 yarn/token |
| M3.3 | incognito 不落新 token | 可选 | 硬：list 无 token2 |
| M3.4 | soft delete 后不再召回 | 可选 | 半硬 prefetch 无 token |
| M3.5 | 手动 Consolidate | 可选 | list 变化 |
| M3.6 | hybrid live embed | 非 MVP | 单独 tag |

### 10.3 Live 断言策略（抗 flaky）

| 级 | 用途 |
|----|------|
| 硬 | DB/API：list / status / flags |
| 半硬 | snapshot / prefetch / debug bundle 含 token |
| 软 | 自然语言；失败可标 flaky，不作为唯一通过条件 |

**禁止：** 断言完整 LLM JSON 与 prompt 原文一致。

### 10.4 wdio / 配置

当 `E2E_LIVE_LLM=1` 时，`stageE2eData`（或等价）写入加速 `memory.json`：

```json
{
  "version": 1,
  "useMemories": true,
  "generateMemories": true,
  "idleMinutes": 0,
  "minExtractIntervalHours": 0,
  "maxExtractsPerDay": 50,
  "hybridSearchEnabled": false
}
```

- 每 run 已有新鲜 `HIP_DATA_DIR`；仍使用 **uuid token** 防模型串话。  
- suite 与 `live-chat` 隔离 session。

### 10.5 超时与成本

| 项 | 建议 |
|----|------|
| 等待 extract | ≤ 180s（poll list / hook） |
| 等待 chat 回复 | ≤ 120s（对齐 live-chat） |
| MVP 模型调用 | 约 2–6 次 completion（A 多轮 + B 一问 + 可选 extract） |
| 默认 CI | **不跑** |

### 10.6 验收

| # | 验收 |
|---|------|
| T3.1 | `e2e/specs/live-memory.spec.ts` 存在；无 `E2E_LIVE_LLM` 时 **self-skip** |
| T3.2 | 文档化命令、前置（auth.json、debug build）、成本 |
| T3.3 | 更新概述计划状态与本 Spec 状态 → Implemented（partial/full） |
| T3.4 | M3.1+M3.2 在维护者机器上可重复 ≥2/3（人工记录即可，不做 flaky 重试框架） |

### 10.7 主要文件

```
e2e/specs/live-memory.spec.ts         # create
wdio.conf.ts                           # stage memory.json when live
e2e/README.md
docs/superpowers/plans/2026-07-11-memory-real-e2e-test-plan.md
docs/superpowers/specs/2026-07-11-memory-real-e2e-spec.md
docs/superpowers/plans/2026-07-11-memory-real-e2e-prs.md
```

---

## 11. 场景 × PR 映射总表

| 场景 | T0 | T1 | T2 | T3 |
|------|----|----|----|-----|
| idle=0 语义 | ✓ | 用 | 用 | 用 |
| Config 落盘 | | ✓ | UI | stage |
| CRUD / trash | | ✓ | ✓ UI | 可选 |
| Flags / slash | | flags API | ✓ | ✓ |
| Phase1/2 mock | | ✓ | — | — |
| Phase1/2 live | | — | — | ✓ |
| Hybrid mock/file | | ✓ | UI 门闩 | 可选 live |
| Citations | | 落库可选 | harness UI | 若模型出 fence |
| Cross-session recall | | 间接 | seed 模拟 | ✓ 真 |

---

## 12. 风险与缓解

| 风险 | 缓解 | 负责 PR |
|------|------|---------|
| idle 语义误解 | T0 单测锁定 | T0 |
| vec 本机失败 | 条件分支 / FTS 降级断言 | T1 |
| WDIO 共享进程污染 | unique token；测后复位 flags | T2 |
| Live 非确定 | 硬/半硬主断言；token | T3 |
| 付费误触 | mock 注入；LIVE 门闩；CLAUDE.md 约定 | 全 |
| 与 A1 重复 | process 聚焦文件 DB + handlers | T1 |
| gate 变慢 | `@memory` 暂不进 gate | T2/T3 |

---

## 13. 完成定义

| 级别 | 定义 |
|------|------|
| **MVP** | T0 + T1（M1.1–M1.9, M1.11）+ T2（hooks + M2.1–2.2, 2.4, 2.7, 2.9, 2.14） |
| **完整无付费** | MVP + T1 剩余 + T2 全部必须项 + README |
| **Live MVP** | T3 M3.1 + M3.2 + 文档 |
| **Live 完整** | + M3.3–M3.5；M3.6 可选 |

---

## 14. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-11 | 初稿：4 PR（T0–T3）全量 Spec |
