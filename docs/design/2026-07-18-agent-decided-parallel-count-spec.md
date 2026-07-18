# Spec: 智能体决定并行 Worktree 数量（Agent-decided N）

| Field | Value |
|-------|-------|
| **Title** | Parallel Studio：并行路数由智能体决定（非用户每次选 N） |
| **Date** | 2026-07-18 |
| **Status** | **Ready for implement** — 本文含 Spec + 实施 Plan |
| **Audience** | 产品 / 前端 / sidecar / 测试 |
| **对照** | `orca`（按需 worktree）、`oh-my-openagent` / `kimi-code`（编排者定并行度）、hip `parallel_worktrees` HITL |
| **前置** | [Chat/Code 丝滑](./2026-07-18-chat-code-smoothness-spec.md) P5 H1；`ParallelRunButton` 已去掉 `window.prompt` |
| **相关代码** | `src/lib/parallelFanout.ts`、`src/store/parallelStore.ts`、`ParallelRunButton.tsx`、`sessionService.startParallelRun`、`packages/sidecar/.../parallel-worktree.ts` |

---

## §1 问题

### 1.1 现状

| 路径 | 行为 | 问题 |
|------|------|------|
| **Composer 分支按钮**（host fan-out） | 硬编码 `count: 2` | 用户无法表达「单路 isolation / 三路对比」；与任务无关 |
| **Agent 工具 `parallel_worktrees`** | `suggested_count` + HITL 选 2/3/4 | 更合理，但与 host 按钮语义分裂 |
| **`clampParallelCount`** | clamp 到 **[2, 4]** | 禁止 N=1（单隔离树在 Orca 式工作流中合法） |

### 1.2 目标语义（产品决策）

**数量由智能体（或无 LLM 时的本地启发式）决定，用户只提供目标 goal。**

- 用户 **不** 每次手选 N（可后续加高级覆盖，本阶段不做）。
- 系统 **必须** 硬夹紧 N，并展示「建议 N + 一句话理由」。
- **不** 默认 auto 开多路 LLM（保持 `autoSend: false` 产品默认，避免卡死/烧额度）。

### 1.3 非目标（本阶段不做）

- 付费 LLM 在线「再想一次 N」（无 key 时必须可用）。
- 用户 UI 滑杆选 1–4（高级设置可后补）。
- 改 Orca 级「只建树不开 session」的完整 Worktree Studio 壳。
- 修改 sidecar HITL 选项文案大改（可对齐 clamp 边界，逻辑已够用）。

---

## §2 最佳实践摘要（对照本地树）

| 来源 | 可吸收语义 |
|------|------------|
| **Orca** | 多 worktree 按需；主树干净；不是「永远 N=2」 |
| **oh-my / Kimi** | 编排者决定并行度；有 `max_parallel_*` 上限 |
| **hip `parallel_worktrees`** | agent `suggested_count` + 用户确认；clamp 2–4 |

**结论**：N 由编排策略决定 + cap + 可解释，是合理默认；host 按钮应接入同一哲学，而不是写死 2。

---

## §3 需求

### 3.1 MUST

| ID | 要求 |
|----|------|
| **N1** | 存在纯函数 `suggestParallelCount(goal: string): { n: number; rationale: string }`（可单测、无网络、无 key） |
| **N2** | `n` 经统一 clamp：默认 **[1, 4]**（`MIN=1`, `MAX=4`）；非法输入回落合理默认（建议 2） |
| **N3** | Host `ParallelRunButton`：用户只提交 **goal** → 调用 suggest → `startParallelRun({ count: n, ... })` |
| **N4** | 对话框展示 **建议路数 + 简短理由**（创建前可见）；确认按钮文案反映动态 N（如「创建 3 路」） |
| **N5** | `planParallelFanout` 支持 `n=1`（单 slot 计划合法） |
| **N6** | 产品默认仍 **`autoSend: false`**（只建树+session，不自动 message:send） |
| **N7** | Unit 覆盖 suggest 规则与 clamp；e2e host 路径断言 **slot 数 = suggest 结果**（可用固定 goal 锁 N） |

### 3.2 SHOULD

| ID | 要求 |
|----|------|
| **S1** | 建议启发式与工具侧 `suggested_count` 语义接近（对比/多方案 → ≥2；简单单改 → 1） |
| **S2** | toast 成功文案含实际创建的 slot 数与 n 的 rationale 摘要（可选） |
| **S3** | `parallel_worktrees` 工具 clamp 与 host 共用同一 `MIN/MAX` 常量（避免 2–4 vs 1–4 分裂） |

### 3.3 启发式规则（N1 默认实现）

对 `goal` 做小写归一后：

