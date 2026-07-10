# Polish P1 — 检查点恢复确认对话框（B3 收尾）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **已实现**（`lastRevertResult` 关 Modal、running 门禁、成功 toast、`TimelineView` 组件测） |
| 路线图 | [`2026-07-10-pre-public-polish-index.md`](./2026-07-10-pre-public-polish-index.md) |
| 前置 | Sprint B 主干；`TimelineView` + `git:revert` 协议 |
| 相关 | `2026-07-10-sprint-b-code-agents-experience-design.md` §3.2 B3 |

---

## 1. 问题陈述

Sprint B 目标 **B3「检查点可回退体验」** 在代码上已有大半：

| 已有 | 位置 |
|------|------|
| Timeline 行上「回退」按钮 | `TimelineView` `data-testid="timeline-revert"` |
| 确认 Modal（标题/正文/取消/确认） | 同文件 + i18n `artifact.timelineView.revertConfirm*` |
| 跨分支警告 | `crossBranchWarn` |
| 失败展示 + Retry | `revertError` + `timeline-revert-error` |
| 协议与 store | `git:revert` / `git:revert:result`；`sessionService.revertCheckpoint`；`diffStore.revertError` |
| 服务层单测 | `sessionService.test.ts` branches + revert |

缺口不在「从零做对话框」，而在 **体验闭环未验收、边角未锁死、自动化缺失**：

1. **无组件单测**：`TimelineView` 在 `ArtifactPanel.test` 中被 mock 掉，确认框/失败态/关闭路径无 RTL 覆盖。  
2. **成功关闭条件脆弱**：成功时依赖 `diff.checkpoints.length` 变化关 Modal；若列表长度不变（例如替换同 id 的 safety 语义异常）可能卡住；若失败后 length 碰巧变化会误关。  
3. **无 e2e**：用户路径「Timeline → 回退 → 确认 → 工作区恢复」未进 `e2e/`。  
4. **成功反馈偏弱**：成功后仅关 Modal + 刷列表/diff，无 toast 或明确「已创建安全检查点」提示（安全点 id 已在 `safetyCheckpointId` 里）。  
5. **Changes 与 Timeline 分工未写死**：B3 原文写「Changes 或 Timeline」；当前入口仅在 Timeline，需产品明确是否够用。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| P1.1 | **确认必经**：点回退 **不能** 直接 `git:revert`；必须先开确认 Modal |
| P1.2 | **可取消**：Cancel / ESC / 遮罩 / 关闭钮随时可退出；退出清除 `revertError` 与 spinner |
| P1.3 | **失败可恢复**：`ok: false` 时 Modal 保持打开，展示错误，可 Retry 或 Cancel |
| P1.4 | **成功可感知**：关闭 Modal；Timeline 出现安全检查点（或列表刷新）；可选轻量 toast（中英 i18n） |
| P1.5 | **跨分支可见**：目标 checkpoint.branch ≠ currentBranch 时警告条必现 |
| P1.6 | **自动化**：组件单测覆盖 open/cancel/confirm/error/retry；可选一条 e2e 冒烟 |
| P1.7 | **成功关闭条件稳健**：以 `git:revert:result` 的 ok/失败为准，**不**仅靠 checkpoints 数组长度 |

### Non-Goals

- N1 重写 git checkpoint 引擎 / safety 快照算法  
- N2 在 Changes 列表每文件「回退此文件」（整树恢复保持现状）  
- N3 冲突三方合并 UI  
- N4 历史会话无 git 时的假恢复  
- N5 删除协议字段或改 `git:revert` 载荷（除非为关闭条件必须透传）

---

## 3. 现状与目标行为

### 3.1 用户流（目标）

```
Timeline 行 → [回退图标]
  → Modal：说明工作区将精确恢复 + 会先建安全检查点
  →（可选）跨分支警告
  → 用户 [取消] → 无网络请求
  → 用户 [回退] → git:revert → spinner
       ├─ ok → 关 Modal → 列表/diff 刷新 →（可选）toast 含安全点提示
       └─ !ok → 停 spinner → 红框错误 → [重试] 或 [取消]
```

### 3.2 推荐实现调整（最小 diff）

**A. 关闭条件（必做）**

当前：

```ts
useEffect(() => { if (reverting) { setReverting(false); setRevertTarget(null) } }, [diff.checkpoints.length])
```

改为其一（优先 1）：

1. **结果驱动（推荐）**：在 `applyServerMessageEffects` / `sessionService` 处理 `git:revert:result` 时，除写 `revertError` 外，提供「最近一次 revert 结果」信号（例如 `diffStore.lastRevertResult: { checkpointId, ok, safetyCheckpointId?, at } | null`），`TimelineView` 订阅后关 Modal / 停 spinner。  
2. **回调驱动**：`sessionService.revertCheckpoint` 返回 Promise（需协议层 request-id）；改动面较大，本 polish **不优先**。

