# 记忆系统真实 E2E 测试计划

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **Implemented (code landed)** — T0–T3 已合入本地 dev；L2 需 `yarn test:e2e` 验证；L3 需 `E2E_LIVE_LLM=1` |
| 前置 | V1 + A+B+C 已合入本地 `dev`；集成矩阵 A1.1–A1.9 已绿 |
| **全 PR Spec** | [`../specs/2026-07-11-memory-real-e2e-spec.md`](../specs/2026-07-11-memory-real-e2e-spec.md) |
| **全 PR 实现计划** | [`./2026-07-11-memory-real-e2e-prs.md`](./2026-07-11-memory-real-e2e-prs.md) |
| 相关设计 | [`../specs/2026-07-11-cross-session-memory-system-design.md`](../specs/2026-07-11-cross-session-memory-system-design.md)、[`../specs/2026-07-11-memory-phase-next-spec.md`](../specs/2026-07-11-memory-phase-next-spec.md) |
| 现有 app E2E | [`e2e/README.md`](../../../e2e/README.md)、`wdio` + `__hipE2E` |
| 现有 sidecar 矩阵 | `packages/sidecar/src/memory/integration.matrix.test.ts` |

---

## 1. 目标与边界

### 1.1 要解决什么

当前记忆测试以 **单元 + 进程内集成（mock LLM / 内存 SQLite）** 为主：

| 层 | 现状 | 缺口 |
|----|------|------|
| Unit (`*.test.ts`) | 厚 | — |
| Integration matrix A1.x | 厚（mock LLM） | 不经 WS、不经 UI、不经真实 `hip.db` 文件 |
| `e2e.integration.test.ts` | 1 条轻量 | 名不副实 |
| App WDIO (`e2e/specs/*`) | **无 memory** | Settings / slash / chip / 跨会话 0 覆盖 |
| Live LLM (`@live`) | 仅 chat pong | 无 extract / consolidate / recall |

**「真实 E2E」** 在本计划中定义为：

> 覆盖 **用户可感知闭环** 与 **进程边界**，而不是再加一批 mock 同进程断言。  
> 默认 gate **仍不依赖付费 LLM**；真实模型路径 **opt-in**，与 `E2E_LIVE_LLM` 一致。

### 1.2 Goals

| ID | 目标 |
|----|------|
| E1 | **无 LLM** 路径可进 PR gate：开关、CRUD、回收站、slash、pin→core 可观测 |
| E2 | **跨会话 recall** 可验证：Session A 写入 → Session B 注入/引用 |
| E3 | **pipeline 闭环**（Phase1→2）可在加速配置下跑通（mock 或 live 分轨） |
| E4 | **hybrid / FTS 降级** 在真实 sidecar + `sqlite-vec` 加载环境下可验证 |
| E5 | Live 路径失败时 **不污染 gate**；成本与 flakiness 可控 |

### 1.3 Non-Goals

| ID | 非目标 |
|----|--------|
| N1 | 替换现有 unit / A1 矩阵（它们仍是回归主力） |
| N2 | 全量 prompt 质量评测 / 红队 |
| N3 | 多设备同步、云记忆 |
| N4 | Wave D（skill 晋升、remount） |
| N5 | 在 CI 默认 job 中强制打真实 embeddings API |

---

## 2. 测试金字塔（记忆专用）

```text
                    ┌─────────────────────────┐
                    │  L3  Live product E2E    │  opt-in @live
                    │  真 LLM extract + chat   │  手工 / nightly secret
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  L2  App UI E2E (WDIO)   │  gate 可进 @memory
                    │  真 Tauri + sidecar + UI │  无付费（seed / mock bridge）
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  L1  Sidecar process E2E │  vitest 或独立 runner
                    │  真 DB 文件 + WS handlers │  mock LLM / mock embed
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │  L0  Unit + A1 matrix    │  已有（保持）
                    └─────────────────────────┘
```

**原则：** 能在 L1 稳定证明的不放到 L2；能在 L2 无 LLM 证明的不放到 L3。

---

## 3. 可测性前提（实现前先补）

真实 E2E 依赖少量 **显式测试钩子**（与现有 `__hipE2E` 风格一致）。**不要**靠改 production 默认 idle=0。

