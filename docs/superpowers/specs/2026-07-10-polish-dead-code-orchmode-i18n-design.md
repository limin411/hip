# Polish P3 — 死代码与 orchMode i18n 清理

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **已实现** |
| 路线图 | [`2026-07-10-pre-public-polish-index.md`](./2026-07-10-pre-public-polish-index.md) |
| 前置 | Sprint C：orchMode 产品路径已忽略；协议字段仍兼容读 |
| 相关 | `2026-07-10-sprint-c-architecture-convergence-design.md` §3.4 C4/C5；agent-driven design |

---

## 1. 问题陈述

用户可见的 fast/dag 与独立 DAG tab 已下线，但仓库仍残留：

1. **i18n 死键**：`chat.orchMode.*` 仍在 `en.ts` / `zh-CN.ts` / `zh-TW.ts`，无生产 UI `t()` 引用。  
2. **测试化石**：`ModelPicker.test.tsx` 仍 mock `chat.orchMode.*` 键（组件本身已不展示 toggle）。  
3. **协议/服务兼容层**仍在（**应保留**）：`SessionConfig.orchMode`、`session:setOrchMode`、`session:orchMode`、workflow 测试入口。  
4. **其它可能死面**：workflow 前端 store / 无 UI 的 handler 订阅、注释与文档仍写「Cluster Mode 产品路径」。

公开前需要 **收敛用户文案与误导注释**，同时 **不破坏** 旧 session JSON 与 WS 兼容。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| P3.1 | 删除三语 `chat.orchMode` 整块；确认无 `t('chat.orchMode…')` 残留 |
| P3.2 | 清理仅服务已删 UI 的测试 mock / 断言文案 |
| P3.3 | 扫前端：无 DAG tab、无 orchMode 开关、无「单实例/集群」用户可见字符串（i18n 与硬编码） |
| P3.4 | 协议与 sidecar **兼容层保留**并带 `@deprecated` / 注释「ignored for turn routing」 |
| P3.5 | 可选：前端 `setOrchMode` 标 deprecated；调用点若仅测试则收紧 |
| P3.6 | 文档：Sprint C C5 与本 spec 交叉链接；避免新人以为 Cluster Mode 仍是产品功能 |

### Non-Goals

- N1 从协议 **删除** `orchMode` 字段或 `session:setOrchMode` 消息类型（破坏旧客户端/DB）  
- N2 删除 `workflow:run` / `pendingWorkflowDef` / `buildClusterDefaultWorkflow`（测试与内部仍用）  
- N3 删除 `workflowStore` 全库（若仍有 WS 事件折叠；仅删 **无引用** 的 UI 绑定）  
- N4 大重构 session-config 默认值结构  
- N5 翻译文件全量 unused-key 自动化（本阶段手工 + grep；可记后续）

---

## 3. 清理范围矩阵

### 3.1 删除（安全）

| 目标 | 动作 |
|------|------|
| `src/i18n/en.ts` → `chat.orchMode` | 整块删除 |
| `src/i18n/zh-CN.ts` / `zh-TW.ts` 同上 | 整块删除 |
| `ModelPicker.test.tsx` 中 orchMode i18n mock 行 | 删除；保留「不展示 orch toggle」断言 |
| 其它测试里仅断言 Cluster/Single 文案的用例 | 删除或改写为 agent-driven 语义 |
| 注释写「用户切换 orchMode」的过时说明 | 改为 deprecated / ignored |

### 3.2 保留（兼容）

| 目标 | 动作 |
|------|------|
| `packages/protocol` `orchMode?: 'fast'\|'dag'` | 保留 + JSDoc `@deprecated` |
| `normalizeSessionConfig` 读字段 | 保留默认；**不**影响 runTurn |
| sidecar `session:setOrchMode` | 可继续写 config 或 no-op；注释产品忽略 |
| `sessionStore` `session:orchMode` 分支 | 保留投影，供旧会话 load |
| `session-workflow-running.test` orchMode=dag 不进 workflow | **保留**回归锁 |
| `buildClusterDefaultWorkflow` | 保留 +「非产品默认」注释（C 已有则不动） |

