# Design Spec: Composer 执行模式（Interactive / Plan / Autopilot）

| Field | Value |
|-------|--------|
| **Title** | Composer Execution Mode |
| **Date** | 2026-07-25 |
| **Status** | Implemented (2026-07-25) — product rules locked |
| **Audience** | hip core (React UI / protocol / sidecar) |
| **Reference UI** | Mode 下拉：Interactive · Plan · Autopilot（见产品截图） |

---

## 1. Overview

将 Code 对话框里的二值 **`规划` chip**（`forcePlan` on/off）升级为与参考图一致的 **三档执行模式（Execution Mode）** 选择器：

| Mode | 英文标签 | 副标题（参考图） | 产品语义 |
|------|----------|------------------|----------|
| **Interactive** | Interactive | Step-by-step collaboration | 默认协作：逐步推进，工具权限按现有 PermissionMode HITL |
| **Plan** | Plan | Plan first, execute when ready | 现有强制规划：先调研/出计划，用户批准后再改代码 |
| **Autopilot** | Autopilot | End-to-end execution without interruption | **所有审批默认批准，不再弹确认**（见 §4.0）；**仅 `permissionMode === 'full'` 可选**（见 §4.0b） |

**与 PermissionMode 的关系（已修正）：**

- **Interactive / Plan**：与 PermissionMode **正交**（chat / edit / full 均可）。
- **Autopilot**：**耦合门禁** —— 仅当权限为 **完全访问（`full`）** 时可选；`仅对话` / `编辑文件` **不能开启** Autopilot。

PermissionMode 仍回答「能做什么」；Execution Mode 回答「怎么协作」。Autopilot 额外要求用户先显式选择最大权限，再开启零确认，避免「半权限 + 全自动」的危险组合。

---

## 2. Background & Motivation

### 2.1 现状

| 控件 | 状态模型 | 行为 |
|------|----------|------|
| `PlanModeChip`（`规划`） | `SessionConfig.forcePlan: boolean` | 开 → 回合开始自动 `planMode.enter()` + 系统 nudge；批准/拒绝后 one-shot 清掉 |
| `PermissionModePicker` | `permissionMode: chat \| edit \| full` | 路径 jail + 写权限 + `run_script` 是否 HITL |
| Slash | `/plan` [task…]、`/plan-off` | 与 chip 共用 `runPlanOn` / `runPlanOff` |
| Protocol | `session:setForcePlan` ↔ `session:forcePlan` | 草稿 `draftStore.forcePlan` → `configFromDraft` |

相关路径：

- UI：`src/components/chat/PlanModeChip.tsx`、`ComposerLeftSlot.tsx`、`composerControlMatrix.ts`
- Domain：`src/domain/commands/planActions.ts`、`sessionService.setForcePlan`
- Protocol：`packages/protocol/src/session-config.ts`、`messages.ts`
- Sidecar：`force-plan.ts`、`plan.ts`、`plan-mode.ts`、`session-turn-ops.ts`

### 2.2 痛点

1. **二值开关语义弱**：关 =「不强制规划」，但用户心智里没有「协作模式」这个产品概念；与参考图的 Mode 三档不一致。
2. **缺「少打断」档**：`permissionMode: full` 只放宽能力并 auto-approve `run_script`，**不能**表达「尽量不弹权限/计划卡、端到端跑完」；用户会误把 Full access 当成 Autopilot。
3. **发现性**：`规划` 在 overflow/pinned 里是独立开关，不像 Mode 下拉那样一眼能看到全部协作策略。

### 2.3 参考交互（锁定视觉）

参考图结构（Mode 菜单）：

```
Mode
✓ Interactive
  Step-by-step collaboration

  Plan
  Plan first, execute when ready

  Autopilot
  End-to-end execution without interruption
```

实现上对齐现有 `PermissionModePicker`：`ComposerChip` 触发 + `DropdownMenu`，每项 **标题行 + 副标题**，当前项左侧 **Check**。

---

## 3. Goals & Non-Goals

### Goals（v1）