### 3.1 配置可加速（已有能力，需在 E2E 里用）

| 配置 | 默认 | E2E 建议 |
|------|------|----------|
| `idleMinutes` | 15 | L1/L3 设 `0` 或 `0.01`（若类型为 number 分钟，用最小正数 + 立即 consolidate） |
| `minExtractIntervalHours` | 6 | `0` |
| `maxExtractsPerDay` | 20 | 保持或抬高 |
| `useMemories` / `generateMemories` | false | 场景显式打开 |
| `hybridSearchEnabled` | false | hybrid 场景再开 |

**落盘：** E2E 启动时向 `HIP_DATA_DIR/config/memory.json` 写入测试配置（`wdio` 已用独立 `HIP_DATA_DIR`）。

> 若 `idleMinutes` 仅支持整数分钟且 `0` 语义未定义，**先修语义**：`0` = 本 turn 结束后尽快 enqueue（或提供 `HIP_MEMORY_E2E=1` 强制 `idle=0`）。这是 L3 与「真实 idle 后 extract」的前置。

### 3.2 `__hipE2E` 记忆扩展（L2 必需）

在 `sessionService.installE2eHooks` / `e2e/helpers/e2e-hooks.ts` 增加（命名示意）：

| Hook | 用途 |
|------|------|
| `seedMemoryItem(partial)` | 绕过 UI 写入一条 active memory（经 WS `memory:upsert` 或直接调 domain API） |
| `getMemoryConfig()` / `setMemoryConfig(partial)` | 加速 idle、开 dual flags |
| `listMemories(filter?)` | 断言列表 / trash |
| `triggerMemoryConsolidate(projectKeyHash?)` | 触发 Phase2（等价 UI Consolidate） |
| `getLastMemoryPipelineEvent()` 或订阅 | 可选：断言 `memory:pipeline` phase |
| `getActiveSessionMemoryFlags()` | 断言 `/memory-on` 等 |

**约束：** 仅 DEV / e2e 构建暴露；production 不安装。

### 3.3 Page objects / testids（L2）

| 项 | 状态 | 动作 |
|----|------|------|
| `MemoryConfig` data-testid | **已有**（`memory-config`、`memory-switch-*`、`memory-list`、`memory-item-*`…） | 直接用 |
| `settings-nav-memory` | **已有** | `SettingsPage.nav` 类型扩展加 `'memory'` |
| settings smoke `PAGES` | **缺 memory** | 加一行 smoke（可选，属 @settings） |
| slash `/memory*` | UI 已有 | L2 断言导航 / flags |
| `memory-citations-chip` | 组件已有 | L3 或 harness 注入消息断言 |

### 3.4 Sidecar mock 注入点（L1 / 部分 L2）

| 依赖 | 策略 |
|------|------|
| Phase1/2 LLM | L1：`createDefaultMemoryLlmClient` 可注入 / env `HIP_MEMORY_LLM_MOCK=1` 返回固定 JSON |
| Embedding | L1：确定性向量 factory（对齐 A1.8） |
| Live | L3：真实 client + `auth.json` |

**推荐：** 新增 env `HIP_MEMORY_E2E_FIXTURE=1`：

- 强制 `idleMinutes=0`、`minExtractIntervalHours=0`
- Phase1/2 使用内置 fixture LLM（不写死在业务路径，仅 e2e bootstrap）
- 可选 fixture embed

这样 L2 也可跑「假 pipeline」而不付费。

---

## 4. 场景目录（按优先级）

图例：

- **Gate**：默认可进 `yarn test:e2e:gate` 或 sidecar CI
- **Nightly**：无付费但慢 / 重
- **Live**：`E2E_LIVE_LLM=1`

### 4.1 Tier L1 — Sidecar process E2E（优先实现）

**运行形态：** vitest，`openDatabase(tmpHipDbPath)` 或起短生命周期 sidecar + 内存/文件 WS client。  
**不启 Tauri UI。**

