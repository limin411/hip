# Sprint B — Code 闭环 · Agents 体验 · 上下文 · 扩展安装

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **草案 / 待实现**（**依赖 Sprint A Done**） |
| 路线图 | [`2026-07-10-pre-public-roadmap-index.md`](./2026-07-10-pre-public-roadmap-index.md) |
| 前置 | A 的投影正确性、cancel、调试导出可用 |
| 相关 | `2026-07-10-code-panel-terminal-design.md`、Agents `CollaborationStructure`、architecture-remediation 中 AGENTS.md 注入 |

---

## 1. 问题陈述

A 解决「运行时不撒谎」。B 解决用户 **感知闭环**：

1. Code 场景：让 agent 改文件后，**立刻在 Changes 看到**，cancel 后不丢半成品感知  
2. Agents 面板：不只列表，还要 **失败/耗时/可跳转**  
3. 成本：简单 ls 不应吞掉上万 prompt tokens  
4. Skills/MCP：装不上时用户看得懂  

仓库已有：diff/checkpoint 基建、AGENTS.md 加载器、终端设计稿、CollaborationStructure（有子代理才展开）。B 是 **补齐体验与缺口**，不是从零发明。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| B1 | **Code 改→看见**：agent 成功 write/edit 后 Changes 自动刷新；e2e 覆盖「改文件 → Changes 有条目」 |
| B2 | **Cancel 与 diff**：cancel 后已落盘改动仍可在 Changes 看到；聊天有 partial（A 保证） |
| B3 | **检查点可回退体验**：入口可见、失败有文案（不重写 checkpoint 引擎） |
| B4 | **Agents 面板 v2**：状态（running/done/error）、耗时、token（若有）、点击工具行/定位 |
| B5 | **上下文瘦身**：工具列表分层和/或 surface 提示裁剪；可测的 budget 上限 |
| B6 | **项目指导可见性**：AGENTS.md 等已注入时，设置或会话侧可感知「已加载」；缺失时不吵 |
| B7 | **MCP/Skill 安装失败可读**：错误码 → 人话 + 下一步（路径 allowlist、权限等） |

### Non-Goals

- N1 xlsx 解析  
- N2 新 DAG tab / 工作流编辑器  
- N3 向量记忆 / RAG  
- N4 持久化表合并（→ C）  
- N5 终端全功能重做（若 terminal 未开 flag，B 可只保证不与 run_script 冲突的文档）  

---

## 3. 设计

### 3.1 Code 闭环：改 → 看见（B1/B2）

**数据流（目标）：**

```
tool:finished(write_file|edit_file) 成功
  → sidecar 可发 fs:changed 或前端已有 diff 请求钩子
  → diffStore 刷新当前 session
  → Changes  tab 角标 / 列表更新
```

**实现注意：**

- 沿用现有 `fs:diff*` / `requestDiff`；优先 **复用** `serverMessageEffects` 里已有 refresh 点  
- 防抖：同一 turn 内多次 write → 合并 refresh（如 300ms）  
- cancel：不 rollback 用户盘（除非用户点恢复检查点）；Changes 反映 **工作区真实状态**

**E2E（B 交付物）：**

| 场景 | 步骤 | 期望 |
|------|------|------|
| E2E-write | Code 会话 + 可写 cwd → 驱动 agent 写文件（或测试注入 tool 结果）→ 开 Changes | 列表出现该 path |
| E2E-cancel | 运行中 cancel → 聊天有 assistant；若已写文件则 Changes 仍可见 | 无空白会话 |

若完整 agent e2e 过重：允许「UI 测：mock tool:finished → diff 请求被调用」+ 一条 sidecar 集成。

### 3.2 检查点回退体验（B3）

**不改** git checkpoint 核心算法。补：

- Changes 或 Timeline 上 **「恢复到此检查点」** 文案与确认对话框  
- 失败：`git` 缺失 / 非仓库 / 冲突 → 已有 i18n 键补齐  
- 与 A 调试包：可选附带 `diff_base_sha` / 最近 checkpoint id（若消息里有）

### 3.3 Agents 面板 v2（B4）

在现有 `AgentDashboard` + `AgentCard` + `CollaborationStructure` 上增强：