1. Code surface（非 ACP primary）用 **三档 Mode 下拉** 替换 `PlanModeChip` 二值开关。
2. **Plan** 行为与今日 `forcePlan=true` **等价**（含 slash、one-shot clear、PlanApprovalCard、eval harness）。
3. **Interactive** = 今日 `forcePlan=false` 默认路径。
4. **Autopilot** 新增（**产品已锁定**）：不强制规划；会话内 **一切会阻塞回合、需要用户点确认的审批一律默认批准**，UI **不再**要求用户点击（见 §4.0）。
5. **Autopilot 门禁（产品已锁定）**：仅 `permissionMode === 'full'`（完全访问）可选；`chat` / `edit` 下 **禁止** 开启 Autopilot（见 §4.0b）。**不会**在选 Autopilot 时静默把权限改成 `full`——用户须先（或同时明确）选择完全访问。
6. 保持 PermissionMode 独立控件；Interactive / Plan 不改权限语义。
7. 草稿 / 已提交会话均可切换；**回合 running 时禁止切换** Execution Mode 与 PermissionMode 中会影响 Autopilot 合法性的操作策略见 §4.0b（沿用 KD-12：running 时 toast）。
8. i18n（en / zh-CN / zh-TW / ja / ko）+ 单测 + 更新 plan e2e helpers。
9. 协议向后兼容：旧会话只有 `forcePlan` 仍可读。

### Non-Goals（v1）

- 合并或删除 PermissionMode（chat/edit/full）。
- 选 Autopilot 时 **静默** 提权到 `full`（必须用户可见地处于/切到完全访问）。
- Autopilot 忽略 Stop / 用户主动 abort / 关闭窗口。
- Autopilot 自动确认 **非 agent 回合** 的破坏性 UI（删 worktree、清空回收站等）——那些不是 agent 审批。
- 全局默认 Mode 写进 `hip.toml`（可后续）。
- Chat surface / ACP primary 显示 Mode 控件。
- 子 agent 独立 Mode（继承主会话策略即可）。
- 重做 plan 状态机、PlanApprovalCard 视觉、Todos 栏。

---

## 4. Product semantics

### 4.0 Autopilot 铁律（已锁定）

> **开启 Autopilot 后：所有 agent 回合内的审批默认批准，不再让用户点击确认。**

这是 Execution Mode 的核心差异点，实现与文案都必须对齐「零确认点击」，而不是「少打断一点」。

#### 必须自动批准（v1 清单）

| 审批面 | 协议 / 入口 | Autopilot 行为 |
|--------|-------------|----------------|
| 工具权限 HITL（内置 `run_script` 等） | `PermissionManager.buildHitlApproval` → FE 权限卡 | **不弹卡**；直接 `allow`（实现用 `allow_once` 或等价立即放行，见 §5.3） |
| ACP / 外部 agent 权限 | `permission:request` → `permission:respond` | **自动 respond 允许**；多客户端时与现网「先到先得」一致，由 sidecar 直接结案 |
| 计划批准 | `plan:published` / `agent:interrupt`（plan review）→ `plan:respond` | **自动 `approve`**；不进入「等用户点批准」的阻塞态 |
| 其它未来「暂停回合等人点允许/拒绝」的 HITL | 凡 `awaiting user approval` 类 | **默认 allow/approve**；新增审批面必须登记到本表 |

原则：**凡是「不点就跑不下去」的 agent 审批，Autopilot 下都由系统代点「允许/批准」。**

#### 明确不在「审批」范围内（仍要人）

| 交互 | 为何不算审批 | Autopilot 下 |
|------|--------------|--------------|
| **Stop / 中止回合** | 用户主动刹车，不是 agent 在要权限 | **始终可用** |
| 用户正常发消息、改 Mode、改 PermissionMode | 用户主动操作 | 照常 |
| 删 worktree / 回收站清空 / 设置页危险操作 | 产品 UI 破坏性确认，不是 turn HITL | **仍弹确认**（v1） |
| PermissionMode 门禁（Autopilot 仅 full） | Autopilot 已要求完全访问 | 在合法 Autopilot 下能力已是 full；降级权限会先退出 Autopilot（§4.0b） |

#### 与 PermissionMode 的一句话关系

```
PermissionMode     →  能不能做（门禁）
Interactive / Plan →  与门禁正交的协作方式
Autopilot          →  零确认执行，且 **仅 full 可开**（能力已最大 + 不再按门铃）
```

### 4.0b Autopilot × PermissionMode 门禁（已锁定）

> **仅「完全访问」可开启 Autopilot；「仅对话」「编辑文件」不可选 / 不可保持 Autopilot。**