| ID | 场景 | 步骤摘要 | 断言 | 轨 |
|----|------|----------|------|-----|
| M1.1 | 配置落盘 | `memory:setConfig` dual-on | `memory.json` 存在；`getConfig` 一致 | Gate |
| M1.2 | CRUD + trash | upsert → list active → soft delete → list deleted → restore | status / search 可见性 | Gate |
| M1.3 | emptyTrash | 2 条 deleted → emptyTrash | hard 消失；FTS 无残留 | Gate |
| M1.4 | flags 持久化 | `session:setMemoryFlags` → reload session row | `session:memoryFlags` 回显 | Gate |
| M1.5 | core snapshot 注入装配 | pinned upsert → `loadCoreSnapshot` → injector registry | system 含 title；AGENTS 在前 | Gate（可复用 A1.4 加固为文件 DB） |
| M1.6 | derived hard delete | Phase2 mock → `deleteBySourceSession` | item 真删 | Gate |
| M1.7 | Phase1 加速 | idle=0 + mock LLM + 长 transcript → enqueue | stage1 succeeded | Gate |
| M1.8 | Phase2 加速 | stage1 + consolidate | items + `sourceSessionId` | Gate |
| M1.9 | daily limit | maxExtractsPerDay=1，第二次 skip | reason 可观测 | Gate |
| M1.10 | hybrid file-DB | mock embed + vec | searchScoped 序正确；关 hybrid → FTS | Gate |
| M1.11 | citations 落库 | finalize 带 fence 文本 | `memory_citations` 列 + strip content | Gate |
| M1.12 | export / import | export jsonl → wipe → import | id/title 恢复 | Gate |

**交付物建议：**

- 扩展 `integration.matrix.test.ts` **或** 新建 `packages/sidecar/src/memory/process.e2e.test.ts`
- 使用 **临时目录 `hip.db`**（非 `:memory:`）至少覆盖 M1.1 / M1.10（验证 schema 迁移 + vec 加载）
- 将现有 `e2e.integration.test.ts` 降级注释或并入，避免双名混淆

**成功标准：** `yarn test` 内全绿；无网络。

---

### 4.2 Tier L2 — App UI E2E（WDIO，无付费 LLM）

**运行形态：** 现有 `yarn test:e2e`；标签 `@memory`；**不** 依赖 assistant 真实回复。

| ID | 场景 | 步骤摘要 | 断言 | 轨 |
|----|------|----------|------|-----|
| M2.1 | Settings 入口 | openSettings → nav memory | `memory-config-empty` 或 `memory-config` | Gate |
| M2.2 | 一键双开 | empty CTA `memory-enable-both` | switches on；list 区域出现 | Gate |
| M2.3 | 仅 use | `memory-enable-use-only` | use on / generate off；cost hint 逻辑 | Gate |
| M2.4 | 列表 seed | hook seed 带 unique token | `memory-list` 含 token | Gate |
| M2.5 | pin | pin 按钮 | badge；可选：再 seed 后 core 侧由 hook 读 snapshot | Gate |
| M2.6 | 行内编辑 | edit → save | 列表 title 更新 | Gate |
| M2.7 | soft delete → trash → restore | delete confirm → filter trash → restore | active 再可见 | Gate |
| M2.8 | empty trash | trash 中 empty | list empty | Gate |
| M2.9 | `/memory` | slash 执行 | Settings memory 页打开 | Gate @core 或 @memory |
| M2.10 | `/memory-on` `/memory-off` | slash + hook get flags | flags 变化 | Gate |
| M2.11 | `/memory-incognito` | slash | incognito true；generate 侧不 extract（L1 已证，L2 只证 flag） | Gate |
| M2.12 | `/memory-status` | slash | 状态文案可见（toast/system 以产品为准） | Gate |
| M2.13 | hybrid UI 门闩 | 无 embed 时 hybrid switch disabled | `memory-hybrid-needs-embed` | Gate |
| M2.14 | 角色模型区 | Model 页 extract/embed 下拉可写（若 testid 齐） | setConfig 后 hook 读回 | Nightly / @settings |
| M2.15 | citations chip UI | injectServerMessage 带 `memoryCitations` | chip + list 可见 | Gate @harness |
| M2.16 | 删会话勾选文案 | 打开 DeleteSessionDialog | 含「衍生记忆」类文案（i18n key 稳定断言） | Gate |

