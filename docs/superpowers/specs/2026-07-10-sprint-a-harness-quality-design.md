# Sprint A — Harness 质量门槛（主循环 · 委派 · 调试）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **草案 / 待实现** |
| 路线图 | [`2026-07-10-pre-public-roadmap-index.md`](./2026-07-10-pre-public-roadmap-index.md) |
| 前置 | agent-driven orchestration 已落地；workflow cancel partial 已修 |
| 代码锚点（预期） | `session-turn-runner.ts`、`session-persist.ts`、`graph.ts`、`subagent.ts`、`tool-runner/`、`doom-loop.ts`、`sessionService` / UI 调试导出 |

---

## 1. 问题陈述

公开前最大风险不是「少功能」，而是：

1. **Cancel / 异常后聊天区空白或状态撒谎**（主循环路径与 workflow 路径行为不一致）  
2. **简单任务仍可能乱委派**（仅靠 prompt，无回归锁）  
3. **熔断过窄**（相同 batch + `.git/objects` 挡不住「换 path 狂扫」）  
4. **出问题无法自助打包现场**（无客服时无法复现）

实测会话曾暴露：cancel 空回复、66 次工具空转、投影与 event 不一致。Sprint A 把这些收成 **可测的质量门槛**。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| A1 | **任意 turn 路径**（supervisor 主循环、task 子 agent、显式 pending workflow）在 cancel/timeout/error 后：UI 有 assistant 消息，`stopped` 语义正确，trajectory/agentRuns 尽量完整 |
| A2 | **黄金委派用例**（假 LLM）锁定：简单 0 task；实现类可委派；空子 agent 输出不得当成功交付 |
| A3 | **LoopGuard v2**：重复 tool+args、同 path 重复读、连续 tool error → 强制收束提示 |
| A4 | **权限矩阵单测**：chat/edit/full × 主循环 / task 子 agent 的工具与 HITL 行为一致 |
| A5 | **复制调试信息**：一键导出脱敏 session 包（config 无 key、messages、runs、最近 error） |

### Non-Goals

- N1 Code Changes/e2e 全闭环（→ Sprint B）  
- N2 Agents 面板 UI 大改（→ Sprint B；本阶段只保证数据正确）  
- N3 删除 orchMode/workflow 协议（→ Sprint C）  
- N4 真实付费 LLM 评测必过（假 LLM 为主；真实 LLM 可选手动）  

---

## 3. 设计

### 3.1 统一 Cancel / 失败投影（A1）

**原则：** 任何结束 turn 的出口最终都走同一类 finalize：

```
finalizeTurn({
  text: bestEffortText,   // trajectory 汇总或已有 streaming 文本
  trajectory,
  stopped: boolean,       // cancel/timeout → true
  errorCode?: string,
})
```

| 路径 | 现状（实现时核对） | 目标 |
|------|-------------------|------|
| StateGraph 主循环 + Session.cancel | 需审计 | abort 后 partial + stopped |
| task / runSubagent | 部分返回 partial | 父 trajectory 必含子 run；父 finalize 不丢 |
| runWorkflowTurn | 已 finalize partial | 保持；与主路径文案一致（`(cancelled)` / 超时） |

**验收：**

- 单测：mock 长工具调用中 abort → `message:complete` 且 `content.length > 0` 或明确 stopped note；`stopped: true`  
- 不出现「user 消息后永无 assistant」  

**文案（i18n）：**

- 取消：`（已取消）` / `(cancelled)` 可附在 partial 后  
- 超时：`（已超时）` / `(timed out)`  

### 3.2 Event / messages 投影一致性（A1 子集）

**最小范围（A 不做大重构）：**

1. 定义 **UI 读路径**：会话历史以 `messages`（+ 前端 apply 的 live 流）为准  
2. 每次 finalize 必须：  
   - 写 `messages` 行（assistant）  
   - 写/更新 `agent_runs` + `tool_calls`  
   - 写 event 的 `text_ended` + `step_ended`（与现 `finalizeAndPersistTurn` 对齐）  
3. 子 agent 工具若只进 trajectory：finalize 时 **必须 flatten 进 message.toolCalls / timeline**

**不做（留给 C）：** 删 `session_message` 双写、改 event schema。

**验收：** 集成测「一轮 tool + cancel」后，reload session 仍见 assistant + 至少一个 tool 痕迹（若已执行）。

### 3.3 黄金委派用例（A2）

**位置建议：** `packages/sidecar/src/session/harness/` 或现有 `*.test.ts` 旁：

| Case ID | 用户输入特征 | 假模型行为 | 断言 |
|---------|--------------|------------|------|
| H-simple-hi | `hi` | 仅文本 | 0× `task`/`dispatch_agent` |
| H-simple-ls | 列目录 | 1× `ls` + 文本 | 0× task |
| H-impl-hint | 「实现/添加/修改 …」 | 可 `task` 或自做 | 若 task，子 agent 非空输出才算成功路径 |
| H-empty-child | 父委派后子返回 `""` | — | 父不得把空串当最终成功答案；应 fail 提示或父自救 |