| 条件（满足任一） | 建议 n | rationale 方向 |
|------------------|--------|----------------|
| 空 goal | 2 | 默认对比位 |
| 匹配 `对比\|compare\|vs\.?\|versus\|两种\|两条\|two approach\|alternative` | 2 | 双方案对比 |
| 匹配 `三种\|三条\|three \|3 (ways\|options\|approaches)` | 3 | 三路探索 |
| 匹配 `四种\|四条\|four \|4 (ways\|options)` 或 `全面\|exhaustive\|matrix` | 4 | 多路/穷举 |
| 匹配 `只\|仅\|single\|一个\|fix\|bug\|typo\|rename` 且无对比词 | 1 | 单路 isolation 足够 |
| 其他 | 2 | 保守默认可比 |

说明：这是 **无 LLM 的 agent 替身**，保证 unpaid / 离线可用。有 LLM 时未来可替换为模型输出 `n`，但必须仍走同一 clamp。

### 3.4 边界与安全

| 项 | 规则 |
|----|------|
| 主树 | slot 不得落在 primary cwd（既有 `assertPrimaryNotInSlotPaths`） |
| 非 git 目录 | create 失败 → toast，不卡死 |
| 费用 | 不 autoSend；N 上限 4 |
| Tauri | 禁止 `window.prompt` / `confirm` 阻塞 |

---

## §4 架构

```text
User goal (dialog)
    → suggestParallelCount(goal)     // pure, host & tests
    → clampParallelCount(n)          // shared MIN/MAX
    → planParallelFanout({ n, ... })
    → startParallelRun({ count: n, hostSessionId, autoSend: false })
    → git:worktree:create × n + slot sessions
    → toast + focus first slot
```

Agent 工具路径保持：

```text
LLM tool parallel_worktrees(goal, suggested_count, …)
    → clamp → HITL (n1? / n2 / n3 / n4 / reject)  // 本阶段：HITL 可增 n1 与 host 对齐
    → create + spawn workers
```

本阶段 **优先做 host 按钮 + 共享 pure 决策**；工具 HITL 增 n1 为 SHOULD。

---

## §5 实施 Plan（按序执行）

### PR / 步骤 1 — 共享决策与 clamp（无 UI）

**文件**

- `src/lib/parallelCount.ts`（新）：`PARALLEL_COUNT_MIN/MAX`、`clampParallelCount`、`suggestParallelCount`
- `src/lib/parallelCount.test.ts`（新）
- `src/store/parallelStore.ts`：re-export clamp 自新模块（或改为 import，避免双实现）
- `src/lib/parallelFanout.ts`：`n` 允许 1..MAX（与 clamp 一致）
- `src/lib/parallelFanout.test.ts`：补 n=1

**验收**

- vitest：suggest 规则表 + clamp 边界全绿

### PR / 步骤 2 — Host UI 使用 agent 建议 N

**文件**

- `src/components/chat/ParallelRunButton.tsx`
  - 打开/修改 goal 时 recompute `suggestion`
  - 展示 `n` + `rationale`
  - `startParallelRun({ count: suggestion.n, ... })`
  - 按钮/确认文案去「固定 2」
- i18n 可选 defaultValue 即可（本阶段可不扩 en/zh 大表）

**验收**

- 手动：对比类 goal → 2；fix 类 → 1；三种 → 3
- 无 window.prompt；创建中 UI 可关 busy 态

### PR / 步骤 3 — e2e + sidecar 对齐（轻）

**文件**

- `e2e/specs/smooth-p5.spec.ts`：固定 goal 文本断言 slotCount（例如含 `compare two` → ≥2；或断言 `slotSessionIds.length` 在 1..4 且等于 hooks 回传）
- `packages/sidecar/.../parallel-worktree.ts`：clamp 与 host 同 MIN/MAX（若导出共享困难，sidecar 复制常量注释 `// keep in sync with parallelCount.ts`，或从 protocol 抽常量——**优先最小改动：sidecar 放宽到 1–4 并在注释同步**）

**验收**

- `E2E_GREP=@smooth-p5` 绿
- 相关 unit 绿

### 顺序与风险

```text
1 pure suggest+clamp+fanout
    → 2 ParallelRunButton
        → 3 e2e + sidecar clamp note
```

**风险**

| 风险 | 缓解 |
|------|------|
| 启发式误判 N | 展示 rationale；上限 4；用户可取消对话框 |
| e2e 对 N 不稳定 | 用固定 goal 锁死期望 n |
| N=1 破坏「parallel」语义 | 文案用「隔离 worktree / slots」；n=1 仍合法 isolation |

---

## §6 成功标准

1. 用户 **不必** 选择 N；只填 goal 即可创建。  
2. 创建前可见 **智能体建议的 N + 理由**。  
3. `n ∈ [1,4]` 始终成立。  
4. 默认不自动开多路 LLM。  
5. Unit + smooth-p5 e2e 绿。  

---

## §7 后续（不在本 Plan）

- 付费模型输出 `n` 替换启发式（同一 clamp API）。  
- N≥3 可选二次确认 chip。  
- 用户设置 `maxParallelSlots`。  
- Host 与 agent 工具完全共用 protocol 常量包。