**不放 L2 的：** 真实多轮对话后自动 extract（→ L3）。

**交付物：**

```text
e2e/specs/memory-settings.spec.ts      # M2.1–M2.8, M2.13
e2e/specs/memory-slash.spec.ts         # M2.9–M2.12
e2e/specs/memory-citations-harness.spec.ts  # M2.15
e2e/helpers/memory.ts                  # openMemorySettings, seed, waitList
e2e/page-objects/SettingsPage.ts       # nav('memory')
```

**超时：** 单测 ≤ 60s；suite ≤ 180s（与现有一致）。

**成功标准：** `E2E_GREP=@memory yarn test:e2e` 绿；`E2E_LIVE_LLM` 未设。

---

### 4.3 Tier L3 — Live product E2E（真 LLM，opt-in）

**运行：** `E2E_LIVE_LLM=1 yarn test:e2e:live`（或 `E2E_GREP=@live.*memory`）。  
**前置：** `auth.json` 已由 wdio 拷入 `HIP_DATA_DIR`；用户已配置可用 chat +（可选）embedding 模型。

#### 4.3.1 核心故事：跨会话学会偏好

| ID | 场景 | 步骤 | 断言（宽松） | 成本感 |
|----|------|------|--------------|--------|
| M3.1 | 写入偏好 | 开 use+generate；`idleMinutes=0`；Session A 明确说 **唯一 token** 偏好（如 `HIP_E2E_MEM_TOKEN_<uuid> prefers yarn-not-npm`）多轮达到 min turns | 120–180s 内 stage1 或 Settings 列表出现 **token 子串** 或 consolidate 后 item | 中（2–4 次 completion） |
| M3.2 | 跨会话 recall | **新 Session B**（同 project cwd）；use=on；问「我们包管理器约定是什么？」 | 助手回复提及 yarn / token；**或** 存在 citations chip；**或** debug bundle / hook 显示 prefetch 含 token | 中 |
| M3.3 | incognito 隔离 | Session C incognito；再聊新偏好 token2 | 列表 **无** token2；不写 stage1 | 低–中 |
| M3.4 | 用户 soft 删 | 对 M3.1 item 软删 | Session D 不再引用该偏好（回复或 prefetch 无 token） | 低 |
| M3.5 | 手动 consolidate | 有 stage1 时点 Consolidate | pipeline 完成；列表有 lesson/preference | 中 |
| M3.6 | hybrid live（可选） | 配置 embedding；hybrid on；reindex；语义近义查询 | 相关 item 进入 prefetch / 列表搜索（若 UI 有） | 高（embed 调用） |

#### 4.3.2 Live 断言策略（抗 flaky）

| 层级 | 用法 |
|------|------|
| **硬断言** | DB/API：`listMemories` 含 unique token；flags；soft-delete 后 status |
| **半硬** | system/debug：prefetch / core snapshot 含 token（经 hook 或 copy-debug bundle） |
| **软断言** | 助手自然语言：正则 `/yarn/i` + token；失败标 `flaky-live` 不阻断 nightly 外 job |

**禁止：** 断言完整 LLM JSON schema 与 prompt 一字不差。

#### 4.3.3 加速与隔离