| `permissionMode` | Interactive | Plan | Autopilot |
|------------------|-------------|------|-----------|
| `chat` 仅对话 | ✅ | ✅ | ❌ |
| `edit` 编辑文件 | ✅ | ✅ | ❌ |
| `full` 完全访问 | ✅ | ✅ | ✅ |

#### 合法状态不变量

```ts
// 会话 / 草稿任何时刻必须满足：
executionMode !== 'autopilot' || permissionMode === 'full'
```

Sidecar 与 FE **两侧**强制；非法组合不得进入运行态。

#### 用户操作矩阵

| 用户操作 | 行为 |
|----------|------|
| 权限为 `chat`/`edit`，菜单点 Autopilot | **拒绝**：项 **disabled** + 副文案说明；若仍触发（slash）→ toast，**不改** mode |
| 权限为 `full`，点 Autopilot | 允许 → `executionMode=autopilot`，零确认生效 |
| 当前 Autopilot，把权限改为 `chat`/`edit` | **允许改权限**；同时 **强制回落** `executionMode → interactive`，toast 说明「已离开完全访问，自动模式已关闭」 |
| 当前 Autopilot，权限保持 `full` | 不变 |
| 当前 Interactive/Plan，权限在 chat/edit/full 间切换 | 不改 executionMode（与今日一致） |
| 回合 `running` 时改权限导致必须回落 Autopilot | 与 KD-12 一致：**busy 则禁止改**（权限与执行模式均 toast busy）；idle 后再改 |

**不采用**：点 Autopilot 时静默 `setPermissionMode('full')`（用户可能没意识到已提权）。  
**可选 v1.1**：点 Autopilot 时弹出确认「将切换到完全访问并开启自动？」——v1 不做，靠 disabled + 文案引导用户先改权限 chip。

#### UI

- Execution Mode 菜单里 Autopilot 行：
  - `permissionMode === 'full'` → 可点
  - 否则 → `disabled`，副标题或第三行：`需要「完全访问」权限` / `Requires Full access`
- Permission Mode 菜单：无需禁用 full；从 full 降级时由 store/service **原子**写入 `{ permissionMode, executionMode: 'interactive' }`（若原为 autopilot）

#### Slash

| 命令 | 权限不足时 |
|------|------------|
| `/autopilot` | toast 拒绝，保持原 executionMode |
| `/plan` 等 | 不受影响 |

### 4.1 三档对照

| | Interactive | Plan | Autopilot |
|--|-------------|------|-----------|
| 强制先规划 | 否 | **是**（= 现 forcePlan） | 否 |
| Agent 可自愿 EnterPlanMode | 是 | 是（已在 plan） | 是；计划审批 **自动 approve** |
| 工具 / ACP 权限 HITL | 按 PermissionMode + sticky | 同左 | **全部默认批准，零点击**（§4.0） |
| 计划批准卡 | 正常展示并阻塞 | 正常展示并阻塞 | **不阻塞、不要求点击**（可无卡或一闪即清） |
| 用户 Stop | 有效 | 有效 | 有效 |
| 与 PermissionMode | 正交 | 正交 | **仅 `full` 可开**（§4.0b）；零确认且能力最大 |

### 4.2 Chip 展示

| 状态 | Chip 文案 | `active` 高亮 |
|------|-----------|---------------|
| Interactive | `交互` / `Interactive` | **false**（默认档不高亮，对齐 permission 的 edit） |
| Plan | `规划` / `Plan` | true |
| Autopilot | `自动` / `Autopilot` | true |

- `title` / aria：`chat.executionMode.label`（如「本对话的执行模式」）。
- 菜单 section 标题：`chat.executionMode.menuTitle`（`Mode` / `模式`）。
- 图标：建议 `ListTree`（Plan 档历史图标）或 `Waypoints`/`Sparkles`；**三档共用一个图标**，不因档位换图标（降低跳动）。推荐继续 `ListTree` 以减少 diff，或改用更中性的 `Layers`。

### 4.3 中文文案（建议）

