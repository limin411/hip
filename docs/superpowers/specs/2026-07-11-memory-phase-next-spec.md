# hip 记忆系统下一阶段（Post-V1）产品与技术 Spec

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **Approved — plan ready**（rev 2） |
| 前置 | V1 已合入 `dev`（`feat/cross-session-memory` → fast-forward） |
| 权威 V1 设计 | [`2026-07-11-cross-session-memory-system-design.md`](./2026-07-11-cross-session-memory-system-design.md) rev 3 |
| 实现计划（V1） | [`../plans/2026-07-11-cross-session-memory-system.md`](../plans/2026-07-11-cross-session-memory-system.md) |
| 实现计划（本迭代 A+B+C） | [`../plans/2026-07-11-memory-phase-next.md`](../plans/2026-07-11-memory-phase-next.md) |

---

## 1. Overview

V1 交付了 **opt-in、SQLite 权威、FTS 检索、Phase1/2 异步进化、设置 / slash / citations**。

**本迭代范围（已拍板）：Wave A + B + C**（P0 硬化 + P1 体验/成本/**回收站** + P2 hybrid 语义检索）。  
**本迭代不做：** Wave D（skill 候选、project remount）—— 留后续。

目标顺序不变：**可信度 → 可用性 → 检索质量**。

**原则：**

- 仍默认 opt-in；**不**自动改写 `AGENTS.md`
- 无 embedding 配置 / sqlite-vec 不可用时 hybrid **必须** 降级 FTS
- **接受 `sqlite-vec` 原生依赖进入 sidecar**，向量与业务表同库 `hip.db`
- Embedding 采用 **主流云侧 OpenAI-compatible embeddings API**（非本地小模型强制捆绑）

---

## 2. 已锁定产品决策

| # | 决策 | 锁定值 | 说明 |
|---|------|--------|------|
| Q1 | 下一迭代边界 | **A + B + C** | 同一列车交付到 hybrid 可用 |
| Q2 | Embedding 策略 | **主流方案**（见 §5） | 用户配置 OpenAI-compatible embedding；提供「按当前对话 provider 一键建议」；hybrid 开启时 embedding **必填** |
| Q3 | Rerank | **可选** | UI 灰显可配；未配置则跳过二阶段排序 |
| Q4 | 向量存储 | **`sqlite-vec` 进 sidecar + `hip.db`** | probe 失败 → 禁用 hybrid，仅 FTS |
| Q5 | extract 默认模型 | 保持 V1 **cheap**；Settings 可改 | — |
| Q6 | Undo / 回收站 | **进 P1（Wave B）** | soft-delete 可恢复；非完整版本树 |

---

## 3. V1 现状与缺口

### 3.1 已具备

| 能力 | 位置（概览） |
|------|----------------|
| 协议 / WS / flags | `@hip/protocol` memory-types + messages |
| 表 v16/v17 + FTS | `persistence/schema.ts`, `memory/store.ts` |
| 配置 / 脱敏 / 扫描 / Service | `memory/config|redact|threat-scan|service` |
| 注入 + tools + 子代理跳过 | `MemoryInjector`, `buildMemoryTools` |
| Phase1/2 + mirror + decay | `pipeline/*`；idle debounce；`sourceSessionId` 溯源 |
| UI | Settings Memory、slash、citations chip、删会话衍生勾选 |

### 3.2 本迭代要关掉的缺口

| ID | 缺口 | Wave |
|----|------|------|
| G1 | Settings pin / 行内编辑 / status 筛选 | A–B |
| G2 | extractModel 目录下拉 | B |
| G3 | 集成测试矩阵 | **A** |
| G4 | citations `allowedIds` + chip popover | B |
| G5 | extract 日限额等 | B |
| G6 | 向量 / 重排角色模型配置 | **B（先于 C）** |
| G7 | embedding 索引 + hybrid score | **C** |
| G10 | Undo / 回收站 | **B** |

### 3.3 明确延后（Wave D / 以后）

| ID | 项 |
|----|-----|
| G8 | skill 晋升候选 |
| G9 | project remount |
| G11 | multi-worker lease |

---

## 4. Goals & Non-Goals

### Goals（本迭代 A+B+C）

| ID | 目标 |
|----|------|
| NG1 | 审查完整：pin / edit / filter；**回收站恢复** |
| NG2 | 集成测试覆盖 V1 主路径 + derived-delete + idle |
| NG3 | 模型配置：**extract + embedding + 可选 rerank** |
| NG4 | **Hybrid 检索**（sqlite-vec + OpenAI-compatible embed）；可关可降级 |
| NG5 | extract 成本可控（日限额 + 文案） |
| NG6 | citations 生产路径支持 fence + allowed inline ids |

### Non-Goals

| ID | 非目标 |
|----|--------|
| NN1 | 云同步 / 多设备记忆 |
| NN2 | 外部 Mem0/Honcho provider |
| NN3 | 自动改写 `AGENTS.md` / in-repo `MEMORY.md` |
| NN4 | 知识图谱 / GraphRAG |
| NN5 | 改 API key 存储模型 |
| NN6 | Skill 自动安装、project remount（Wave D） |
| NN7 | 本地强制捆绑 embedding 权重文件（除非用户自建 OpenAI-compatible 端点） |

---

## 5. Embedding 主流方案（锁定）

对齐 Codex/Mem0/生产 coding agent 常见做法：

| 维度 | 方案 |
|------|------|
| API | **OpenAI-compatible** `POST {baseURL}/embeddings`，body `{ model, input }` |
| 鉴权 | 复用 `auth.json` 中对应 `providerID` 的 key（与 chat 相同） |
| 默认建议 | UI「使用推荐 embedding」：若 active chat provider 为 openai 系 → 建议 `text-embedding-3-small`（或 catalog 中标注 embedding 的等价模型）；其他 provider → 仅提示用户在目录中选择 / 填自定义 model id，**不静默选错** |
| 必填时机 | **`hybridSearchEnabled=true` 时** `embeddingModel` 必填；仅 FTS 可永不配置 |
| 维度 | 首次 embed 成功后写入 `memory_embeddings.dim`；模型变更 → stale + 要求 reindex |
| 索引内容 | `title + "\n" + content`（截断上限可配，默认 8k chars） |
| 失败策略 | 单条 embed 失败记日志，不阻断 upsert；检索时该条仅走 FTS |
| 隐私文案 | Settings 明示：向量由所选供应商 API 计算，明文记忆片段会出站 |

**不采用（本迭代）：** 强制下载本地 GGUF embedding、默认关联网上第三方 Mem0 云。

---

## 6. 分波 Spec（本迭代执行顺序）

```text
Wave A (P0) ──► Wave B (P1: UX + 角色模型 + 回收站 + 成本)
                      │
                      └── embedding/rerank 配置就绪
                               │
                               ▼
                         Wave C (P2: sqlite-vec + hybrid)
```

闸门：**A1 集成矩阵绿** 后才合 C 的默认开 hybrid 相关；C 可与 B 后半并行开发，但 **合入顺序 A → B1 → C**。

---

### Wave A — P0 Hardening

**产品目标：** 已承诺能力可验证。

#### A1. 集成测试矩阵

| # | 场景 | 断言 |
|---|------|------|
| A1.1 | 手动 upsert → 新 session `use=true` | core / system 含 title |
| A1.2 | `incognito=true` | 不 Phase1；不 inject |
| A1.3 | Phase2 item `sourceSessionId` + derived delete | hard 后为空 |
| A1.4 | AGENTS + Memory | AGENTS 在 memory 前；priority 文案存在 |
| A1.5 | `generate=false` | 无 stage1 |
| A1.6 | idle debounce | timer mock 下合并触发 |

#### A2. 审查基线（列表）

| 需求 | 说明 |
|------|------|
| list 默认 active | UI + API 一致 |
| pin 切换 | upsert pinned；进 core titles |
| 行内编辑 | redact/scan |
| soft 删除确认 | 进入回收站语义（与 B6 对齐：soft = trash） |

#### A3. 可观测性

- 统一 pipeline 日志字段  
- 可选 UI 最近 `memory:pipeline`  
- 更新 persistence data-model 文档  

**验收：** A1 全绿。

---

### Wave B — P1 UX / 成本 / 角色模型 / 回收站

#### B1. 模型角色配置（C 的硬前置）

**设置 → 模型** 增加 **「专用模型 / Role models」**：

| 角色 | 必填条件 | 存储 |
|------|----------|------|
| 对话 activeModel | 已有 | 现有 |
| extractModel | 否 | `memory.json`，`MemoryModelRef \| string` 兼容 |
| **embeddingModel** | hybrid 开时必填 | `MemoryModelRef` |
| **rerankModel** | 否 | `MemoryModelRef` 可选 |

```ts
export interface MemoryModelRef {
  providerID: string
  modelID: string
  baseURL?: string
}

// MemoryFileConfig 增补
embeddingModel?: MemoryModelRef
rerankModel?: MemoryModelRef
hybridSearchEnabled?: boolean  // 默认 false
maxExtractsPerDay?: number     // 默认 20
trashRetentionDays?: number    // 默认 30（回收站）
```

- 「一键建议 embedding」：见 §5  
- Rerank：可选；未配置跳过  
- Wave B **只落配置 + 校验**；真正检索融合在 C  

#### B2. extractModel 下拉

Memory 设置页：chat 模型目录选择；清空 = cheap 回退。

#### B3. 成本门控

| 旋钮 | 默认 | 行为 |
|------|------|------|
| `maxExtractsPerDay` | 20 | 超额 skip Phase1，`rate_limited` |
| Settings 文案 | — | 后台费用说明 |

#### B4. Citations

- finalize 传入本 turn 注入 id 集合为 `allowedIds`  
- chip popover 展示 titles  
- i18n 补齐  

#### B5. Slash

- `/memory` → Settings memory tab  
- `/memory-status` → flags + 条数 + 上次 Phase2  

#### B6. Undo / 回收站（**P1 锁定**）

| 行为 | 语义 |
|------|------|
| 用户删除（默认） | `status=deleted`（进入回收站），**不**立刻 hard |
| 回收站列表 | Settings「回收站」：`status=deleted`，按 `updated_at` |
| 恢复 | `status=active`；若 hybrid 开则触发 re-embed |
| 彻底删除 | hard delete + 删 embedding 行 |
| 自动清空 | `trashRetentionDays`（默认 30）后 hard；挂 decay/startup job |
| 会话 derived 勾选 | **仍 hard**（隐私优先，不进回收站）—— 与「用户主动删条」区分 |
| 协议 | `memory:list { status: 'deleted' }`；`memory:restore { id }`；`memory:emptyTrash` |

**不做：** 多版本 diff / 编辑历史时间线。

**验收：** 删→回收站→恢复→列表可见；30 天 job 单测；derived hard 仍直删。

---

### Wave C — P2 Hybrid（sqlite-vec）

**依赖：** B1 配置类型与 UI 已合入。

#### C1. 依赖与存储

| 项 | 锁定 |
|----|------|
| 包 | sidecar 引入 **sqlite-vec**（或官方 node 绑定路径，以实现 plan 为准） |
| DB | **`~/.hip/db/hip.db` 同库** load extension / virtual table |
| Probe | `tryEnableSqliteVec(db)`；失败 → `memoriesVecEnabled=false`，hybrid 强制关 |
| Schema v18+ | `memory_embeddings(memory_id TEXT PK REFERENCES…, dim INT, model_id TEXT, embedding BLOB/vec, updated_at)` — 具体 DDL 按 sqlite-vec API 写 plan |

#### C2. Embed 管线

| 触发 | 行为 |
|------|------|
| upsert（user/tool/import/consolidate）且 embedding 已配 | 异步 embed |
| 恢复自回收站 | re-embed |
| 设置「重建索引」 | 全量/增量 reindex |
| embeddingModel 变更 | 全部 stale + 提示重建 |

客户端：`MemoryEmbeddingClient.embed(texts[]): number[][]`，mock 可注入。

#### C3. 检索融合

```text
score = α·norm(fts) + β·cosine + γ·confidence + δ·recency + ε·pin
默认 α=0.35 β=0.40 γ=0.15 δ=0.05 ε=0.05
```

- 无 vec / 无 embedding 配置 / hybrid 关 → β=0，= V1 FTS  
- 可选 rerank：top-20 → top-8  

`formatPrefetch` / `searchInScopes` 走 hybrid 入口。

#### C4. 产品开关

- `hybridSearchEnabled` 默认 **false**  
- 开启：校验 embeddingModel + vec probe  
- 索引状态：总数 / 已嵌入 / 失败 / 上次 reindex  

#### C5. 测试与打包

- mock embed 固定向量 → 排序断言  
- FTS 回归  
- `yarn tauri build` / sidecar 加载 extension 冒烟（plan 写清 CI 矩阵：至少 dev macOS arm64）  

**验收：** 同义查询 mock 下可命中；关 hybrid = V1；无 sqlite-vec 时不崩溃。

---

### Wave D — 不在本迭代（备忘）

- Skill 候选草稿  
- Project remount  
- 评测集 / critic 模型  

---

## 7. PR 切片（本迭代 A+B+C）

| 顺序 | PR 标题 | Wave | 依赖 |
|------|---------|------|------|
| 1 | `test(memory): V1 integration matrix` | A1 | 无 |
| 2 | `feat(memory): settings pin/edit + list filters` | A2 | 无 |
| 3 | `feat(settings): role models (extract/embed/rerank)` | B1–B2 | 无 |
| 4 | `feat(memory): trash restore + retention job` | B6 | 2 建议先 |
| 5 | `feat(memory): extract cost gates + citation allowedIds` | B3–B5 | 3 可并行 |
| 6 | `feat(memory): sqlite-vec + embedding pipeline` | C1–C2 | 3 |
| 7 | `feat(memory): hybrid search + optional rerank` | C3–C5 | 6 |
| 8 | `test(memory): hybrid + trash + integration polish` | A/B/C | 1,4,7 |

**合并纪律：** PR1 不过不宣称 hardening 完成；PR6/7 不过不默认打开 hybrid。

---

## 8. 成功指标

| 指标 | 定义 |
|------|------|
| Derived-delete | 集成测 A1.3 永久绿 |
| 回收站 | 删→恢复路径测绿；retention hard 测绿 |
| Extract 成本 | 日调用 ≤ maxExtractsPerDay |
| Hybrid | mock 语义 top-5 优于或不少于纯 FTS fixture |
| 降级 | 无 vec / 无 embed 时零崩溃且 FTS 可用 |
| 回归 | A1.* + V1 memory 单测持续绿 |

---

## 9. Risks

| 风险 | 缓解 |
|------|------|
| sqlite-vec 打包进 Tauri sidecar | 早期 spike PR6；probe；文档平台支持表 |
| Embedding 出站隐私 | hybrid 默认关；文案；可关 |
| extractModel 迁移 | string \| MemoryModelRef 双读 |
| 范围 A+B+C 偏大 | PR 闸门；可先合 A+B 再合 C，但迭代目标含 C |
| 回收站 vs 隐私 hard-delete | **会话衍生勾选 = hard**；仅手动删条进 trash |

---

## 10. Key Decisions（锁定）

| # | 决策 | 理由 |
|---|------|------|
| NK1 | **本迭代 = A+B+C** | 用户要求一次做到 hybrid |
| NK2 | 角色模型配置 **先于** hybrid 运行时 | 避免空壳 |
| NK3 | Embedding = **OpenAI-compatible 主流 API** + 一键建议 | 与业界一致、实现快 |
| NK4 | **sqlite-vec 进 sidecar / hip.db** | 用户接受 native；运维简单 |
| NK5 | Hybrid 默认关，可 FTS 降级 | 本地优先、可回滚 |
| NK6 | **回收站进 P1**；会话衍生删除仍 hard | 可恢复 vs 隐私 |
| NK7 | Rerank 可选 | 主流可后续增强 |
| NK8 | Wave D 不做 | 控制范围 |

---

## 11. Open Questions

**无阻塞项。** 实现 plan 阶段可再细化：

- sqlite-vec 具体 npm/包名与 load 方式（以 spike 结果写入 plan）  
- rerank API 形状（若 provider 不统一，V1 可仅支持一种 OpenAI-compatible 或延迟到有需求再接）

---

## 12. References

- V1 设计：`2026-07-11-cross-session-memory-system-design.md`  
- V1 计划：`../plans/2026-07-11-cross-session-memory-system.md`  
- 实现：`packages/sidecar/src/memory/**`  

---

*End of next-phase spec (rev 2 — decisions locked).*
