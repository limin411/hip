# 设计：外部智能体经 ACP 与 OpenCode 丝滑对接（通用 ACP，OpenCode 为首个实例）

- 日期：2026-06-15
- 状态：设计已定，待用户复核 → 进入实现计划
- 关联：取代/升级 [2026-06-14-external-agent-management-design.md](2026-06-14-external-agent-management-design.md) 中 OpenCode 经 `scripts/opencode-bridge.mjs` 的临时方案；与 [2026-06-13-gitpanel-checkpoints-artifacts-design.md](2026-06-13-gitpanel-checkpoints-artifacts-design.md) 的 per-turn checkpoint 复用同一持久化路径。

---

## 1. 背景与问题

hip 目前没有把 OpenCode 作为一等智能体，而是绕道：用户在「智能体管理」里手敲一个 `kind:'custom'` 的外部 CLI agent，命令 `node …/scripts/opencode-bridge.mjs --pure --rich`；sidecar 的 `LoopAgentProvider` **每个会话** spawn 一个 bridge 子进程，bridge **再** spawn 一个 `opencode serve`，用自造的 stdin/stdout JSON-lines 协议转译 SSE 事件。

由此产生的「不丝滑」根因（按影响排序）：

1. **进程按会话而非常驻** —— 每开一个 OpenCode 会话付一次 `opencode serve` 冷启动（`waitForListening` 最长 60s + 健康轮询），期间 UI 零反馈，且 `IdleWatchdog` 可能在 serve 启动完成前把这一轮误判为卡死。
2. **取消即丢上下文** —— abort 是进程级（SIGINT bridge → SIGKILL serve → OpenCode session id 丢失），下一轮全忘。
3. **三跳 + 自造协议脆弱** —— hip↔bridge 自造 sentinel/JSON-lines，bridge↔serve HTTP+SSE，`serve --print-logs` 的日志还和 bridge 抢同一条 stdout。
4. **多智能体 / 结构化事件被压扁** —— 全挂在写死的 `agentId:'supervisor'` 下；serve 崩溃只当普通正文。
5. **完全没接 HITL** —— OpenCode 的权限系统会阻塞工具直到回复，hip 对外部 agent 没有 `awaiting_user` 通路（`session.ts:717` 注释明确：“No awaiting_user path — external agents don't surface the graph's HITL pause.”）。
6. **可发现性差 + 鉴权割裂** —— 用户手敲绝对路径；OpenCode 用自己的 `opencode auth login`，与 hip 的 `~/.hip/config/auth.json` 互不相通。

**目标**：把 OpenCode 升级为常驻、可发现、可下发任务的一等智能体，且抽象保持通用，未来「加条配置」即可接入其它 ACP 编码智能体。

---

## 2. 已锁定的决策

| # | 决策 | 选择 |
|---|---|---|
| D1 | 协议路线 | **ACP**（Agent Client Protocol，编辑器/客户端标准协议），而非 `opencode serve`+HTTP/SDK 或 `opencode run` |
| D2 | 适配器落点 | **Node sidecar**（替换 `agents/index.ts:14` 的 Plan-B throw），而非 Rust 层 |
| D3 | 鉴权归属 | **两种模式都支持**：Mode A = hip 下发模型+密钥；Mode B = OpenCode 自管（`opencode auth login`） |
| D4 | 权限处理 | **接到 hip 交互弹窗**（HITL），而非默认自动放行 |
| D5 | 多-agent 抽象范围 | **通用 `AcpAgentProvider` + 注册表/quirks 档**，本轮**仅接 OpenCode 一个实例** |
| D6 | 非编码（常规）agent | **只靠现有 `AgentProvider` 座位预留**，本 spec 不写非 ACP 的具体实现 |

落点为 Node 的决定性事实：hip 的整个会话架构（单条 Node 独占的 SQLite WAL 连接、`SessionStore` 全部手写 SQL、`Session` turn 模型、单条 WS `ServerMessage` 流）都在 Node；Rust 当前对会话/DB 零认知、不向 webview emit 任何事件。放 Rust 需重写持久化+turn 模型+发明一套 Tauri→webview 事件传输，零功能收益。放 Node 复用以上全部，且接缝已预切。