**实现手法：** 固定 `ModelRunner` 序列（第 1 步 tool_calls / 第 2 步 text），不访问真实 API。

**Profile：** 新增用例优先 `dispatch_agent({ agent: 'coder'|'explore'|'plan' })`；默认 `task` 仍可用但文档写明将迁移。

### 3.4 LoopGuard v2（A3）

在现有 `doom-loop.ts`（相同 batch N 次）之上扩展：

| 规则 | 信号 | 动作 |
|------|------|------|
| R1 | 已有：相同 tool batch 连续 ≥ `DOOM_LOOP_N` | nudge → 再犯 pause（保持） |
| R2 | 同一 `name` + 规范化 `path`/`pattern` 累计 ≥ 3（即使 args 其它字段不同） | ToolMessage 错误 + 计数进 recentSigs |
| R3 | 连续 ≥ 3 次 tool 结果以 `Error:` 开头 | SystemMessage 强制「停止工具，文字总结」 |
| R4 | 已有：`.git/objects` | 保持 |

**规范化 path：** 去掉 cwd 前缀、统一 `/`、小写盘符（若需要）。

**验收：** 单测构造 3 次不同 seq 的 `read_file` 同 path → 第三次被拒或触发 nudge。

### 3.5 权限矩阵（A4）

表格（单测驱动，不跑真实 shell）：

| permissionMode | 主循环 write_file | 主循环 run_script | task 子 agent write | task 子 agent run_script |
|----------------|-------------------|-------------------|---------------------|--------------------------|
| chat | 不可用/拒绝 | 不可用 | 不可用 | 不可用 |
| edit | 可用 | HITL 或策略一致 | 继承 | 继承 HITL 接口 |
| full | 可用 | 自动 | 继承 full | 自动 |

**禁止：** 任何路径写死 `permissionMode: 'full'`（workflow-runner 已修；扫 `runSubagent` 调用点）。

### 3.6 复制调试信息（A5）

**产品：**

- 入口：会话菜单 / 命令面板 / 错误 toast 旁 — **「复制调试信息」**  
- 输出：剪贴板 JSON 或下载 `.json`（二选一，推荐剪贴板 + 可选下载）

**Payload schema（建议）：**

```ts
type SessionDebugBundle = {
  version: 1
  exportedAt: string // ISO
  appVersion?: string
  session: {
    id: string
    title: string
    surface?: string
    cwd?: string
    // config 脱敏：无 api keys；保留 model/provider/permissionMode/orchMode
    config: Record<string, unknown>
  }
  messages: Array<{
    id: string
    role: string
    content: string // 可截断至 4k/条
    agentId?: string
    stopped?: boolean
    toolCalls?: unknown[] // 截断 output
    agentRuns?: unknown[]
  }>
  recentErrors?: Array<{ code?: string; message: string; at?: number }>
  // 不含 auth.json、完整 event log 默认不含（体积）；可选 advanced 开关以后再做
}
```

**脱敏：**

- 删除/掩码：`apiKey`、`token`、`authorization`、环境变量值  
- 路径可保留（本地调试需要）；公开 issue 时用户自担  

**协议：** 优先前端聚合已有 store；若缺 runs，可 `session:get` / 已有 load 结果。**A 不强制新 sidecar RPC**，除非前端数据不足。

---

## 4. 任务拆分（实现时转 plan）

| # | 任务 | 验收 |
|---|------|------|
| A.1 | 审计主循环 cancel 出口，对齐 finalize | 单测 abort |
| A.2 | 子 agent 空输出 / 父投影 | 单测 H-empty-child |
| A.3 | LoopGuard R2/R3 | 单测 |
| A.4 | 权限矩阵单测 + 扫 full 硬编码 | 全绿 |
| A.5 | 黄金委派 H-simple-* | 全绿 |
| A.6 | 复制调试信息 UI + 脱敏 | 组件测 + 手工 |
| A.7 | 文档：plan 勾选 + 本 spec 状态更新 | — |

---

## 5. 成功标准（Sprint A Done）

1. CI 含 harness 黄金用例与 LoopGuard v2，默认不依赖付费 API  
2. 文档化「cancel 必有 assistant」；手动在 Code 会话 cancel 验证一次  
3. 权限矩阵测试通过；代码无新增 full 硬编码  
4. 用户可在 10 秒内复制一份脱敏调试 JSON  
5. **不**引入新用户可见编排开关  

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| finalize 改动回归 streaming | 保留现有 message:complete 形状；只补 stopped/partial |
| 假 LLM 用例过拟合 prompt 文案 | 断言 tool 名称与次数，不断言完整自然语言 |
| 调试包含隐私 | 默认截断 + 脱敏清单；README 一句警告 |