| Key | zh-CN |
|-----|--------|
| menuTitle | 模式 |
| modes.interactive | 交互 |
| desc.interactive | 逐步协作，需要时再确认 |
| modes.plan | 规划 |
| desc.plan | 先规划，就绪后再执行 |
| modes.autopilot | 自动 |
| desc.autopilot | 端到端执行，所有审批默认通过（需完全访问） |
| desc.autopilotLocked | 需要先将权限设为「完全访问」 |
| busyTitle | 回合进行中，暂不能切换执行模式 |
| setInteractiveTitle / Body | 已切换为交互模式 / 回合不再强制先规划，权限仍按当前权限模式询问。 |
| setPlanTitle / Body | 已切换为规划模式 / （沿用现 forceOnBody） |
| setAutopilotTitle / Body | 已切换为自动模式 / **所有审批将默认批准，不再弹出确认**；当前为完全访问。Stop 仍可用。 |
| autopilotRequiresFullTitle / Body | 无法开启自动模式 / 请先将权限切换为「完全访问」。 |
| autopilotClearedTitle / Body | 已关闭自动模式 / 权限不再是完全访问，已回到交互模式。 |

英文与参考图对齐：

- Interactive — Step-by-step collaboration  
- Plan — Plan first, execute when ready  
- Autopilot — End-to-end execution without interruption  

---

## 5. Data model & protocol

### 5.1 推荐模型：显式 `executionMode` + 派生兼容

```ts
/**
 * Collaboration / interruption policy for a code turn.
 * Autopilot is only valid when permissionMode === 'full' (see assertExecutionModeAllowed).
 */
export type ExecutionMode = 'interactive' | 'plan' | 'autopilot'
```

`SessionConfig` / draft 增加：

```ts
executionMode?: ExecutionMode  // undefined ⇒ 由 forcePlan 派生（见下）
```

**派生与门禁（单一真相，读写两侧共用 pure helper）**：

```ts
export function resolveExecutionMode(cfg: {
  executionMode?: ExecutionMode
  forcePlan?: boolean
  permissionMode?: PermissionMode
}): ExecutionMode {
  let mode: ExecutionMode
  if (cfg.executionMode === 'interactive' || cfg.executionMode === 'plan' || cfg.executionMode === 'autopilot') {
    mode = cfg.executionMode
  } else {
    mode = cfg.forcePlan ? 'plan' : 'interactive'
  }
  // Invariant: autopilot requires full
  if (mode === 'autopilot' && (cfg.permissionMode ?? 'edit') !== 'full') {
    return 'interactive'
  }
  return mode
}

export function canSelectAutopilot(permissionMode: PermissionMode | undefined): boolean {
  return (permissionMode ?? 'edit') === 'full'
}

export function forcePlanFromExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'plan'
}

export function isAutopilot(mode: ExecutionMode): boolean {
  return mode === 'autopilot'
}
```

写入时 **同时维护** `executionMode` 与 `forcePlan`，避免旧 sidecar / 旧 FE 半升级：

| 用户选择 | 前置条件 | `executionMode` | `forcePlan` |
|----------|----------|-----------------|-------------|
| Interactive | — | `'interactive'` | `false` / omit |
| Plan | — | `'plan'` | `true` |
| Autopilot | **`permissionMode === 'full'`** | `'autopilot'` | `false` / omit |

`setPermissionMode` 路径：若新 mode ≠ `full` 且当前 `executionMode === 'autopilot'` → 一并写成 `interactive` 并 echo 双字段。

`setExecutionMode('autopilot')` 且权限非 full：

- Sidecar：**拒绝**（返回 false / error echo 保持原 mode），或 coerce 为 interactive 并 log；推荐 **reject + 不改状态**，与 FE toast 一致。
- FE：不发请求或发后回滚。

`disablePlan === true` 时：`shouldPlan` 仍 false（现有规则）；UI 仍允许选 Plan，但 sidecar 行为以 `disablePlan` 为准。**v1 不在 UI 暴露 disablePlan。**

### 5.2 消息

新增（与 setForcePlan 对称）：

```ts
// Client → server
{ type: 'session:setExecutionMode'; sessionId: string; executionMode: ExecutionMode }

// Server → client (echo / hydrate)
{ type: 'session:executionMode'; sessionId: string; executionMode: ExecutionMode }
```

**兼容层（必须）**：

| 收到 | 行为 |
|------|------|
| 仅 `setForcePlan(true)` | 视同 `executionMode='plan'`，echo 两条或一条合并字段 |
| 仅 `setForcePlan(false)` | 若当前是 plan → interactive；若当前是 autopilot **保持 autopilot**（false 不再能表达 autopilot） |
| `setExecutionMode` | 权威；同步改 `forcePlan` 派生位并 **同时** echo `session:forcePlan` + `session:executionMode`（或 echo 带双字段的一条 — 推荐双消息以少改订阅方） |