---

## 3. Spike 验证结论（证据）

一次性 spike（`@agentclientprotocol/sdk` 0.25.1 驱动真实 `opencode acp` 1.17.7，DeepSeek 廉价模型）验证了全部高风险假设：

| 验证点 | 结果 | 备注 |
|---|---|---|
| 一进程多 session | ✅ | sessionA/sessionB 同一 child PID。冷启动根治；走「常驻连接 + 多 session 多路复用」 |
| 文本流式 | ✅ | `agent_message_chunk` |
| 推理与正文分离 | ✅ | `agent_thought_chunk`（独立）+ `agent_message_chunk` |
| 实时换模型**真切后端**（疑似 #157312） | ✅ | 切到 `kimi-k2-thinking` 后模型自报「Kimi K2」。可放心做组合框换模型 |
| HITL 权限往返 | ✅ | `request_permission` 带选项 `[allow_once / allow_always / reject_once]`，批准后工具执行、文件生成 |
| resume/load 回放历史 | ✅ | 重启进程后 `loadSession` 回放更新；`agentCapabilities` 含 `loadSession` 及 `sessionCapabilities:{close,fork,list,resume}` |
| `OPENCODE_CONFIG` 文件注入 | ✅ | Mode A 注入路径有效（默认 model 被采纳） |
| `session/cancel` | ⚠️ | **功能可用**（turn 在 ~25ms 内停止、可立即 steer 重发同会话），**但 OpenCode 1.17.7 返回 `stopReason:end_turn` 而非 spec 的 `cancelled`** |

两个 spike 现场发现的坑（必须在设计中规避）：

- **G1：不设模型时 OpenCode 默认用 `opencode/big-pickle`**（其自家托管模型，可能计费）。⇒ Mode A **必须显式下发 model**，否则用户以为在用 DeepSeek 实际走了 big-pickle。
- **G2：`authMethods` advertise 了 `opencode-login`，但只要 provider 已授权（auth.json），`newSession` 无需先 `authenticate`**。⇒ 仅在 `newSession` 抛 `auth_required` 时才调 `authenticate`。
- **G3：`OPENCODE_CONFIG_CONTENT`（内联 JSON）不做 `{env:}`/`{file:}` 变量替换（opencode #13219）。** ⇒ Mode A 用 `OPENCODE_CONFIG` 指向写到 scratch 的文件，而非内联 env。

spike 脚本与原始日志保留在 `/tmp/hip-acp-spike/`（仓库外，throwaway）。

---

## 4. 架构总览

```
┌─────────────────────────── React renderer (webview) ───────────────────────────┐
│  对话标签 ── Transport.onMessage（单例 wsClient，流不变）── HITL 权限弹窗（新增）   │
│  组合框：model / mode 选择器（来自 ACP configOptions，新增）                       │
└──────────────▲──────────────────────────────────────────────┬───────────────────┘
               │ ServerMessage（WS，流式合约不变）              │ ClientMessage
               │ + 新增 permission:request / agent:configOptions │ + 新增 permission:respond / agent:setConfigOption
┌──────────────┴──────────────────────────────────────────────▼───────────────────┐
│  NODE SIDECAR                                                                      │
│  WsServer → SessionManager → Session.runTurn（编排不变）                            │
│     isExternalAgent() → ensureExternalProvider().runTurn(text, emit, signal)       │
│        │                                                                            │
│        ▼ 新增 AcpAgentProvider implements AgentProvider（通用，OpenCode 为首实例）   │
│          ├─ AcpConnection：每个 agent 配置一个常驻 `opencode acp` 子进程（warm）     │
│          │     @agentclientprotocol/sdk: ndJsonStream + ClientSideConnection        │
│          │     Map<hipSessionId, acpSessionId>，多对话多路复用一个进程               │
│          ├─ initialize 一次 → (按需) authenticate → newSession / loadSession 每对话  │
│          ├─ session/update → emit.token / reasoning / toolStarted / toolFinished    │
│          ├─ requestPermission → 新增异步权限回调（→ HITL）                           │
│          ├─ configOptions(model/mode) → 新增上报；setSessionConfigOption ← UI 设置   │
│          └─ signal.abort → conn.cancel；按 hip 自身 abort 标志收尾（不信 stopReason）│
│  Session.finalizeAndPersist → store.insertTurn → hip.db（不变，同一行形状，零新 SQL）│
│  + 新增：持久化 acpSessionId（按对话），重开走 loadSession                            │
└────────────────────────────────────────────────────────────────────────────────────┘
        ▲ 仅注入 env（HIP_MODEL_*_API_KEY、各路径）；Rust 不变，不 emit 任何事件
┌───────┴──────┐
│  RUST / Tauri │  spawn sidecar、注入 env、get/set_agents_config、secret、catalog
└──────────────┘
```