```jsonc
// HIP_DATA_DIR/config/memory.json (staged in wdio beforeSession when E2E_LIVE_LLM=1)
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

- 每 suite 使用 **unique token**（避免与历史记忆串味；`HIP_DATA_DIR` 已是新鲜目录，仍建议 token 防模型胡编碰撞）。
- 不与 `@live` chat pong 抢同一 session；独立 `describe`。

**成功标准：** 本地/手动 job 可重复跑通 M3.1+M3.2；M3.6 单独 tag `@live @memory-hybrid`。

---

## 5. 场景与产品能力映射

| 产品能力 | L0/A1 | L1 | L2 | L3 |
|----------|-------|----|----|-----|
| Opt-in 默认关 | ✓ | ✓ | ✓ empty CTA | — |
| use / generate 开关 | ✓ | ✓ | ✓ | ✓ |
| Manual upsert / pin / edit | ✓ | ✓ | ✓ | — |
| Soft delete / restore / empty trash | ✓ | ✓ | ✓ | ✓ 选用 |
| FTS search / prefetch | ✓ | ✓ | — | 间接 |
| Hybrid + vec 降级 | ✓ mock | ✓ file DB | UI 门闩 | 可选 live embed |
| Phase1 extract | mock | mock 加速 | fixture env | **真 LLM** |
| Phase2 consolidate | mock | mock | 按钮+fixture | **真 LLM** |
| Core inject 顺序 vs AGENTS | ✓ | ✓ | — | 间接 |
| Incognito | ✓ | ✓ | flags UI | ✓ |
| Citations chip | unit UI | 落库 | harness inject | live 若模型输出 fence |
| Slash `/memory*` | unit | — | ✓ | — |
| deleteBySourceSession | ✓ | ✓ | 文案 | 选用 |
| Export/import | unit | ✓ | 可选 UI | — |
| 日限额 | unit | ✓ | — | — |

---

## 6. 实现顺序（4 个 PR — 权威切片）

> 详细 Spec / 任务 checkbox / 验收表见：  
> - Spec: [`../specs/2026-07-11-memory-real-e2e-spec.md`](../specs/2026-07-11-memory-real-e2e-spec.md)  
> - Plan: [`./2026-07-11-memory-real-e2e-prs.md`](./2026-07-11-memory-real-e2e-prs.md)

| PR | 标题 | 层 | 付费 |
|----|------|----|------|
| **PR-T0** | `idleMinutes=0` 语义锁定 + 单测 | 可测性 | 否 |
| **PR-T1** | `process.e2e.test.ts` 文件 `hip.db` | L1 | 否 |
| **PR-T2** | `__hipE2E` memory hooks + WDIO `@memory` | L2 | 否 |
| **PR-T3** | `live-memory.spec.ts` + wdio stage + docs | L3 | opt-in |

```text
T0 ──► T1 (process e2e)
  └──► T2 (hooks + UI e2e) ──► T3 (live)
