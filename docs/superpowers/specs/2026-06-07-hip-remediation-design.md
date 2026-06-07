# hip 架构整改设计 (Remediation Design)

- **日期**: 2026-06-07
- **状态**: 已批准 (设计阶段)
- **来源**: 2026-06-07 全项目架构审查发现的 P0–P3 问题
- **目标**: 把"UI/架构骨架先行、后端运行时未补齐"的早期形态,推进到一个生产环境可真实运行、且兑现"多智能体"核心定位的状态。

---

## 1. 背景与问题

架构审查确认前端 + domain 层质量高(端口-适配器分层、纯函数 `applyServerMessage` reducer、单一 `@hip/protocol` 契约)。缺口集中在后端实现深度与生产化:

| 编号 | 问题 | 严重度 |
|------|------|--------|
| P0-1 | 生产构建下 sidecar 拿不到 API Key([sidecar.rs](../../../src-tauri/src/sidecar.rs) 不传 env;无设置 UI/安全存储) | 阻断 |
| P0-2 | 多智能体被 README/协议/UI 宣称,但 [session.ts](../../../packages/sidecar/src/session/session.ts) 只跑单 deepagents agent;`buildModel` 无视 `llmProvider` 永远用 DeepSeek | 阻断 |
| P1-3 | sidecar 生命周期泄漏:child 句柄被丢弃、stdout 停止 drain、无 kill/健康监测/重启 | 健壮性 |
| P1-4 | 无 WS 重连;`useConnectionStatus` 无 UI 消费方;坏帧 `JSON.parse` 无守卫 | 健壮性 |
| P1-5 | 单测打真实付费 API 且断言 LLM 输出;无 key 时 `yarn test` 直接失败 | 健壮性/CI |
| P2-6 | WS 服务无鉴权/无 Origin 校验;`tauri.conf.json` 设 `csp:null` | 安全 |
| P2-7 | 登录是 mock,`/app` 路由无守卫 | 安全 |
| P3-8 | 死代码:`stream.ts` 的 `tokenize`、过时 MockTransport 注释 | 卫生 |

## 2. 已锁定决策

1. **多智能体**:真正实现(Supervisor 协调 Planner/Coder/Reviewer)。
2. **密钥存储**:系统钥匙串(OS keychain)+ 设置界面录入。
3. **模型供应商**:仅 DeepSeek,清理协议/UI 中未实现的供应商。
4. **登录鉴权**:保留 mock 登录 + 加路由守卫;真实 OAuth 留作独立项目。
5. **调试**:全程允许使用真实 DeepSeek API 调试与验证。

## 3. 目标数据流(多智能体接入后)

```
InputBar → sessionService.sendMessage → domain store 乐观更新
  → Transport.send(message:send) → ws-client → ws(带鉴权 token)
  → sidecar WsServer(校验 token/Origin) → SessionManager → Session
  → deepagents 图: Supervisor --task--> [Planner | Coder | Reviewer]
  → streamEvents 按子 agent 元数据归属 token
  → 每个 agent 发 agent:started / token:stream / agent:finished
  → Supervisor 汇总后发 message:complete
  ← ws → ws-client.onMessage → applyServerMessage reducer
  → ChatPane(对话) + AgentDashboard(Supervisor + 并行子 agent 卡片)实时渲染
```

协议保持现有 `ServerMessage`/`ClientMessage` 形状不变——它已支持多 agent(`agentId` + `role`)。本次是让 sidecar 真正发出多个 agent 的事件流。

---

## 4. 工作流详述

### W1 — 真实多智能体编排(sidecar)【核心,最大】

**现状**:`Session` 创建单个 `createDeepAgent`,硬编码 `AGENT_ID='deepagent'`、`role='supervisor'`;流式用了非标准的 `streamEvents(..., {version:'v3'})` + `run.messages`/`msg.text`,需核对。

**方案 A1(已选):deepagents subagents + 流式事件归属**

1. **流式 API 校正(spike,先行)**:用真实 DeepSeek API 写一个最小脚本,确认 deepagents `^1.10` / `@langchain/langgraph ^1.3` 下正确的 token 流式 API(预期为 `streamEvents(input, {version:'v2'})` 监听 `on_chat_model_stream`,或 `stream(input, {streamMode:'messages'})`),以及子 agent 在事件元数据中的标识(`metadata.langgraph_node` / `checkpoint_ns` / run name/tags)。**此 spike 的结论写回本节**,作为后续实现依据。
2. **定义子 agent**:Planner/Coder/Reviewer,各自 role-specific system prompt(纯推理,不挂高危工具)。Supervisor 通过 deepagents 内置 `task` 工具委派。
3. **事件归属**:消费统一 `streamEvents` 流,根据子 agent 元数据,为每个被激活的子 agent 发 `agent:started`(携带正确 `role`)→ `token:stream`(token 归属到该 `agentId`)→ `agent:finished`;Supervisor 自身的输出归属到 supervisor agent。
4. **message:complete**:Supervisor 最终回复作为对话消息(domain store 现有逻辑:`token:stream` 中 `role==='supervisor'` 的 delta 才进对话气泡,子 agent 的进 Dashboard 卡片——已天然支持)。
5. **取消/错误**:沿用 `AbortController`;保证取消时所有"running"子 agent 收尾(发 `agent:finished` 或 `error`)。