事件平面保持单条 WS 流；ACP 完全封装在 provider 内部，**renderer 永不直接见到 ACP**。新增的只有 HITL 与 configOptions 这两组消息类型。

---

## 5. 通用 `AcpAgentProvider` + 注册表 / quirks（D5）

### 5.1 Provider（通用，agent 无关）
- 文件：`packages/sidecar/src/session/agents/acp-provider.ts`（新）。
- `class AcpAgentProvider implements AgentProvider`（接口见 `loop-provider.ts:11`：`runTurn(text, emit, signal)` + `dispose()`，本轮**扩展**一个异步权限回调，见 §7）。
- 用 `@agentclientprotocol/sdk`（pin `0.25.x`）。`ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))` + `new ClientSideConnection(() => clientImpl, stream)`。
- agent 无关：spawn 命令/参数/env、quirks 全部来自传入的 agent 定义；spike 证明换成任何 `xxx acp` 命令同样可跑。

### 5.2 注册表条目形状
现有注册表来自 `~/.hip/config/hip-agents.json`（`registry.ts:readAgentsConfig`，Rust 经 `lib.rs:get/set_agents_config` 读写）。新增 `kind:'acp'`：

```jsonc
{
  "id": "opencode",
  "kind": "acp",                 // 'builtin' | 'custom' | 'acp'
  "displayName": "OpenCode",
  "command": "opencode",
  "args": ["acp", "--pure"],
  "authMode": "opencode-self" ,  // 'hip-managed' | 'opencode-self'（见 §8）
  "boundModel": null,            // Mode A 必填（G1）；Mode B 可空，由 ACP configOptions 提供
  "quirks": "opencode"           // quirks 档键（见 5.3）
}
```

`createAgentProvider`（`agents/index.ts`）：把 `case 'opencode': throw …`（line 14）替换为 `case 'acp': return new AcpAgentProvider(agent, cwd, model)`。**保留 `kind:'custom'` 走 `LoopAgentProvider` 不动**（向后兼容旧的 bridge 配置）。

### 5.3 per-agent quirks 档
`packages/sidecar/src/session/agents/acp-quirks.ts`（新）：把 agent 特异行为隔离出核心：

```ts
type AcpQuirks = {
  cancelReportsEndTurn?: boolean;   // OpenCode: true（§9）
  defaultModelIsBilled?: boolean;   // OpenCode: true（G1，强制 Mode A 设 model）
  apiKeyEnvVar?: (providerId: string) => string; // 注入 key 时的环境变量名
};
const QUIRKS: Record<string, AcpQuirks> = { opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true, /* … */ } };
```

未来加 Claude Code / Gemini / Codex = 加一条注册表记录 + 一个 quirks 档（多半还要像本次一样跑个小 spike 摸 quirks），核心管线零改动。**本轮只填 `opencode`。**

---

## 6. 事件映射（ACP `session/update` → hip `emit`）

`emit`（`session.ts` 的 `makeEmit`）已覆盖 token/reasoning/tool/usage，1:1 映射：