```

**合并顺序：** T0 → T1 → T2 → T3。  
**首轮不进** `test:e2e:gate`；稳定后再议 `@memory`。

---

## 7. 命令与 CI 矩阵

| Job | 命令 | 记忆相关 |
|-----|------|----------|
| Unit/integration | `yarn test` | L0 + L1 |
| E2E gate | `yarn test:e2e:gate` | 未来可加 `@memory` |
| E2E memory only | `E2E_GREP=@memory yarn test:e2e` | L2 |
| Live chat | `E2E_LIVE_LLM=1 yarn test:e2e:live` | 现有 |
| Live memory | `E2E_LIVE_LLM=1 E2E_GREP=@live.*memory yarn test:e2e` | L3 |

**CI 建议：**

| 触发 | 包含 |
|------|------|
| PR | L0+L1；L2 `@memory` 若 <2min 则进 gate |
| Nightly | 全量 e2e 除 live |
| Manual / secret | L3 |

**付费隔离（保持 CLAUDE.md 约定）：**

- L1/L2 **禁止** 读用户 `auth.json` 调模型  
- L3 仅 `E2E_LIVE_LLM=1`  
- 文档提醒：跑全量 `yarn test` 时注意 sidecar 路径勿误触 real-LLM 测试

---

## 8. Flaky / 风险与缓解

| 风险 | 缓解 |
|------|------|
| Idle 15min 无法 E2E | `idleMinutes=0` / E2E env（§3.1） |
| Live 输出不稳定 | unique token + 硬/半硬/软三层断言（§4.3.2） |
| Phase1 min turns / 短会话 | fixture 多轮消息或 live 发够轮次 |
| sqlite-vec 本机未装 | L1 分支：vec false → 仅断言 FTS 降级不崩溃 |
| 共享 Tauri 进程状态污染 | 每测 seed 独立 id；flags 测后复位；新鲜 `HIP_DATA_DIR` |
| 列表虚拟化 / 异步 refresh | `waitUntil` 查 testid，禁止固定长 sleep 作主逻辑 |
| 中文 i18n | 优先 testid；文案断言用 i18n 双方或 regex |
| 成本 | L3 限 M3.1+M3.2；hybrid 单独 tag |
| 安全 | E2E 数据目录可删；不把真实密钥写进 repo fixture |

---

## 9. 观测与调试

| 手段 | 用途 |
|------|------|
| `memory:pipeline` 事件 | Phase 起止（L1 订阅 send；L2 hook） |
| `memory:indexStatus` | embed 覆盖率 |
| WDIO screenshot on fail | 已有 `E2E_SCREENSHOT_DIR` |
| `getSessionDebugBundleJson` | 可选扩展含 memory flags / last prefetch ids |
| 临时 `HIP_DATA_DIR` 保留 | `E2E_DATA_DIR` 固定以便查 `hip.db` / `memory.json` |

调试一次失败：

```bash
E2E_DATA_DIR=/tmp/hip-mem-e2e-debug E2E_GREP=@memory yarn test:e2e --spec e2e/specs/memory-settings.spec.ts
# 然后 sqlite3 $E2E_DATA_DIR/db/hip.db 'select id,title,status from memories;'
```

（实际 db 相对路径以 persistence 实现为准，文档实现时核对 `openDatabase` 路径。）

---

## 10. 验收定义（计划完成时）

| 级别 | 完成定义 |
|------|----------|
| **MVP** | PR-E1：M1.1–M1.8 绿；PR-E2：M2.1–M2.7 + M2.9 绿 |
| **完整** | MVP + M1.9–M1.12 + M2.10–M2.16 + README |
| **Live** | M3.1 + M3.2 在文档化命令下可重复成功 ≥2/3 次 |

---

## 11. 与「已有 A1 矩阵」的分工（避免重复劳动）

| A1 | 保留？ | 真实 E2E 增量 |
|----|--------|----------------|
| A1.1 core snapshot | 是 | L2 pin 可视化；L3 跨会话 |
| A1.2 incognito | 是 | L2 flags；L3 不落库 |
| A1.3 derived delete | 是 | L1 文件 DB 再跑一条即可 |
| A1.4 AGENTS 优先 | 是 | 不必 UI |
| A1.5 generate=false | 是 | L2 switch |
| A1.6 idle debounce | 是（fake timers） | L1/L3 真 timer `idle=0` |
| A1.7 trash | 是 | L2 完整 UI |
| A1.8 hybrid mock | 是 | L1 file+vec；L3 可选 |
| A1.9 FTS 降级 | 是 | L1 vec probe false |

**结论：** A1 不删；真实 E2E 补 **进程边界、UI、真时钟、真模型**。

---

## 12. 建议的首轮执行清单（可直接开干）

1. **定稿 `idleMinutes: 0` 语义**（代码 + 单测 10 行级）  
2. **L1** `process.e2e.test.ts`：配置落盘 + trash + mock Phase1/2 + file DB  
3. **`__hipE2E` seed/list/config**  
4. **L2** `memory-settings.spec.ts`（empty → enable → seed → delete → restore）  
5. **L2** `/memory` slash  
6. **L3** 草稿 `live-memory.spec.ts`（可先 `describe.skip` 直到 idle=0 稳定）  
7. 更新 `e2e/README.md` tags 表加 `@memory`

---

## 13. 开放问题（实现前拍板）

| # | 问题 | 建议默认 |
|---|------|----------|
| Q1 | `@memory` 是否进 `test:e2e:gate`？ | 先独立 grep；稳定一周后进 gate |
| Q2 | L1 用 vitest 还是起完整 sidecar 子进程？ | 先 vitest + 真文件 DB + handlers；子进程留到有 WS 回归 bug 时 |
| Q3 | Live 是否强制同一 provider 的 embedding？ | M3.1–2 默认关 hybrid；M3.6 单独 |
| Q4 | Phase1 是否允许 UI「立即提取」按钮？ | 本计划不新增产品按钮；靠 idle=0 + consolidate |
| Q5 | 中文 UI 断言？ | testid 优先 |

---

## 14. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-11 | 初稿：L0–L3 分层、场景表、PR 切片、可测性钩子 |
| 2026-07-11 | 对齐全 PR Spec/Plan：4 PR（T0–T3）；§6 改为权威链接 |