失败路径保持：`setRevertError` + 不清 `revertTarget`。

**B. 成功反馈（建议做）**

- i18n：`artifact.timelineView.revertSuccess`（如「已回退。安全检查点已创建。」）  
- 用现有 toast/通知机制（若项目无全局 toast，则 Timeline 顶部短时 banner；**不要**新造通知框架）。

**C. 入口范围（产品锁死）**

| 入口 | 本阶段 |
|------|--------|
| Timeline 每行回退 | **保留，主入口** |
| Changes 页顶「回退到 session start」 | **不做**（除非后续用户反馈） |
| 聊天消息旁回退 | **不做** |

在 Sprint B 状态与本 spec 写明：**B3 入口 = Timeline only**。

**D. 运行中保护（若尚未有）**

- 会话 `running` 时：禁用回退按钮或确认后 toast「请先停止当前运行」——与 cancel 语义一致，避免半写半恢复。  
- 实现前 grep 是否已有 gate；无则加，有则测锁定。

### 3.3 文案（已有键，核对三语）

| 键 | 用途 |
|----|------|
| `revert` | 按钮 title |
| `revertConfirmTitle` / `Body` / `Action` | Modal |
| `reverting` | spinner |
| `revertFailed` / `revertRetry` | 失败 |
| `crossBranchWarn` | 跨分支 |
| **新增** `revertSuccess`（可选） | 成功提示 |
| **新增** `revertBlockedRunning`（若做运行中保护） | 禁用原因 |

不引入 orchMode / 工作流文案。

---

## 4. 测试计划

### 4.1 组件单测 `TimelineView.test.tsx`（必做）

| 用例 | 期望 |
|------|------|
| 渲染 checkpoint 列表 + 每行 revert 按钮 | `timeline-row` / `timeline-revert` |
| 点 revert → Modal 打开，**未**调用 `revertCheckpoint` | mock service |
| 点 Cancel → Modal 关 | |
| 点确认 → 调用 `revertCheckpoint(sessionId, id)` 一次 | |
| 注入 `revertError` → 错误区可见，可 Retry 再调一次 | |
| crossBranch：checkpoint.branch ≠ currentBranch → 警告文案 | |
| 成功信号（`lastRevertResult.ok`）→ Modal 关闭、spinner 清 | |

### 4.2 领域单测（已有则扩展）

- 保持 `sessionService`：ok 刷 list/summary；fail 写 `revertError`。  
- 若引入 `lastRevertResult`：测 ok/fail 写入与 clear on close。

### 4.3 E2E（建议，可与 P2 同 sprint）

见 polish index 优先级：**P1 组件测优先；e2e 冒烟可选**。

冒烟步骤（有 git 的 temp dir）：

1. Code 会话 + init git + 产生至少 1 个 turn checkpoint（或 fixture 注入 list）。  
2. 开 Timeline → 点 revert → 确认 Modal 存在。  
3. Cancel 后工作区文件内容不变。  
4.（可选）确认后文件恢复 — 依赖真实 sidecar git，CI 需 git 可用。

若 e2e 环境难造 checkpoint，**允许仅组件测作为 P1 Done**，e2e 记入后续。

---

## 5. 任务拆分

| # | 任务 | 优先级 |
|---|------|--------|
| P1.a | 稳健关闭：`lastRevertResult`（或等价）+ Timeline 订阅 | P0 |
| P1.b | `TimelineView.test.tsx` 全表 4.1 | P0 |
| P1.c | running 门禁（若缺） | P1 |
| P1.d | 成功 toast/banner + i18n 三语 | P1 |
| P1.e | e2e 冒烟（可选） | P2 |
| P1.f | 更新 Sprint B 状态：B3 **体验验收完成** | 收尾 |

---

## 6. 成功标准（P1 Done）

1. 无「一点击立即 revert」路径（grep UI 仅确认后调用）。  
2. 失败 Modal 不砖；Cancel 始终可用。  
3. 组件单测全绿；既有 `sessionService` / diff 测不回归。  
4. 文档标明入口 = Timeline only；Sprint B B3 从「可后续补」改为「已验收」或链到本 spec 完成。  
5. **不**改 checkpoint 核心算法；diff 范围限于 Timeline / diffStore / effects / i18n / tests。

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| `lastRevertResult` 与多 session 串扰 | 按 sessionId 存；仅 active session 关 Modal |
| e2e 无 checkpoint | 组件测为门禁；e2e 降级 |
| 成功 toast 框架缺失 | 用 Timeline 内联 banner 30s 或现有通知 |
| running 中 revert 损坏半成品 | 禁用或硬提示先 stop |

---

## 8. 与 B3 原文对照

| B3 原文 | 本阶段 |
|---------|--------|
| 入口可见 | Timeline 已有；补测与可发现性（title/i18n） |
| 确认对话框 | 已有；补稳健关闭 + 测 |
| 失败文案 | 已有；补组件测 |
| 不重写引擎 | 维持 |
