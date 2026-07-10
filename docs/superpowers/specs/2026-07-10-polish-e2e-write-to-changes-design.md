# Polish P2 — 完整 e2e：改文件 → Changes 列表

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **待实现** |
| 路线图 | [`2026-07-10-pre-public-polish-index.md`](./2026-07-10-pre-public-polish-index.md) |
| 前置 | Sprint B：`diffRefreshOnWrite` + `tool:finished` → 防抖 `requestDiff`；既有 `e2e/specs/diff-workspace.spec.ts` |
| 相关 | `2026-07-10-sprint-b-code-agents-experience-design.md` §3.1 B1/B2 |

---

## 1. 问题陈述

Code 闭环的产品承诺是：

> agent **成功** write/edit 后，用户在 **Changes** 能看到对应 path，且无需「瞎点刷新」。

当前分层状态：

| 层 | 状态 |
|----|------|
| 前端钩子 | `serverMessageEffects`：`tool:finished` + `shouldRefreshDiffOnToolFinish` → 300ms 防抖 `fs:diffSummary` / `requestDiff`（code 或 Changes 开时全量） |
| 单元测 | `serverMessageEffects.test.ts` 已覆盖「write_file → 调度 refresh」 |
| E2E 现状 | `diff-workspace.spec.ts`：**带外**改文件 + **手动切 Files→Changes** 才看到 diff（注释写明 sidecar 无 live fs watcher） |
| 缺口 | **没有**「工具写盘 → 自动刷新 → Changes 列表出现 path」的端到端；也没有「不切换 tab、停留在 Changes 时自动出现」的断言 |

因此 B1 的 e2e 交付物仍算未闭合：集成真实在，**完整用户路径未锁**。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| P2.1 | 至少一条 **自动化** 路径证明：工作区文件被「agent 写工具语义」修改后，Changes 列表出现该 path |
| P2.2 | 覆盖 **自动刷新**（不依赖用户切走再切回 tab），或在文档中明确「允许的触发器」并测该触发器 |
| P2.3 | 与现有 `diff-workspace` 不重复打架：旧用例保留「init git / 带外编辑 / split view」；新用例专攻 write→Changes |
| P2.4 | CI 可跑：不依赖真实付费 LLM；可用 mock 工具事件 **或** sidecar 确定性写文件 API |
| P2.5 | Cancel 相关：若本 sprint 有余力，补「cancel 后已落盘文件仍在 Changes」（B2）；否则列为 P2.optional |

### Non-Goals

- N1 上真实 LLM 让 agent「自由发挥」写文件（慢、贵、不稳）  
- N2 实现全盘 fs.watch（产品可后续做；本 e2e 不绑定 watcher）  
- N3 多文件 jump list / split view 再测一遍（已有）  
- N4 Timeline / checkpoint 回退（见 P1）  
- N5 非 git 目录的 Changes（Changes 仍 git-gated）

---

## 3. 设计：三条实现路径（择一为主）

按 **稳定性 × 产品真实性** 排序，推荐 **路径 A 为主，B 为增强**。

### 路径 A — 确定性写盘 + 模拟 tool:finished（推荐主路径）

**思路：** 不跑 LLM。在 e2e 里：

1. 建 temp 目录 → Code 会话 → init git → 打开 Changes（干净树）。  
2. **直接**用 Node `fs` 修改 `hello.txt`（或新增 `agent-wrote.txt`）模拟落盘。  
3. 通过 **测试钩子** 注入与生产相同的刷新条件：  
   - **A1（优先）**：若 dev/e2e 暴露 debug 桥（如 `window.__hipTest.injectServerMessage`），注入：  
     - 先有 turn 上 in-flight `write_file` toolCall（或最小 fake message）  
     - 再 `tool:finished` status=finished  
   - **A2（次选）**：若无注入桥，则调用前端已有 `sessionService` 可测入口 / 打开 devtools evaluate 触发 `requestDiff`（弱：只证明 diff 拉取，不证明 tool 钩子）。  
4. **不断开** Changes tab，等待 `[data-testid="diff-file"]` 文本含目标 path。

**验收语义：** 「write 工具完成后的 refresh 管线」在真 app 壳里打通。

**前置工作（若缺注入桥）：**

- 仅在 `import.meta.env.MODE === 'test'` 或 `E2E=1` 时挂 `window.__hipE2E`：  
  - `injectServerMessage(msg: ServerMessage)`  
  - 或更窄：`simulateWriteToolFinished(sessionId, callId, path)`  
- **禁止** 生产包暴露；用 tree-shake / 条件编译。  
- 单测可直接调 `applyServerMessageEffects`，e2e 才需要桥。

### 路径 B — Sidecar 集成：真实 write_file 工具（无 LLM）