**并行**:若 Supervisor 在一轮中并发委派多个子 agent,LangGraph 会并行执行;事件归属逻辑必须能处理交错的多 agent token 流(按 `agentId` 分流)。

**涉及文件**:`packages/sidecar/src/session/session.ts`(重写流式与事件发射);可能新增 `packages/sidecar/src/session/agents.ts`(子 agent 定义)。协议 [index.ts](../../../packages/protocol/src/index.ts) 形状不变。

**验收**:真实 DeepSeek API 下,一条需要规划+编码+审查的请求,能在 AgentDashboard 看到 Supervisor + 至少 2 个子 agent 卡片各自流式、状态从 running→done,对话区出现 Supervisor 汇总回复。

### W2 — 生产密钥管理【P0】

1. **Rust 命令**:用 `keyring` crate 暴露 `set_secret(key, value)` / `get_secret(key)` / `has_secret(key)`(service 名固定,如 `com.ljm.app`)。
2. **设置 UI**:[SettingsPanel](../../../src/components/account/SettingsPanel.tsx) 增加 "DeepSeek API Key" 录入项(密码框 + 保存/清除),通过 `invoke` 调上述命令;显示"已配置/未配置"状态,不回显明文。
3. **下发**:`spawn_sidecar` 时 Rust 从钥匙串读出 key,注入子进程 env `DEEPSEEK_API_KEY`;dev 模式保留 `.env`/继承 env 作为回退。
4. **Key 变更**:保存新 key → 调用 W3 的 `restart_sidecar`(重启 sidecar 以加载新 env;前端经 W3/W4 重连)。无 key 时:sidecar 正常启动,agent 调用返回清晰的 `error`(code `NO_API_KEY`),前端提示去设置页配置。

**涉及文件**:`src-tauri/src/sidecar.rs`、`src-tauri/src/lib.rs`(新命令)、`src-tauri/Cargo.toml`(加 `keyring`)、`SettingsPanel.tsx`、i18n。

### W3 — sidecar 生命周期与韧性【P1】

1. **句柄留存**:`CommandChild` 存入 Tauri state(`Mutex<Option<CommandChild>>`),应用退出(window destroy / `RunEvent::ExitRequested`)时 `.kill()`,避免僵尸进程。
2. **持续 drain**:端口发现后,在独立 async task 里继续消费 `rx`(stdout/stderr)→ 转发到日志文件/`logs/`,防止管道缓冲填满阻塞 sidecar,并保留运行期日志。
3. **退出检测**:监听 `CommandEvent::Terminated` → 清空 `SidecarPort` → (可选)发 Tauri event 通知前端。
4. **重启命令**:`restart_sidecar`(供 W2 key 变更与手动重试调用):kill 旧进程 → 重新 spawn → 更新端口/状态。

**涉及文件**:`src-tauri/src/sidecar.rs`、`src-tauri/src/lib.rs`。

### W4 — 连接状态 UX【P1】

1. 前端 [ws-client.ts](../../../src/ipc/ws-client.ts) 加**重连退避**(指数退避 + 上限),`onmessage` 的 `JSON.parse` 包 try/catch(坏帧丢弃并记日志)。
2. [WsTransport](../../../src/domain/wsTransport.ts)/domain store 暴露连接态(已有 `connection`),把 [`useConnectionStatus`](../../../src/domain/hooks.ts) 接到 [ChatHeader](../../../src/components/chat/ChatHeader.tsx) 上的**状态指示器**(标题旁的小圆点 + 文案):connecting/connected/error/disconnected,i18n 文案;error/disconnected 时给"重试"入口(可触发重连 / `restart_sidecar`)。
3. [AppLayout](../../../src/routes/AppLayout.tsx) 的 `connect()` effect 加 cleanup(避免 StrictMode 双连接副作用)。

**涉及文件**:`ws-client.ts`、`wsTransport.ts`、`hooks.ts`(消费)、`ChatHeader.tsx` 或新组件、i18n、`AppLayout.tsx`。

### W5 — WS 鉴权 + CSP【P2】

1. **一次性 token**:Rust 在 spawn 时生成随机 token,经 env/argv 传给 sidecar;`get_sidecar_port` 升级为 `get_sidecar_info` 返回 `{ port, token }`。
2. **校验**:sidecar [ws-server.ts](../../../packages/sidecar/src/server/ws-server.ts) 在握手时校验 token(query param 或首条 auth 帧)与 Origin,拒绝不合法连接。前端 [ws-client.ts](../../../src/ipc/ws-client.ts) 连接时带上 token。
3. **CSP**:[tauri.conf.json](../../../src-tauri/tauri.conf.json) 用合理 CSP 替换 `csp:null`(允许自身 + `ws://localhost:*` 连接,禁止外部脚本)。

