# Hip Capability Matrix — Implementation Plan

| Field | Value |
|-------|-------|
| **Title** | Implement complex UI eval matrix (T1–T8 packs) |
| **Date** | 2026-07-16 |
| **Status** | Plan — implement **after** this plan is accepted |
| **Spec** | [`2026-07-16-hip-capability-matrix-spec.md`](./2026-07-16-hip-capability-matrix-spec.md) |
| **Foundation** | `e2e/eval/*` + `bytebase-pilot`（已合并） |
| **Reading guide** | **渐进式披露**：§0 路线图 → §1 阶段 → §2 PR 图 → §3 文件清单 → §4 验收 → §5 运行手册 |

---

## §0 路线图一页纸（1 分钟）

```text
P0  文档/类型/ soft 扩展          无 live LLM
P1  bytebase-hard (T1–T3)        live 可选
P2  runner: plan + interrupt     无/有 LLM
P3  bytebase-orch (T4–T6)        live
P4  bytebase-adv (T7–T8) + 画像  live / 周报
```

**总原则：** 规格已全量定义 T1–T8；**实现按阶段合并**，每阶段可独立 review、独立跑通，不阻塞已有 pilot 绿。

**默认决议（来自 Spec §7）：** 委派不 hard；Plan 先 spike；T3 名 `HasAnySuffix`；无应用内 Eval UI。

**未实现前禁止：** 直接改 live 门禁、把复杂题塞进 `test:e2e:gate`。

---

## §1 阶段说明（L1 披露）

### P0 — 基础设施扩展（0.5–1d）

| 交付 | 说明 |
|------|------|
| types / soft | `min_paths`、`plan_mode`、`auto_resume_interrupt`、`rubric`、`level` |
| taxonomy | `plan_skipped`（可选）；`agentTouched` 路径保持 |
| score | `require_plan_approved`；min_paths 检查 |
| unit tests | soft + score 离线 fixture |
| docs 交叉链接 | eval-loop ↔ matrix spec/plan |

**验收：** `yarn vitest run e2e/eval` 全绿；pilot smoke 不回退。

### P1 — L2 hard pack（1–2d + live 时间）

| 交付 | 说明 |
|------|------|
| pack `bytebase-hard` | T1, T2, T3 JSON + fixtures + README |
| specs | `eval-hard-*.spec.ts` `@live @eval @hard` |
| script | `scripts/hip-eval-ui-hard.sh` |
| fixture 工装 | apply --check 文档化 |

**验收：** 无 key 时 skip；有 key 时至少 T2 或 T3 有一条可 pass 路径；T1 fixture 应用后必红、最小修复后必绿（脚本或 CI 注释级检查）。

### P2 — Orchestration runner 能力（1–2d）

| 交付 | 说明 |
|------|------|
| Plan 审批点击 | PlanApprovalCard approve/reject |
| plan_mode 接线 | require/prefer 时的 UI 进入方式（spike 结论写入 README） |
| interrupt resume | 配置化 multi_turn / auto_resume（已有雏形则硬化） |
| report 字段 | planApproved, interruptResumes, axes |

**验收：** 无 LLM harness 级：可 inject plan 卡并点击（若已有 seed）；或最小 e2e 仅测点击 helper。

### P3 — L3 orch pack（1–2d + live）

| 交付 | T4 plan / T5 delegate / T6 hitl |
|------|--------------------------------|
| specs | `@live @eval @orch` |
| script | `hip-eval-ui-orch.sh` |

**验收：** T6 在 interrupt 场景下 resume 后有机会绿；T4 若 product 无法进 plan → 标记 defer + issue，不阻塞 P4。

### P4 — L4 adv + 画像（1d + live）

| 交付 | T7 noisy / T8 safety + byAxis cluster |
|------|----------------------------------------|
| script | `hip-eval-ui-all-matrix.sh`（分 pack 调用） |
| 报告 | `cluster.json` 增加 `byAxis` |

**验收：** T8 hard = 主仓不 mutate；画像 JSON schema 稳定。

---

## §2 PR 计划（L2 披露 — 可直接开 PR）

依赖图：

```text
PR-M0 (types/score)
   ├── PR-M1 (hard pack T1–T3)
   ├── PR-M2 (plan + interrupt runner) 
   │      └── PR-M3 (orch pack T4–T6)
   └── PR-M4 (adv pack T7–T8 + byAxis)
```

### PR-M0 — Schema & scorer extensions

- **Title:** `feat(e2e/eval): extend task schema for capability matrix (min_paths, plan, rubric)`
- **Files:**  
  - `e2e/eval/types.ts`  
  - `e2e/eval/taxonomy.ts`  
  - `e2e/eval/taxonomy.test.ts`  
  - `e2e/helpers/eval-run.ts`（读新字段默认值）  
  - `docs/design/2026-07-16-hip-capability-matrix-spec.md`（已有则仅交叉链接）  
  - `docs/design/2026-07-16-hip-capability-eval-loop.md`（Related 链到 matrix）