| 元素 | 行为 |
|------|------|
| 状态 | `running` / `done` / **`error`**（来自 run 无 finished 且 session error，或 output 以 Error 前缀且 stopped） |
| 耗时 | 已有 elapsed；统一 clock |
| Token | 若 `agentRuns.usage` 有值则显示；无则隐藏 |
| 协作结构 | 保持 D2：仅有子代理时展示 |
| 跳转 | 点击 tool 行 → 可选滚动主聊天到该 turn（`scrollTargetMessageId` 已有则复用） |

**错误态：** 子 agent 卡片边框/ badge 用 destructive，不新增 tab。

### 3.4 上下文 / 成本（B5）

**分层策略（选一或组合，实现时写进 plan）：**

**方案 L1 — 工具定义分层（推荐先做）**

- Core 工具始终进 schema：`read_file, write_file, edit_file, ls, glob, grep, run_script, write_todos`  
- Extended 默认不进 schema，除非：  
  - 用户开启「完整工具」设置，或  
  - 系统提示声明「需要 git/task 时再…」且模型可 `use_skill` / 第二轮展开（若现架构难做动态 schema，则退化为 L2）

**方案 L2 — Prompt 裁剪（必做底线）**

- Chat surface：更短 BASE；弱化 git 长指导  
- Code surface：保留 git；强化「简单任务不委派」（A 已写，B 可按 surface 分叉）  
- Skills block：已有 budget；默认更紧（如 1500 chars）

**验收：**

- 单测：给定 mock catalog，Code vs Chat 的 system prompt 长度或工具数有可断言差异  
- 手工：同模型下列目录 turn 的 prompt_tokens 对比（记入 debug 包，不设硬 KPI）

### 3.5 项目指导可见性（B6）

已有 `ProjectAgentsMdInjector` 等：

- **设置 → 项目 / 会话信息** 或 Composer 旁小 chip：`已加载 AGENTS.md`  
- 点击展开路径与前 200 字预览  
- 无文件：不显示 chip（不恐吓用户）  
- 优先级文档化：`AGENTS.md` > `CLAUDE.md` > `.hip/MEMORY.md`（与现测试一致）

### 3.6 MCP / Skill 安装失败可读（B7）

| 失败类 | 用户文案方向 |
|--------|--------------|
| stdio 二进制不在 allowlist | 说明仅允许 `/usr/bin`、`/usr/local/bin`、`/opt`、`~/.hip/bin`；建议复制到 `~/.hip/bin` |
| 权限 / spawn 失败 | 显示 stderr 截断 + 检查可执行位 |
| zip skill 结构错误 | 缺少 SKILL.md 等 checklist |
| 网络 MCP | 连接超时 / TLS — 非 key 泄露 |

**UI：** 安装对话框内 inline error，不只 toast；可「复制错误详情」（可复用 A 脱敏思路）。

---

## 4. 任务拆分

| # | 任务 | 依赖 |
|---|------|------|
| B.1 | write/edit 后 diff 刷新 + 防抖 | A 投影稳定 |
| B.2 | E2E 或集成：改文件 → Changes | B.1 |
| B.3 | Agents v2 状态/token/跳转 | A agentRuns 完整 |
| B.4 | Prompt/工具分层 | — |
| B.5 | AGENTS.md 已加载 chip | 现有 injector |
| B.6 | MCP/Skill 错误映射表 + UI | — |
| B.7 | 检查点恢复确认/文案 | 现有 checkpoint API |

---

## 5. 成功标准（Sprint B Done）

1. 文档化 e2e 或集成路径通过「改文件 → Changes 可见」  
2. Agents 面板能区分 running/done/error，有子代理时结构仍符合 D2  
3. Chat vs Code 系统提示或工具集有可测差异  
4. AGENTS.md 存在时用户能发现「已加载」  
5. 至少 3 类 MCP/Skill 失败有固定人话文案  
6. 无新编排模式 UI  

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| Diff 刷新过频 | 防抖 + 仅 write 类工具 |
| 动态工具 schema 复杂 | 先 L2 prompt；L1 可第二 PR |
| E2E 不稳 | mock tool 事件优先 |