| ACP `sessionUpdate` | → hip | 说明 |
|---|---|---|
| `agent_message_chunk` | `emit.token(delta)` | 正文 → `token:stream` |
| `agent_thought_chunk` | `emit.reasoning(delta)` | 推理 → `reasoning:delta`（thinking 面板） |
| `tool_call` | `emit.toolStarted(name, callId, input)` | 工具卡片（pending/in_progress） |
| `tool_call_update` | `emit.toolFinished(callId, status, output, error)` | 状态机 completed→finished / failed→error；中间态更新工具卡 |
| `usage_update` | `emit.usage(u)` | token/费用累计 |
| `plan` / `plan_update` | （MVP）渲染为一张 plan/tool 卡 | 详细呈现可后续细化（见 §16） |
| `user_message_chunk` | 仅 `loadSession` 回放时用于重建 transcript | 实时回合中忽略（避免回显） |
| `current_mode_update` / `config_option_update` | 刷新 §10 的选择器 | 携带完整 configOptions 数组 |
| `available_commands_update` | （MVP）忽略 | 斜杠命令面板，后续 |
| `stopReason`（prompt 返回） | 解析回合结束 | `end_turn` 正常收尾；取消见 §9 |

回合结束后照旧 `Session.finalizeAndPersist → store.insertTurn`，落 `hip.db` 的 `messages`/`agent_runs`/`tool_calls`/`checkpoints`，**零新 SQL**，renderer 流式 UI 无需改动。

---

## 7. HITL 设计（唯一结构性新增，D4）

ACP 的 `requestPermission` 是 **agent→client 的反向阻塞请求**：工具执行被阻塞，直到 client 回 `{outcome:{outcome:'selected', optionId}}` 或 `{outcome:{outcome:'cancelled'}}`。

需要三处新增（落点无关，无论 Rust/Node 都要做；Node 方案下这是唯一结构性新增）：

1. **扩展 `AgentProvider` 契约**：当前 `emit` 是只出不进的。加一个异步权限回调通路（provider 在收到 ACP `requestPermission` 时挂起一个 pending Promise，等 client 回复后 resolve）。建议把权限请求/回复做成 provider 持有的 `Map<requestId, Deferred>`。
2. **协议层新增消息**（`packages/protocol/src/index.ts`，紧邻 `agent:interrupt`（line 252）/ `message:resume`（line 215）；**不复用** `message:resume`，因其仅在内建 graph 的 `awaitingResume` 时被认）：
   - `ServerMessage`：`{ type:'permission:request', sessionId, turnId, requestId, tool:{ title, kind, diff?, content? }, options:[{ optionId, name, kind }] }`
   - `ClientMessage`：`{ type:'permission:respond', sessionId, requestId, optionId | cancelled:true }`
3. **SessionManager 路由**：把 `permission:respond` 路由到对应 Session 的 provider 的 pending 请求；abort 时所有 pending 回 `cancelled`。

UX：弹窗按 `options` 渲染按钮，按 `kind` 分组（`allow_once`→「允许一次」、`allow_always`→「总是允许（本会话记住）」、`reject_once`→「拒绝」），展示工具名 + diff/命令。

---

## 8. 鉴权两模式（D3，@spawn 时确定）

ACP 的「选哪些模型 + API key」是 **agent 侧启动时配的**；「在已配模型间实时切换」可经协议（§10）。所以两模式只在 spawn 时注入的 env/config 不同：

**Mode A — hip 下发（headless，全控）**
- sidecar 已有 key（Rust 注入的 `HIP_MODEL_<ID>_API_KEY`；`resolveAgentModel`/`buildModelEnv` 可复用）。
- spawn `opencode acp` 时：写一份 per-launch `opencode.json` 到 scratch（`HIP_SCRATCH_ROOT`），`OPENCODE_CONFIG=<该文件>`，内含 `provider.<id>.options.apiKey:"{env:VAR}"` + `model:"provider/model"`，并把真实 key 经 `env[VAR]` 传入。**避开 `OPENCODE_CONFIG_CONTENT`（G3）。**
- **必须设 `model`（G1）**，否则回退 `opencode/big-pickle`。`boundModel` 在 Mode A 为必填。