**思路：** 测试专用 client 消息或内部 RPC「以 agent 身份执行 write_file」，走完整 tool-runner → 落盘 → `tool:finished` WS → 前端 effects。

| 优点 | 缺点 |
|------|------|
| 最接近生产 | 要加测试专用入口或 fixture harness；权限模式需 autoApprove |
| 覆盖 sidecar 输出事件形状 | e2e 更重、失败面更大 |

**建议：** 作为第二阶段；若路径 A 的注入桥成本高而 sidecar 已有 scripted tool 测试，可对调。

### 路径 C — 真 LLM 冒烟（手工 / 夜间）

- 文档化手工脚本：「在 Code 会话说创建 foo.txt」→ 看 Changes。  
- **不**进默认 CI。  
- 可复用 Sprint A debug bundle 核对 tool 名。

---

## 4. 目标用例规格

### 4.1 E2E-write-auto（P0）

| 步骤 | 期望 |
|------|------|
| Code + temp git repo + Changes 已打开且 clean | 无 `diff-file` |
| 落盘修改 `hello.txt`（或新建文件）+ 触发 write 完成语义 | — |
| **不**切换 tab | — |
| 等待 ≤ 30s | 出现 `diff-file`，文本含该 path |
| （可选）点开文件 | hunk 含新内容一行 |

### 4.2 E2E-write-debounce（P1，可单测代替）

| 步骤 | 期望 |
|------|------|
| 短时间连续 3 次 write finished | `fs:diff` / summary 请求次数 ≤ 2（防抖 300ms） |

单测已部分覆盖；e2e 可不重复，但路径 A 桥若存在可抽集成测。

### 4.3 E2E-cancel-keeps-diff（P2 optional）

| 步骤 | 期望 |
|------|------|
| 运行中已 write 落盘后 cancel | 聊天有 partial（A）；Changes 仍有该 path |

依赖 cancel e2e 基建，可后置。

### 4.4 与现有 `diff-workspace` 关系

| 用例 | 保留？ |
|------|--------|
| init / baseline commit / 带外编辑 + 切 tab | **保留**（证明无 watcher 时手动刷新仍可用） |
| split / show-full / jump list | **保留** |
| **新文件** `e2e/specs/write-to-changes.spec.ts`（或同文件新 describe） | **新增** auto-refresh 路径 |

文档注释更新：旧用例说明「无 watcher 时的 fallback」；新用例说明「tool:finished 自动刷新」。

---

## 5. 实现任务拆分

| # | 任务 | 依赖 |
|---|------|------|
| P2.a | 确认/实现 e2e 注入桥（或选定路径 B） | — |
| P2.b | 辅助：确保 active session + turn 上有 write_file toolCall 名可解析（effects 靠 name） | effects 实现 |
| P2.c | 新 spec：`write-to-changes` 或 describe 块 | P2.a–b |
| P2.d | CI 文档：`yarn e2e` / grep 标签如何只跑 diff 相关 | — |
| P2.e | 更新 Sprint B：B1 e2e **闭合** | P2.c 绿 |
| P2.f | （可选）cancel 保留 diff | A cancel 稳定 |

**路径 A 下 P2.b 细节：**

`shouldRefreshDiffOnToolFinish` 需要 tool **name**。`tool:finished` 本身无 name，effects 从 turn 消息的 `toolCalls` 反查。因此注入顺序必须是：

1. 域内已有 assistant/turn 消息含 `{ callId, name: 'write_file', status: 'running' }`  
2. 再发 `tool:finished` 同 callId、`status: 'finished'`

注入桥应封装这两步，避免 e2e 手写易碎消息图。

---

## 6. 成功标准（P2 Done）

1. CI 或本地一键可跑的自动化用例：**不切换 tab** 时 Changes 出现目标 path。  
2. 不依赖付费 API key。  
3. 现有 `diff-workspace` 全绿。  
4. 单元测 `serverMessageEffects` 仍覆盖 debounce / 工具白名单。  
5. README 或 e2e 注释写清两条路径：自动（tool）vs 手动 tab 刷新（带外编辑）。

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 注入桥泄漏到生产 | 条件编译 + 禁止生产构建定义 |
| effects 只在 `view==='code' \|\| tab==='changes'` 全量 diff | e2e 固定 Code + Changes 打开 |
| 防抖导致 flake | waitUntil 30s + 间隔 500ms；避免 assert 过快 |
| git-gated 隐藏 Changes | 复用 `initGitAndOpenChanges` |
| 路径 B 权限弹窗 | autoApprove / 测试 permissionMode |

---

## 8. 建议落地顺序

1. 先写失败 e2e（红）锁定「不切 tab 应出现」。  
2. 若红在「无事件」→ 做注入桥。  
3. 若红在「有事件无列表」→ 查 diff 请求/git status。  
4. 绿后更新 Sprint B 与 polish index。