旧 FE 只懂 `forcePlan`：仍能开关 Plan；无法设置 Autopilot（可接受）。

Slash / planActions：

| 命令 | 效果 |
|------|------|
| `/plan` [task] | `executionMode=plan`（= 今日 force on） |
| `/plan-off` | `executionMode=interactive` |
| `/autopilot`（可选 v1） | 仅 full → `autopilot`；否则 toast 拒绝 |
| `/interactive`（可选 v1） | `executionMode=interactive` |

**v1 最低要求**：`/plan`、`/plan-off` 语义不变；Autopilot **至少** UI 可达（且受 §4.0b 门禁）。Slash 别名可作为同 PR 小增量。

### 5.3 Autopilot 运行时（sidecar）— 落实 §4.0 零确认

**总原则：在 sidecar 结案，不依赖 FE 代点。** 避免多窗口/重连时卡片闪一下或竞态漏批。

当 `resolveExecutionMode(config) === 'autopilot'`：

1. **内置工具 HITL（`buildHitlApproval`）**  
   - 跳过 `permission:request` 发出与等待。  
   - 直接 resolve `{ kind: 'allow_once' }`（等价用户点「允许」）。  
   - **不用** `allow_always` 写入 sticky（每请求即时放行即可；模式关掉后下一轮立刻恢复询问）。

2. **ACP / 外部 `permission:request`**  
   - 入站后 **sidecar 立即** 按允许项 `permission:respond`（选 option 列表中 kind 为 allow 的项；若只有自定义 optionId，取第一个 allow 类，否则约定 `allow_once` / `allow`）。  
   - 广播结案，使任何已打开的 FE 清掉 pending，**用户无需点击**。

3. **计划审批**  
   - `planStatus === 'ready'` / 即将 `agent:interrupt` 等人批时：  
     **直接走与 `plan:respond` action=`approve` 相同路径**（不进入长时间 pending）。  
   - FE 理想路径：根本不出现可点的 Approve；若时序上闪一下，以服务端已 approve 为准自动卸卡。

4. **forcePlan / 强制规划入口**  
   - 仅 `executionMode === 'plan'` 触发 turn-start `planMode.enter()`。  
   - Autopilot **不**强制规划。

5. **日志（必打）**  
   - 每次代批：`executionMode:auto_approve`，字段含 `kind: 'tool_permission' | 'acp_permission' | 'plan'`、`sessionId`、相关 id。  
   - 便于 eval 断言「零用户 permission/plan 点击」。

6. **回归约束**  
   - Autopilot 关闭后，**下一个** HITL 必须重新询问（不残留 auto sticky）。  
   - **Autopilot 运行时前提**：`permissionMode === 'full'`；若不变量被破坏（竞态/旧数据），`resolveExecutionMode` coerce 为 interactive 且 **不**走 auto-approve。  
   - 零确认路径与 `full` 下脚本本就可 auto 的行为叠加：计划批准等 **非 full 独有** 的 HITL 仍靠 Autopilot 代批。

### 5.4 FE domain

| 层 | 变更 |
|----|------|
| `draftStore` | 存 `executionMode`；`setPermissionMode` 在降级离开 full 时 clear autopilot |
| `configFromDraft` | 写入 `executionMode` + 派生 `forcePlan`；非法 combo 规范化 |
| `sessionStore` | 处理 `session:executionMode`；`session:forcePlan` 仍更新并反推 mode（legacy） |
| `sessionService.setExecutionMode` | 门禁校验 + optimistic + transport |
| `sessionService.setPermissionMode` | 降级时原子回落 executionMode |
| `planActions` | `runPlanOn` → plan；`runPlanOff` → interactive；`runAutopilot` 校验 full |
| `PermissionModePicker` | 改权限时走 service（已有），确保回落逻辑在 service/store 单点 |
| `hooks` / debug bundle | 暴露 `executionMode` |

`agentChanged` → external primary：清 `forcePlan` **与** `executionMode`（与今日清 forcePlan 一致）。

---

## 6. UI 结构

### 6.1 组件