**Mode B — OpenCode 自管**
- 不注入任何 key 相关。OpenCode 读自己的 `~/.local/share/opencode/auth.json`。
- hip 不设 model（或仅给个默认）；模型列表由 ACP `configOptions` 实时读出供选择。

**鉴权握手（G2）**：`newSession` 正常即可；仅当其抛 `auth_required` 时，按 `initialize` 返回的 `authMethods` 调 `authenticate`。

**可发现性**（产品）：「智能体管理」里 OpenCode 作为内建类型出现，开关启用 + 选 Mode A/B 即可，不再手敲绝对路径；检测不到 `opencode` 二进制时给安装提示。

---

## 9. 取消 / Steer（§3 的 ⚠️）

- `signal.abort`（hip 现有 `AbortController`）→ provider 调 `conn.cancel(acpSessionId)`。
- **不依赖 `stopReason==='cancelled'` 判定取消**（OpenCode 1.17.7 返回 `end_turn`）。以 hip 自身的 abort 标志判定，走现有的 `AbortError → finalize-as-stopped` 路径。`quirks.cancelReportsEndTurn` 记录此行为。
- Steer = cancel + 立即对**同一** acpSession 再 `prompt`（上下文保留，spike 已验「STEERED」）。

---

## 10. 模型 / 模式选择器（产品增益）

- `newSession`/`loadSession` 返回 `configOptions:[{ id, category:'model'|'mode'|'thought_level', currentValue, options }]`。
- 新增 `ServerMessage agent:configOptions`（上报当前可选项）+ `ClientMessage agent:setConfigOption`（`{ sessionId, configId, value }` → provider 调 `setSessionConfigOption`，可空闲或回合中调用）。
- UI：组合框工具条渲染 model 选择器（+ mode：build/plan 等），按 `category` 配图标。spike 已证换模型真切后端。

---

## 11. 持久化与重开会话

- 回合持久化复用现有路径（§6），零新 SQL。
- 新增存 **acpSessionId**（按 hip 对话）：在 `sessions` 表加列或建侧表（实现计划定）。
- 重开：provider 对存下的 acpSessionId 调 `loadSession`（capability-gated，spike 证 OpenCode 支持），回放 `user_message_chunk`/`agent_message_chunk`/`agent_thought_chunk` 重建 transcript；agent 不支持回放时，回退到 hip 自存的 transcript 并标记「仅元数据」。
- **hip 自存 transcript 始终是事实源**，ACP 回放只用于重连活的 ACP 会话。

---

## 12. 进程 / 连接生命周期

- **一个 agent 配置 = 一个常驻 `opencode acp` 子进程（`AcpConnection`）**，`Map<hipSessionId, acpSessionId>` 多路复用（参照 Zed：one `child`, `HashMap<SessionId>`）。
- `Session.destroy()/dispose()`（`session.ts`）+ `AbortSignal` 取消已接好；provider `dispose()` 关连接 / `child.kill()`。
- **连接故障 fan-out**：进程退出 → 把结构化错误推给该连接上所有会话（共命运），surfaces 成 `error` 而非纯文本。
- 复用 hip 现有 `IdleWatchdog` 做工具/流的不活动超时（缓解无自动重连导致的工具卡死）。

---

## 13. 构建切片（spike 后全部低风险）