**涉及文件**:`ws-server.ts`、`ws-client.ts`、`wsTransport.ts`、`src-tauri/src/{sidecar.rs,lib.rs}`、`tauri.conf.json`。

### W6 — 供应商收敛为 DeepSeek【决策 3】

1. 协议 [index.ts](../../../packages/protocol/src/index.ts):`SessionConfig.llmProvider` 收敛为 `'deepseek'`(移除 anthropic/openai/ollama);保留 `tools` 字段(未来用)。
2. [session.ts](../../../packages/sidecar/src/session/session.ts) `buildModel` 与之一致(DeepSeek baseURL)。
3. [InputBar](../../../src/components/chat/InputBar.tsx) 模型下拉:当前为无效占位(硬编码、不写入 SessionConfig)。**决定:移除该下拉,改为只读显示当前模型 `deepseek-chat`**,去掉 TODO 注释;不保留无效交互。(未来若支持多 DeepSeek 模型,再恢复为真正写入 SessionConfig 的下拉。)

### W7 — 登录路由守卫【决策 4】

1. 轻量 auth 状态(zustand + localStorage 持久化),mock 登录/skip 按钮设置该标志。
2. 守卫 `/app`([App.tsx](../../../src/App.tsx) 路由层或包一层 `<RequireAuth>`):未认证 → 重定向 `/login`。
3. UserMenu 退出登录清除标志。代码注释明确标记为"演示鉴权"。

**涉及文件**:`src/App.tsx`、新增 `routes/RequireAuth.tsx`、`LoginScreen.tsx`、`UserMenu.tsx`、一个 auth store。

### W8 — 测试策略与死代码【P1/P3】

1. **快速协议单测**:`Session` 注入 mock/fake chat model(如 LangChain `FakeListChatModel`),无网络覆盖:单 agent 与**多 agent**事件序列、token 归属、`cancel`、`error`(含 `NO_API_KEY`)。
2. **真实集成测试解耦**:现有 [session.test.ts](../../../packages/sidecar/src/session/session.test.ts) 改为 `describe.skipIf(!process.env.DEEPSEEK_API_KEY)`(顶层不再 `throw`),无 key 时 `yarn test` 通过。
3. **多智能体集成测试**(真实 LLM):验证多 role 事件流。
4. **死代码**:删 [stream.ts](../../../src/lib/stream.ts) `tokenize` + 其测试;清理 `sessionService.ts`/`wsTransport.ts` 中过时的 MockTransport 注释;`useConnectionStatus` 由 W4 消费(不再悬空)。

---

## 5. 阶段与依赖

```
Phase 1 地基:  W6 → W2 + W3   (生产可运行、配置干净、进程可控)
Phase 2 核心:  W1            (依赖 W2 提供的真实 key 来调试)
Phase 3 加固:  W5 → W4, W7   (W5 依赖 W3 的 info 通道)
Phase 4 质量:  W8            (覆盖最终的单/多 agent 行为)
```

- W6 最小,先行清理 SessionConfig。
- W2/W3 耦合(env 注入 + 重启),一起做,是其余一切的地基。
- W1 在 W2 之后,以便用真实 API 调试(已授权)。
- W5 复用 W3 的端口/info 下发通道。
- W4/W7 较独立,Phase 3 收尾;W8 最后固化。

## 6. 测试策略总览

- **快速层(默认 CI)**:前端 vitest + sidecar mock-model 单测,无网络、必过。
- **集成层(需 key,手动/本地)**:真实 DeepSeek API 测单/多 agent,`skipIf` 守卫。
- **E2E**:沿用现有 wdio Tauri 方案;多智能体 UI 流转可作为扩展用例(非本次必须)。

## 7. 范围边界(本次不做)

1. **右侧面板 Doc/Files/Diff 接真实数据** —— 属新功能(需 agent 产出 artifact + 新协议消息),非缺陷修复。留作独立项目。本次仅 Agents Tab 随 W1 完善。
2. **真实第三方 OAuth** —— 需后端/IdP;本次仅 W7 路由守卫。
3. **子 agent 真实工具链(文件读写/命令执行)** —— 高危安全面,留后续;本次子 agent 为纯推理。

## 8. 成功标准

- 打包后的应用从 Finder 启动,在设置页录入 DeepSeek key 后,无需终端环境变量即可正常对话。
- 一条复杂请求触发 Supervisor + 多个子 agent,Dashboard 实时展示各 agent 流式与状态;对话区显示汇总回复。
- 杀掉/重启 sidecar 后,前端显示断连并能自动/手动恢复;应用退出不残留 node 进程。
- WS 拒绝无 token/跨 Origin 连接;CSP 生效。
- 未登录无法直达 `/app`。
- `yarn test`(无 key)全绿;带 key 时集成测试通过。
- 无死代码残留(`tokenize`、MockTransport 注释、悬空 `useConnectionStatus`)。