| 文件 | 动作 |
|------|------|
| `PlanModeChip.tsx` | **重写/改名** → `ExecutionModePicker.tsx`（或保留文件名导出新组件，避免大范围 rename 可先内部换皮） |
| `PermissionModePicker.tsx` | 逻辑经 `setPermissionMode` 回落 Autopilot；UI 布局可作 ExecutionModePicker 参考 |
| `ComposerLeftSlot.tsx` | `plan` 槽位仍挂新 picker |
| `composerControlMatrix.ts` | pin 条件：`executionMode !== 'interactive'`（替代 `forcePlan`） |
| `PlanModeChip.test.tsx` | 改为三档选择 + busy + draft/session |
| i18n `chat.plan.*` | 迁移/扩展为 `chat.executionMode.*`；旧 key 可暂时 re-export 或删除（同 PR 清干净更简单） |

### 6.2 交互细节

1. 打开菜单：三项纵向排列；当前项 Check 可见。  
2. 选中已选项：关闭菜单，无 toast（或 no-op）。  
3. 切换成功：sonner toast（分档文案）。  
4. `status === 'running'`：`aria-disabled`，点击 toast `busyTitle`，不改模式。  
5. `data-testid`：
   - 触发器：`execution-mode-chip`（**保留** `plan-mode-chip` 别名一个版本，供 e2e 过渡，或同步改 `eval-plan.ts`）。
   - 菜单项：`execution-mode-interactive` | `execution-mode-plan` | `execution-mode-autopilot`。

**e2e 推荐**：同 PR 改 `enablePlanModeUi()` 点 `execution-mode-chip` → `execution-mode-plan`，去掉「保留双 testid」的包袱。

### 6.3 可用性矩阵（不变）

| Surface | external primary | 显示 Mode？ |
|---------|------------------|-------------|
| chat | * | 否 |
| code | 否 | **是** |
| code | 是（ACP） | 否 |

---

## 7. Mapping from legacy

| 旧状态 | 新 `executionMode` |
|--------|---------------------|
| `forcePlan === true` | `plan` |
| `forcePlan` falsy / absent | `interactive` |
| （无） | `autopilot` 仅用户新选 |

会话 JSON 持久化：sidecar 存盘时写 `executionMode`；读盘时 `resolveExecutionMode`。

---

## 8. Security & product risk

| 风险 | 缓解 |
|------|------|
| 零确认 + 最大权限 | **双重显式**：先选完全访问，再选 Autopilot；不静默提权 |
| 用户从 full 降级忘记关自动 | **自动回落** interactive + toast（§4.0b） |
| 非法 combo 被旧客户端写入 | sidecar `resolveExecutionMode` coerce + 拒绝 setAutopilot |
| 自动 approve plan 导致错误实现 | 用户可 Stop；checkpoint 既有能力 |
| Eval 误开 autopilot | harness 默认 interactive；开 autopilot 的 task 须先 full |

---

## 9. Test plan

### 单元

- `resolveExecutionMode` / 写入双字段同步  
- `ExecutionModePicker`：三档切换 draft + session；busy 不切换；**非 full 时 Autopilot disabled**  
- `setPermissionMode(edit|chat)` 在 autopilot 下 → interactive  
- `composerControlMatrix`：plan/autopilot pin；interactive 不 pin  
- `configFromDraft` / `resolveExecutionMode`：非法 autopilot+!full → interactive  
- sidecar：拒绝 setExecutionMode(autopilot) when !full；autopilot 下 HITL/plan auto-approve  
- plan 下仍 enter PlanMode  

### e2e / harness

- `enablePlanModeUi` → 选 Plan  
- 既有 `harness-plan-entry` / approval 仍绿  
- （可选）autopilot：seed permission:request → 无卡、回合继续  

### 手工

- Interactive ↔ Plan ↔ Autopilot 切换 toast  
- Plan 出卡 → 批准 → 执行（回归）  
- Autopilot + edit 下触发 run_script：无权限弹窗  
- PermissionMode 与 Execution Mode 独立切换  

---

## 10. PR 切分建议

| PR | 范围 | 可合并条件 |
|----|------|------------|
| **PR1** | protocol：`ExecutionMode`、resolve helper、`SessionConfig.executionMode`、消息类型；sidecar set/get + forcePlan 双写；单测 | 不改 UI |
| **PR2** | Autopilot 运行时：HITL auto + plan auto-approve；日志 | 依赖 PR1 |
| **PR3** | FE：draft/store/service/planActions + `ExecutionModePicker` 替换 chip + i18n + matrix pin + 单测 | 依赖 PR1 |
| **PR4** | e2e helpers + harness 更新；CHANGELOG | 依赖 PR2–3 |

