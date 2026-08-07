# Spec: managedTerminalStore 家族写耦合治理

> 日期：2026-08-07 · 状态：草案（待评审）· 范围：`src/store/managedTerminalStore.ts` 对 4 个 terminal store 的写耦合收敛
> 背景：`docs/architecture/store-dependencies.md` R3 豁免项（2026-08-07 依赖盘点）；架构评审第 2 号建议

---

## 1. 背景与目标

依赖盘点（`docs/architecture/store-dependencies.md`）确认全库唯一的 store→store **写耦合**是 `managedTerminalStore` 家族（其余 7 条边均为只读，已按 R2 注释）。当时按"存量冻结"原则豁免，本 spec 对其进行**单独治理**。

**目标**：把 `managedTerminalStore` 中散落的 14 处跨 store 写调用收敛到一个**终端生命周期协调模块**，使 store 层恢复单向纯净（R1/R2 全量生效，取消 R3 豁免），同时不改变任何外部行为。

**成功判据**：

1. `managedTerminalStore.ts` 中 `useTerminal(Agent|Fs|Host|Store)Store.getState()` 调用数从 **14 → 0**。
2. `check-store-deps.mjs` 豁免表可整体删除（R3 取消），脚本全量 R2 校验通过。
3. 现有 `managedTerminalStore.test.ts` 等测试零行为改动通过。
4. 终端打开/关闭/删除的副作用顺序与现状逐位一致（close → 清 ring → 清 fs 缓存 → 清 agent 执行态）。

---

## 2. 现状盘点（事实基线）

### 2.1 依赖方向

```
managedTerminalStore ──写──► terminalStore（ensureSession / clearSession ×5）
      │                  ──写──► terminalFsStore（clearTerminal ×3）
      │                  ──写──► terminalAgentStore（setExecFlight ×3 / setActiveSession ×2）
      │                  ──写──► terminalHostStore（pushRecent ×2 / removeTerminalRecord ×1）
      ▼
反向依赖：4 个 store → managedTerminalStore = 0 条（单向边，无环）
```

### 2.2 14 处调用明细

| # | 调用 | 位置 | 语义 |
|---|---|---|---|
| 1–2 | `terminalHostStore.pushRecent({type:'local'/'ssh'})` | `recordSuccessfulLocalLaunch` / `recordSuccessfulSshLaunch`（模块级导出函数，130/140 行） | 启动成功后记入最近启动（K11） |
| 3–4 | `terminalStore.ensureSession(id)` | `openLocal` / `openSsh` 内部（182/203 行） | 打开时确保 ring 会话存在 |
| 5 | `terminalStore.clearSession(id)` + `terminalFsStore.clearTerminal(id)` | `close` SSH 分支（225–226 行） | 关闭时清 ring + fs 缓存 |
| 6–8 | `clearSession` + `clearTerminal` + `setExecFlight` + `setActiveSession` | `close` 常规分支（249–252 行） | 同上 + 清 agent 执行态 |
| 9–12 | 同 6–8（4 调用） | `removeRecord`（316–319 行） | 删记录时全量清理 |
| 13 | `terminalHostStore.removeTerminalRecord?.(id)` | `removeRecord`（320 行） | 同步删 host 目录记录 |
| 14 | `clearSession` + `ensureSession` + `clearTerminal` + `setExecFlight` + `setActiveSession` | `reconnect`（336–339 行） | 重连时重建会话并清残留 |

### 2.3 问题分析

1. **副作用散落**：同一"关闭终端"语义在 `close`/`removeRecord`/`reconnect` 三处重复实现（5 行一组），新增清理项时必须三处同步改，漏改即状态泄漏。
2. **不可独立审计**：跨 store 副作用埋在 store action 深处，无法单测"清理顺序"，也无法被其他调用方复用。
3. **豁免机制的永久化风险**：R3 豁免表是"冻结存量"的权宜，若无治理计划会永久存在，后续新增 terminal store 时边界会继续模糊。
4. **组件层也存在重复清理**（如 `terminalRecordActions.ts` 的 host 级联删除路径有独立实现），缺少统一入口。