### 3.3 评估后决定（grep 驱动）

实现时跑一遍，按引用数决定：

```text
# 用户文案 / UI
rg -n "orchMode|单实例|集群模式|Cluster Mode|Orchestration Mode" src packages --glob '!**/node_modules/**'

# 协议（预期仍有）
rg -n "setOrchMode|session:orchMode|session:setOrchMode" packages src

# 工作流 UI
rg -n "workflowStore|DagEditor|tab-dag|panel-tab-dag" src
```

| 结果 | 动作 |
|------|------|
| `DagEditor` 无路由引用 | 不强制删文件；可标 legacy 或移 `legacy/`（本阶段 **优先不搬目录**，只去入口） |
| `workflowStore` 仍被 `serverMessageEffects` 使用 | **保留** store；去掉仅 UI 的 getActive on load（若 C 未做完） |
| 硬编码中文「集群」在 UI | 删除或改 Agents 协作文案 |

### 3.4 i18n 类型

若项目有 `i18n` 类型生成 / `as const` 嵌套：

- 删键后跑 `yarn tsc` / 相关 test，修类型错误。  
- 无生成器则三语结构保持对称即可。

---

## 4. 分层清理策略（与 C 一致）

```
第 1 步  停读：确认 UI 无 t(orchMode) / 无开关
第 2 步  删文案：i18n 三语 + 测试 mock
第 3 步  扫串：用户可见「集群/单实例」清零
第 4 步  不删协议：仅注释与 deprecate
第 5 步  回归：yarn test 相关包 + tsc
```

**禁止**在同 PR 中：删协议消息 + 删 i18n + 大搬 workflow 引擎。本 polish **只做文案与死 UI 测**，协议动作为注释级。

---

## 5. 任务拆分

| # | 任务 | 风险 |
|---|------|------|
| P3.a | grep 基线清单写入 PR 描述或本 spec 附录（实现时填） | 低 |
| P3.b | 删三语 `chat.orchMode` | 低 |
| P3.c | 修 `ModelPicker.test` 等测试 | 低 |
| P3.d | 用户可见字符串扫零 | 低 |
| P3.e | protocol/sidecar `@deprecated` 注释补齐（缺则补） | 低 |
| P3.f | `yarn test` / `yarn tsc` 相关 | 中（漏改类型） |
| P3.g | 更新 Sprint C「C5 文案清理」状态 → 本 spec 完成 | — |

---

## 6. 成功标准（P3 Done）

1. `rg "chat\.orchMode|orchMode:\s*\{" src/i18n` 无业务键（测试 fixture 除外且应无）。  
2. `rg "单实例模式|集群模式|Cluster Mode|Orchestration Mode" src` 无 **UI 源码** 命中（文档 `docs/` 历史 design 可保留）。  
3. ModelPicker 仍断言 **不** 显示 orch toggle。  
4. sidecar 测试「orchMode=dag 无 pending 不进 workflow」仍绿。  
5. 无协议 breaking change；旧 `sessions.config` JSON 仍可 load。

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 外部插件/脚本读 i18n 键 | 产品未公开；无外部承诺 |
| 误删仍被引用的 workflow UI | 先 grep 引用再删；不确定则留代码 |
| 文档与代码双真源 | 历史 spec 顶部已有 supersede；本清理不改历史正文大段 |

---

## 8. 附录 — 实现前已知残留（2026-07-10 扫描）

| 位置 | 类型 | 建议 |
|------|------|------|
| `src/i18n/{en,zh-CN,zh-TW}.ts` `chat.orchMode` | 死 i18n | **删** |
| `src/components/chat/ModelPicker.test.tsx` mock 键 | 测试化石 | **删 mock 行** |
| `src/domain/sessionService.ts` `setOrchMode` | 兼容 API | 保留 + deprecated |
| `packages/protocol` orchMode 字段 | 兼容 | 保留 |
| `packages/sidecar` setOrchMode handler | 兼容 | 保留 |
| `docs/superpowers/specs/*orch-mode*` | 历史设计 | 保留；已 supersede |

实现 PR 合并前应重跑 grep，更新本附录为「已清理」。