PR1+PR3 可在无 Autopilot 运行时的情况下先把 Plan/Interactive UI 落地（Autopilot 选项灰或先等同 Interactive）——**不推荐**；宁愿 PR2 与 PR3 同栈，避免半残档位。

更短路径：**一个 PR** 若 diff 可控（UI + protocol + autopilot HITL + tests）。

---

## 11. Key decisions（待确认）

| ID | 议题 | **推荐** | 备选 |
|----|------|----------|------|
| K1 | Autopilot 与 PermissionMode | **仅 full 可开；不静默提权**（**已锁定**，§4.0b） | 完全正交 / 点 Autopilot 自动 full |
| K1b | 从 full 降级时 | **强制回落 Interactive + toast**（**已锁定**） | 禁止降级直到先关 Autopilot |
| K2 | Autopilot 对 plan 卡 | **自动 approve，零点击**（**已锁定**，§4.0） | 仅 auto 工具权限，计划仍等人 |
| K3 | Autopilot 审批范围 | **agent 回合内全部审批默认批准**（**已锁定**） | 仅部分 HITL |
| K3b | 实现粒度 | **每请求即时 allow（allow_once 等价），不写 sticky** | allow_always 写入 sticky |
| K4 | 协议形状 | **新 `executionMode` + 双写 forcePlan** | 仅 FE 映射，协议仍 boolean（无法表达 autopilot） |
| K5 | 默认档 | **Interactive** | — |
| K6 | 默认 chip 是否高亮 | **Interactive 不高亮** | 三档均高亮当前 |
| K7 | testid | **新 id + 同 PR 改 e2e** | 保留 `plan-mode-chip` 别名 |
| K8 | Slash `/autopilot` | **v1 建议做**（成本低） | 仅 UI |
| K9 | 组件命名 | **`ExecutionModePicker`** | 保留 `PlanModeChip` 文件名 |
| K10 | 与 Grok「Mode」文案 | 中文用 **「模式」**；协议字段 `executionMode` 避免与 PermissionMode 混淆 | 产品层也叫 Mode |

---

## 12. Success criteria

1. Code composer 不再出现二值「规划」开关；改为图示结构的三档 Mode 菜单。  
2. 选 Plan 后行为与改前 `forcePlan` 一致；eval plan 任务仍可绿。  
3. 选 Autopilot 后（且仅 full），同会话 **所有 agent 审批零用户点击**；日志可证 `executionMode:auto_approve`。  
4. `chat`/`edit` 下 Autopilot 不可选；从 full 降级自动退出 Autopilot。  
5. 旧会话仅含 `forcePlan` 打开后显示正确档位。  
6. 关闭 Autopilot 后，后续 HITL 恢复询问（无残留自动放行）。

---

## 13. Open questions

1. Autopilot 是否应在 chip 上用警告色（amber）提示风险？v1 建议 **不用**，与 Full access 一致靠文案；门禁已要求 full。  
2. 全局默认 Mode（设置页）是否要做？**非 v1**。  
3. CLI `--hitl auto` 与 Autopilot 是否统一语义？建议文档互链：CLI hitl 是进程级策略，Execution Mode 是会话级；会话级 Autopilot 另需 `permissionMode=full`。  
4. 点 disabled Autopilot 时是否提供一键「切换到完全访问并开启」？**v1 否**（两步更清晰）；v1.1 可做确认框。

---

## 14. Implementation anchors

```
packages/protocol/src/session-config.ts      # ExecutionMode + field
packages/protocol/src/messages.ts            # setExecutionMode / executionMode
packages/sidecar/src/session/force-plan.ts   # keep; call from mode setter
packages/sidecar/src/session/permission-manager.ts  # autopilot short-circuit
packages/sidecar/src/session/session-turn-ops.ts     # plan auto-approve hook
src/components/chat/PlanModeChip.tsx         # → ExecutionModePicker
src/components/chat/composerControlMatrix.ts
src/domain/commands/planActions.ts
src/store/draftStore.ts
src/i18n/*.ts
e2e/helpers/eval-plan.ts
```

---

## 15. Out-of-scope follow-ups

- Settings 默认 Mode  
- Autopilot 安全确认一次（first-run modal）  
- Mode 切换动画 / 分段控件（SegmentedControl）替代下拉  
- 将 PermissionMode 与 Execution Mode 合并为单一「Agent Mode」超级菜单（明确 **不做**，两轴更清晰）
