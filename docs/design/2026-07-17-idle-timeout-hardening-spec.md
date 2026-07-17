# Idle Timeout Hardening — Spec

| Field | Value |
|-------|-------|
| **Title** | Idle timeout hardening: tool-call stream activity + configurable idle + large-file edit strategy |
| **Date** | 2026-07-17 |
| **Status** | Spec — implementing |
| **Trigger** | Debug session `QkJNZbjtgvyJ9WnsZT78i` — SVG rewrite timed out with `Idle timeout after 60000ms with no outbound activity` while model produced ~8k output tokens without finishing a write tool |
| **Plan** | [`2026-07-17-idle-timeout-hardening-plan.md`](./2026-07-17-idle-timeout-hardening-plan.md) |

---

## §0 一页纸

**问题：** Idle watchdog 只在 **outbound**（`token:stream` / `tool:started` / tool `onActivity`）时 kick。模型流式生成大 tool-call 参数（如整份 SVG 的 `write_file`）时通常 **没有 text delta**，60s 静默会被误判为 stall 并 abort，任务失败。

**目标：**

1. **Tool-call 流式续命：** 模型 chunk 含 tool_call 进度时 kick idle watchdog。
2. **可配置 idle：** `hip.toml` / 环境变量可覆盖；code surface 默认更宽。
3. **大文件读截断更可操作：** 截断 marker 引导 `offset`/`limit` 与 `edit_file`。
4. **大改策略引导：** system prompt + tool 描述优先分段 `edit_file`，避免单次超大 `write_file`。

**成功标准：** 见 §3。不做 wall-clock 总时长上限改造、不做 provider 侧 streaming 协议变更。

---

## §1 范围与原则

| ID | 原则 |
|----|------|
| P1 | Idle 仍是 **无进展探测**，不是 turn 总时长 cap |
| P2 | 任何「模型或工具仍在推进」的信号都应 kick（text / reasoning / tool_call stream / tool run） |
| P3 | 配置可选；缺省行为对 chat 保持敏感、对 code 更宽容 |
| P4 | 引导策略用最小 prompt/tool 文案，不引入新工具 |
| P5 | 纯逻辑 + model-runner / session 单测；必要时 harness 级验证 |

---

## §2 需求

### 2.1 Tool-call stream activity（P0）

| 项 | 说明 |
|----|------|
| 检测 | `AIMessageChunk` 含 `tool_call_chunks`（非空）或已有 `tool_calls` 进度 |
| 行为 | 调用 `ModelRunOptions.onActivity?.()`（与 text 同等「有进展」） |
| 接线 | `graph.runModel` 传 `onActivity: () => emit.activity?.()`；turn-runner 已有 `activity → watchdog.kick` |
| Retry | 已出现 tool-call 活动后 **不再** 按 pre-stream 重试（与 text 一致，避免重复） |
| 非目标 | 不向 UI 新推 `tool:args_delta` 协议（可后续）；本次仅 keepalive |

### 2.2 Configurable idle timeout（P0）

| 来源 | 优先级（高→低） |
|------|----------------|
| env `HIP_IDLE_TIMEOUT_MS` | 1 |
| `hip.toml` → `agent_loop.idle_timeout_ms` / `agentLoop.idleTimeoutMs` | 2 |
| surface 默认 | 3：`code` → **180_000**；其它 → **60_000** |

约束：

- 解析后 clamp：`[5_000, 1_800_000]`（5s–30min）
- `SessionManager` 创建/resume Session 时注入 resolved 值
- 导出 `resolveIdleTimeoutMs` + 常量，单测覆盖优先级与 clamp

### 2.3 Large-file / SVG read truncation UX（P1）

| 项 | 说明 |
|----|------|
| ToolOutputStore marker | 明确：行数/字节、完整路径、建议 `read_file(path, offset, limit)`、建议局部 `edit_file` |
| 默认预算 | `DEFAULT_MAX_BYTES` 50KB → **100KB**（降低密集单文件 SVG/HTML 被截断概率） |
| `read_file` 描述 | 强调大文件必用 offset/limit；截断后勿整文件 rewrite |
| UI trajectory `clip(4096)` | **不改**（仅影响展示/导出，不改模型上下文） |

### 2.4 Large-file edit strategy guidance（P1）

| 位置 | 文案要点 |
|------|----------|
| `BASE` system prompt（code） | 局部改动优先 `edit_file`；避免一次 `write_file` 塞入数千行；大 rewrite 分段；read 被截断时先分段读 |
| `write_file` / `edit_file` description | 同上简版 |
| child / chat BASE | 不强制加长 chat；child 可加一句 prefer edit_file for localized edits |

---

## §3 验收

| ID | 验收 |
|----|------|
| A1 | model-runner：仅 tool_call_chunks 的 stream 会触发 `onActivity`，且不触发 timeout 类假 stall（unit） |
| A2 | 真 stall（无 text/reasoning/tool_call/tool）仍在 idle 窗口后 `TIMEOUT`（既有 session-unit 保持） |
| A3 | `resolveIdleTimeoutMs` 优先级与 clamp 单测通过 |
| A4 | SessionManager 创建 session 使用 resolved idle（unit 或 manager 级） |
| A5 | ToolOutputStore 截断 marker 含 offset/limit 与 edit 引导；maxBytes 默认 100KB |
| A6 | system-prompt / tools 测试断言关键引导文案存在 |
| A7 | 相关 vitest 全绿；过程中 git commit 分阶段落地 |

---

## §4 非目标

- 不引入 wall-clock max turn duration
- 不改协议加 `tool:args_delta` UI（后续可选）
- 不自动把 `write_file` 改成流式落盘
- 不修改用户 auth / keychain 行为
- 不把 60s 默认全局改为无限

---

## §5 风险

| 风险 | 缓解 |
|------|------|
| tool_call chunk 形态因 provider 不同 | 检测 `tool_call_chunks` + `tool_calls`；DSML 文本路径已有 text kick |
| code 默认 180s 掩盖真卡死 | 仍为 idle 非 wall；真无进展 180s 仍 abort；可配 |
| prompt 变长 | 仅 code BASE 增加少量句子 |
| maxBytes 放大上下文 | 100KB 仍 bound；超限仍 head+tail |