1. **ACP 传输 + 握手 + 替换 Plan-B + 常驻多路复用连接**：`AcpAgentProvider` 骨架（spawn `opencode acp`、`ndJsonStream`+`ClientSideConnection`、`initialize` v1、按需 `authenticate`、`newSession`、`Map<sessionId>`、`dispose`/`child.kill`、故障 fan-out）。替换 `agents/index.ts:14`，新增 `kind:'acp'` + quirks 档（仅 `opencode`）。
2. **流式映射 + 自标志取消**：`session/update`→`emit.*`（§6 表），`stopReason` 收尾；`cancel` 走 §9。复用 `IdleWatchdog`。renderer 无需改。
3. **两种鉴权 @spawn + 一等可发现**：`authMode` 开关；Mode A 写 `OPENCODE_CONFIG` 文件注入 + 强制设 model（G1/G3），Mode B 干净启动（G2）；Settings「智能体管理」把 OpenCode 做成内建可启用项 + 二进制检测/安装提示。
4. **实时 model/mode 选择器**：`agent:configOptions` / `agent:setConfigOption` 两消息 + 组合框 UI；集成测试验「换模型真切后端」。
5. **HITL**：`permission:request`/`permission:respond` 两消息 + `AgentProvider` 权限回调 + SessionManager 路由 + 弹窗。
6. **acpSessionId 持久化 + 重开/resume**：建表/列；重开 `loadSession`；不可回放标「仅元数据」。

切片 1–2 即可让「常驻、流式、可下发任务」端到端跑通（最大丝滑收益）；3–6 补齐鉴权、换模型、HITL、重开。

---

## 14. 协议 / 接口变更清单

- `packages/protocol/src/index.ts`：`ServerMessage` 加 `permission:request`、`agent:configOptions`；`ClientMessage` 加 `permission:respond`、`agent:setConfigOption`。
- `packages/sidecar/src/session/agents/loop-provider.ts`（或抽到 `types.ts`）：`AgentProvider` 加异步权限回调通路。
- `packages/sidecar/src/session/agents/index.ts`：`'opencode' throw` → `case 'acp'`。
- 新文件：`acp-provider.ts`、`acp-quirks.ts`。
- `~/.hip/config/hip-agents.json` 形状扩展（`kind:'acp'`/`authMode`/`quirks`）；`agentsStore.ts` + 「智能体管理」UI + `AgentPicker.tsx` 跟随。
- 持久化：`persistence/schema.ts`（acpSessionId 列/侧表）、`store.ts` 读写。
- `src-tauri`：基本不变（仅可能为 Mode A 的 key→env 注入复用现有 `sidecar.rs` env 通道）。

---

## 15. 风险 / 遗留

| 级别 | 项 | 处置 |
|---|---|---|
| 低 | 并发多会话同时 prompt 的事件交织 | spike 是顺序的；Node 单线程 + 按 sessionId 路由应可，落地时验证无 head-of-line 阻塞 |
| 低 | `plan`/`available_commands`/`usage` 的精细呈现 | MVP 简化（plan→卡片，commands 忽略，usage→既有 usage 累计）；后续细化 |
| 低 | SDK(0.25.x)/opencode(1.17.x) 版本偏移 | 两者都 pin；CI/启动 smoke；pre-1.0 API 会动，升级时跟随 |
| 低 | 无自动重连/replay buffer | `IdleWatchdog` 超时 + 故障 fan-out + 重开 `loadSession` 重建；不追求 turn 内自动续传 |
| 信息 | OpenCode 取消返回 `end_turn` | 已设计绕过（§9）；可向上游提 issue |

---

## 16. 范围外（YAGNI）

- 本轮**不**实现 OpenCode 之外的任何 ACP agent（仅把抽象做成通用 + quirks 可扩展）。
- 本轮**不**写非 ACP/HTTP 的 provider；非编码「常规智能体」仅靠 `AgentProvider` 座位与通用 HITL 回调预留（D6）。
- 不做斜杠命令面板、terminal 能力、图片/音频 prompt、session fork/list/close 的 UI（capability 已知存在，留待后续）。
- 不退役 Node sidecar，不动 Rust 的会话职责。

---

## 17. 验收

- 自动化（paid-free 优先）：provider 单测 + 用 mock ACP server 的集成测试覆盖 §6 映射、§7 HITL 往返、§9 取消、§11 重开。
- 手动 `yarn tauri dev`（真实 reasoning 模型；手动 GUI 验收优先于真实 LLM 自动化测试）：确认 thinking 流出、回合中取消有效、HITL 弹窗往返、换模型真切后端、重开回放、Mode A/B 都能跑通。
- 一个关键集成测试：换模型后**后端真的切换**（防 #157312 回归）。