- **Deps:** none  
- **Accept:** unit 绿；`eval-ui-smoke` 绿；旧 pilot JSON 无需改即可 load  

### PR-M1 — bytebase-hard pack + live specs

- **Title:** `feat(e2e/eval): bytebase-hard pack (multi-file, TDD, add-feature)`
- **Files:**  
  - `e2e/eval/tasks/bytebase-hard/**`  
  - `e2e/specs/eval-hard-*.spec.ts`  
  - `scripts/hip-eval-ui-hard.sh`  
  - `package.json` scripts: `test:e2e:eval-hard`  
  - `e2e/README.md`
- **Deps:** PR-M0  
- **Accept:**  
  - fixtures `git apply --check` on pin  
  - apply 后 `go test ./backend/common/` 红（在脚本 doctor 或 README 手动步骤）  
  - live skip without `E2E_LIVE_LLM` + `HIP_EVAL_BYTEBASE_PATH`  

### PR-M2 — Plan approval + interrupt multi-turn hardening

- **Title:** `feat(e2e/eval): plan approval helper and configurable interrupt resume`
- **Files:**  
  - `e2e/helpers/eval-permissions.ts` 或 `eval-plan.ts`  
  - `e2e/helpers/eval-run.ts`  
  - `e2e/helpers/eval-composer.ts`（如需）  
  - 可选：`src/**` 仅当缺 testid（最小补 `plan-approval-*` 等）  
  - spike 笔记：`e2e/eval/tasks/bytebase-orch/SPIKE-plan-entry.md`
- **Deps:** PR-M0  
- **Accept:** helper 单测或 unpaid e2e：seed plan → click approve；interrupt resume 计数进 report  

### PR-M3 — bytebase-orch pack

- **Title:** `feat(e2e/eval): bytebase-orch pack (plan, delegate, hitl)`
- **Files:** pack JSON/fixtures + specs + `hip-eval-ui-orch.sh`  
- **Deps:** PR-M2（T4 强依赖；T5/T6 可部分并行但合并顺序在 M2 后）  
- **Accept:** tags 可区分 plan_skipped / awaiting_user；T5 不 hard-fail 未委派  

### PR-M4 — bytebase-adv + axis clustering

- **Title:** `feat(e2e/eval): adversarial pack and by-axis cluster report`
- **Files:**  
  - `e2e/eval/tasks/bytebase-adv/**`  
  - specs + script  
  - `e2e/eval/report.ts` / cluster writer  
  - `scripts/hip-eval-ui-matrix.sh`
- **Deps:** PR-M1（画像可先 hard）；orch 可选纳入 matrix 脚本  
- **Accept:** T8 主仓 porcelain 不变；`cluster.json` 含 `byAxis`  

---

## §3 文件与模块清单（L3 披露）

### 3.1 新增目录目标态

```text
e2e/eval/
  tasks/
    bytebase-pilot/          # 已有
    bytebase-hard/           # P1
      pack.json
      README.md
      fixtures/
      tasks/
    bytebase-orch/           # P3
    bytebase-adv/            # P4
  types.ts                   # 扩展
  taxonomy.ts                # 扩展
  ...
e2e/helpers/
  eval-run.ts                # plan/multi-turn
  eval-plan.ts               # NEW optional
e2e/specs/
  eval-hard-*.spec.ts
  eval-orch-*.spec.ts
  eval-adv-*.spec.ts
scripts/
  hip-eval-ui-hard.sh
  hip-eval-ui-orch.sh
  hip-eval-ui-matrix.sh
docs/design/
  2026-07-16-hip-capability-matrix-spec.md
  2026-07-16-hip-capability-matrix-plan.md   # 本文
```

### 3.2 关键代码路径（实现时必读）

| 路径 | 用途 |
|------|------|
| `e2e/helpers/eval-run.ts` | 主编排 |
| `e2e/helpers/eval-composer.ts` | settle / send |
| `e2e/eval/workspace.ts` | worktree |
| `e2e/eval/inventory.ts` | baseline delta / restore-to-clean |
| `src/components/chat/PlanApprovalCard.tsx` | plan UI |
| `src/components/chat/ChatPane.tsx` | chat-interrupt |
| `src/components/chat/PermissionModePicker.tsx` | permission testids |

### 3.3 Fixture 制作 SOP（T1 等）

1. `git worktree add --detach /tmp/bb-pin <base_sha>`  
2. 手工改到「必红」  
3. `git diff > fixtures/xxx.patch`  
4. `git apply --check`  
5. 在另一 clean worktree 验证「最小修复后必绿」  
6. 记录于 pack README  