---

## 3. 目标架构

```
组件层 / sessionService / 其他调用方
        │  调用
        ▼
src/domain/terminalLifecycle.ts   ← 新增：终端生命周期协调层（唯一跨 store 写入点）
        │  只依赖 4 个 terminal store（不依赖 managedTerminalStore，无环）
        ▼
terminalStore · terminalFsStore · terminalAgentStore · terminalHostStore
        ▲
managedTerminalStore（自身状态 set 保留内部；跨 store 副作用全部委托协调层）
```

要点：

- **协调层是"纯函数集合"，不是 store**：`disposeTerminal(id)`、`openTerminal(id)`、`recordLaunch(...)` 等，内部按固定顺序调用 4 个 store 的 action。
- **managedTerminalStore 保留"命令者"角色**：`close`/`removeRecord`/`reconnect` 的自身状态变更（`set`）仍在 store 内，但 5 行跨 store 清理替换为一行协调层调用。
- **顺序保证**（现状逐位等价）：`close` 路径 = 先杀后端（ptyKill/sshClose）→ 协调层清理（ring → fs → agent）→ 自身状态 set。协调层函数把"ring → fs → agent"顺序固化为契约并测试锁定。
- **check-store-deps 回归全量**：managedTerminalStore 不再 import 4 个 store → R3 豁免表删除 → R1/R2 全量生效。

---

## 4. 模块设计

### 4.1 `src/domain/terminalLifecycle.ts`（预计 ~80 行）

```ts
/** 打开终端后：确保 ring 会话存在（现状 openLocal/openSsh 内部行为）。 */
export function ensureTerminalSession(id: string): void
// 内部：useTerminalStore.getState().ensureSession(id)

/** 关闭/删除终端后：按固定顺序清理跨 store 残留（ring → fs → agent）。 */
export function disposeTerminal(id: string, opts?: { keepAgentSession?: boolean }): void
// 内部（顺序为契约，测试锁定）：
//   1. useTerminalStore.getState().clearSession(id)
//   2. useTerminalFsStore.getState().clearTerminal(id)
//   3. useTerminalAgentStore.getState().setExecFlight(id, null)
//   4. useTerminalAgentStore.getState().setActiveSession(id, null)

/** reconnect 场景：先清理残留再重建 ring 会话。 */
export function resetTerminalForReconnect(id: string): void
// 内部：disposeTerminal(id) → ensureTerminalSession(id)

/** 成功启动后记入最近启动（K11）。 */
export function recordTerminalLaunch(opts: { type: 'local' | 'ssh'; cwd?: string; hostId?: string; label?: string }): Promise<void>
// 内部：useTerminalHostStore.getState().pushRecent(...)

/** 删除托管记录时同步删 host 目录记录（现状 removeRecord 内 removeTerminalRecord?.）。 */
export function removeHostTerminalRecord(id: string): Promise<void>
// 内部：useTerminalHostStore.getState().removeTerminalRecord?.(id)
```

### 4.2 managedTerminalStore 改造点（14 → 0）

| 位置 | 现状 | 改为 |
|---|---|---|
| `recordSuccessfulLocalLaunch` / `recordSuccessfulSshLaunch` | `pushRecent` 直接调用 | `recordTerminalLaunch(...)` |
| `openLocal` / `openSsh` | `ensureSession(id)` | `ensureTerminalSession(id)` |
| `close` SSH 分支（225–226） | `clearSession` + `clearTerminal` | `disposeTerminal(id)` |
| `close` 常规分支（249–252） | 4 调用 | `disposeTerminal(id)` |
| `removeRecord`（316–320） | 4 调用 + `removeTerminalRecord?.` | `disposeTerminal(id)` + `removeHostTerminalRecord(id)` |
| `reconnect`（336–339） | 5 调用 | `resetTerminalForReconnect(id)` |

> **命名待评审**：`terminalLifecycle.ts` vs `actions/terminalActions.ts`。倾向 `terminalLifecycle.ts`（它是生命周期语义，且不依赖 transport/waiter，不需要 actions 的注入形态）。