---

## §4 验收矩阵（L4 披露）

### 4.1 自动化（每次 PR）

| 检查 | 命令 |
|------|------|
| unit | `yarn vitest run e2e/eval` |
| smoke | `yarn test:e2e --spec e2e/specs/eval-ui-smoke.spec.ts` |
| pilot（可选） | `E2E_LIVE_LLM=1 … eval-bytebase-fix-has-prefixes` |

### 4.2 分 pack live

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase-3.16.1

# L2
scripts/hip-eval-ui-hard.sh

# L3
scripts/hip-eval-ui-orch.sh

# 全矩阵（长）
scripts/hip-eval-ui-matrix.sh
```

### 4.3 完成定义（整个矩阵项目）

| # | 标准 |
|---|------|
| D1 | Spec 中 T1–T8 均有 task 文件 **或** 显式 `DEFERRED.md` 理由 |
| D2 | hard pack 至少 2/3 题在 k=1 live 上跑通编排（pass 与否可记 report） |
| D3 | orch：interrupt resume 可配置；plan 有 helper 或 defer 文档 |
| D4 | adv：T8 验证 primary guard |
| D5 | `cluster`/`byAxis` 可从一批 run-report 生成 |
| D6 | e2e README 写清 tags：`@hard` `@orch` `@adv` |

---

## §5 运行手册（L5 披露 — 给执行者）

### 5.1 环境

```bash
yarn tauri build --debug   # 若 binary 过期
export HIP_EVAL_BYTEBASE_PATH=...
export HIP_EVAL_ROOT=$HOME/.hip/eval-runs
# auth: ~/.hip/config/auth.json
cd "$HIP_EVAL_BYTEBASE_PATH" && go mod download
```

### 5.2 推荐执行顺序（「全部都做」时）

1. 合 PR-M0 → unit + smoke  
2. 合 PR-M1 → doctor fixtures → live T2 → T3 → T1  
3. Spike plan 入口 → 合 PR-M2  
4. 合 PR-M3 → live T6 → T4 → T5  
5. 合 PR-M4 → live T8 → T7 → matrix 脚本  
6. 汇总 `~/.hip/eval-runs/**/run-report.json` → 轴画像笔记  

### 5.3 失败分类（执行时）

| 现象 | 处理 |
|------|------|
| infra_prepare | fixture/pin/go |
| never_saw_running / 假 settle | 回归 composer busy 检测 |
| awaiting_user | 加 resume 文案或产品 interrupt UX |
| verify 红但 agent 声称修了 | 查 worktree / 权限 edit jail |
| primary_tree_mutated | 安全事故，停跑查权限 |

---

## §6 风险与缓解

| 风险 | 级别 | 缓解 |
|------|------|------|
| Plan 入口不清晰 | 高 | P2 spike；T4 可 defer |
| Live 费用/时间 | 高 | 分 pack 脚本；默认不进 gate |
| Fixture 漂移 | 中 | pin SHA + apply --check |
| 委派不可观测 | 中 | 仅 soft；不强 fail |
| 复杂题 flaky | 高 | k=3；timeout 与 pass 分列报告 |

---

## §7 明确不在本 Plan 的工作

- 应用内 Eval Studio  
- Docker SWE-bench 主路径  
- 修改 Harness ABI schemaVersion  
- 把 `@live @hard` 塞进 `test:e2e:gate`  

---

## §8 渐进式披露索引

| 层级 | 内容 | 读者 |
|------|------|------|
| L0 §0 | 五阶段路线图 | 所有人 |
| L1 §1 | 阶段交付与验收 | 执行者 |
| L2 §2 | PR 标题/依赖/文件 | Reviewer |
| L3 §3 | 目录与 SOP | Implementer |
| L4 §4 | 验收命令 | CI/执行者 |
| L5 §5–6 | 手册与风险 | 值班跑题 |

**Spec 对应关系：**

| Spec | Plan |
|------|------|
| §2 轴/层级 | §1 阶段覆盖 |
| §3 T1–T8 | §2 PR-M1/M3/M4 |
| §4 schema | §2 PR-M0 |
| §5 评分 | §2 PR-M0 + PR-M4 byAxis |
| §6 安全成本 | §5–6 |

---

## §9 下一步（等待确认后执行）

实现启动顺序固定为：

1. **PR-M0**  
2. **PR-M1**  
3. **PR-M2**（可与 M1 尾部重叠开发，合并 M1 后）  
4. **PR-M3**  
5. **PR-M4**  

每 PR 提交前：unit + 相关 smoke；live 在 PR 描述中贴 report 路径（可选）。

---

## §10 修订历史

| Rev | Date | Notes |
|-----|------|-------|
| 1 | 2026-07-16 | 初版：P0–P4 + PR-M0–M4 + 全矩阵落地顺序 |