### 4.3 其他调用方的收口（可选，P3）

`terminalRecordActions.ts`（host 级联删除）、`codeTerminalController.tsx` 等若存在同类清理序列，改走协调层——**本 spec 只要求"同序列必走协调层"**，若组件有独立清理序列则保留并在文档标注（避免过度扩散）。

---

## 5. 依赖规则更新

`docs/architecture/store-dependencies.md`：

- R3 改为"已治理，2026-08 后取消豁免"；豁免表删除。
- `scripts/check-store-deps.mjs`：删除 `ALLOWLIST`（或保留空集 + 注释"R3 已取消"），脚本全量 R2。

---

## 6. 迁移步骤

| Phase | 内容 | 门禁 |
|---|---|---|
| **P0 基线** | 跑通 `yarn test`（无 key）；记录 `managedTerminalStore.test.ts` 覆盖 | 全绿 |
| **P1 协调层** | 新建 `src/domain/terminalLifecycle.ts` + `terminalLifecycle.test.ts`（顺序契约、幂等、launch 记录） | tsc + 新测试绿 |
| **P2 store 替换** | managedTerminalStore 14 处调用替换为协调层；`yarn test` 全绿 | tsc + 全量相关测试绿 |
| **P3 周边收口** | 扫描 `terminalRecordActions`/组件层的重复清理序列，同序列者改走协调层（**仅限完全同序列**） | tsc + 相关测试绿 |
| **P4 规则回退** | 删除 `check-store-deps.mjs` 豁免表；更新 `docs/architecture/store-dependencies.md`（R3 取消） | `yarn check:store-deps` 通过 |

提交纪律：每 Phase 独立提交，前缀 `refactor(terminal-lifecycle)`；P2 是纯替换（`git diff --word-diff` 抽检无逻辑变更）。

---

## 7. 验收标准

1. `managedTerminalStore.ts` 中 `useTerminal(Agent|Fs|Host|Store)Store` import 与调用全部移除（14 → 0）。
2. `yarn check:store-deps` 在无豁免表下通过（全库 0 条 store→store 写边；只读边均有 R2 注释）。
3. `terminalLifecycle.test.ts` 锁定清理顺序（ring → fs → agent）与 reconnect 重建语义。
4. 现有 `managedTerminalStore.test.ts`（366 行 store 的测试）零行为改动通过。
5. 终端 e2e 路径不受影响（`yarn test:e2e:smoke` 或手工冒烟：开/关/删/重连 SSH 与本地终端）。

---

## 8. 非目标

- 不改造 4 个 terminal store 的内部实现（`terminalStore` 的 ring 结构等）。
- 不引入事件总线/订阅模式解耦（方案 B 仅记录备选，不做）。
- 不治理组件层对 terminal store 的直接写（非 store→store 边，超出 R1 范围）。
- 不改 `terminalRecordActions.ts` 的 host 级联删除逻辑（仅在其清理序列与协调层完全同构时收口）。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 协调层成为新的"上帝模块" | 只含 5 个薄函数（合计 ~80 行），职责限定生命周期语义；超界内容下沉各 store |
| `removeTerminalRecord?.` 可选调用丢失 | P1 测试显式覆盖可选链语义（undefined 时不抛错） |
| reconnect 的"重建"顺序与现状不符 | P1 按现状逐行对照实现；P2 用 `git diff --word-diff` 抽检 |
| 组件层存在同序列清理但未收口 → 双实现漂移 | P3 扫描并收口完全同序列者；文档标注残留 |
| 测试受 paid-LLM 污染 | 遵循 CLAUDE.md 的 key 移走流程 |

---

## 10. 待评审决策点

1. **模块命名**：`terminalLifecycle.ts` vs `actions/terminalActions.ts`（推荐前者，无 transport/waiter 依赖）。
2. **P3 范围**：组件层同序列清理是否本轮收口（推荐收口，防漂移）。
3. **`disposeTerminal` 的 `keepAgentSession` 选项**：现状 `close` SSH 分支不调 agent store（225–226 行只有 2 调用），是否用选项参数表达（推荐：是，避免三个近似函数）。
