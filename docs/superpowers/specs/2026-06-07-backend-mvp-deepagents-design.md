# Backend MVP: deepagents 替换自定义 StateGraph

**Date**: 2026-06-07
**Status**: Approved

## 目标

用 `deepagents`（npm 包，最新稳定版 `0.6.8`）替换当前自定义 LangGraph StateGraph（Supervisor/Planner/Coder/Reviewer 空桩），实现基础对话能力的 MVP 版本。

## 模型

使用 DeepSeek API（`@langchain/community` 的 `ChatDeepSeek`），由用户提供 API Key。

## 架构不变

- Rust Tauri Shell → spawn Node.js Sidecar → WebSocket 通信
- `@hip/protocol` 消息类型全部复用
- 前端 transport 层 / session store / UI 组件零改动

## 改动范围

### 删除的文件

| 文件 | 原因 |
|------|------|
| `packages/sidecar/src/graph/builder.ts` | 不再需要手动构建 StateGraph |
| `packages/sidecar/src/agents/supervisor.ts` | 被 deepagents 内置 agent loop 替代 |
| `packages/sidecar/src/agents/sub-agents/planner.ts` | 同上 |
| `packages/sidecar/src/agents/sub-agents/coder.ts` | 同上 |
| `packages/sidecar/src/agents/sub-agents/reviewer.ts` | 同上 |

### 新增/修改的文件

| 文件 | 改动 |
|------|------|
| `packages/sidecar/package.json` | 添加 `deepagents` 依赖；添加 DeepSeek 模型 provider |
| `packages/sidecar/src/session/session.ts` | 重写：用 `createDeepAgent()` 替换自定义图 |
| `packages/sidecar/src/session/session-manager.ts` | 微调：传递 model 配置到 Session |

### 不变的文件

| 文件 | 说明 |
|------|------|
| `packages/protocol/src/index.ts` | 消息类型不变 |
| `packages/sidecar/src/main.ts` | 启动逻辑不变 |
| `packages/sidecar/src/server/ws-server.ts` | WebSocket 服务不变 |
| 所有前端文件 | 零改动 |

## 核心设计：Session 重写

### 现有结构（删除）

```
session.ts → new StateGraph(builder.ts) → supervisor → planner/coder/reviewer
```

### 新结构

```
session.ts → createDeepAgent({ model, systemPrompt }) → streamEvents → WebSocket
```

### createDeepAgent 配置（MVP 阶段）

```ts
const agent = createDeepAgent({
  model: new ChatDeepSeek({ apiKey: config.apiKey, model: "deepseek-chat" }),
  systemPrompt: "You are a helpful coding assistant.",
  // MVP: 不传 tools、subagents、backend 等参数，仅基础对话
});
```

### 流式事件映射

`streamEvents({ version: "v2" })` 输出 → `@hip/protocol` 消息：

| streamEvents 事件 | 协议消息 |
|-------------------|---------|
| `on_chat_model_stream` | `{ type: "token:stream", content: token }` |
| `on_chat_model_end` | `{ type: "agent:finished", agentName: "main" }` |
| 流结束 | `{ type: "message:complete" }` |
| 异常 | `{ type: "error", message: error.message }` |

### Session 完整接口

```ts
class Session {
  id: string;
  private agent: CompiledStateGraph | null;
  private abortController: AbortController | null;

  async init(config: SessionConfig): Promise<void>;
  async sendMessage(content: string, onEvent: (msg: ServerMessage) => void): Promise<void>;
  cancel(): void;
  destroy(): void;
}
```

- `init(config)`: 调用 `createDeepAgent`，存储 agent 实例
- `sendMessage(content, onEvent)`: 调用 `agent.streamEvents()`，将事件转为 `ServerMessage` 通过 `onEvent` 回调发出
- `cancel()`: 通过 `AbortController` 中断当前流
- `destroy()`: 清理资源

### SessionConfig 扩展

```ts
interface SessionConfig {
  model: string;        // "deepseek-chat" 等
  apiKey: string;       // DeepSeek API Key
  systemPrompt?: string;
}
```

## SessionManager 适配

SessionManager 负责将 client 发来的 `session:create` 消息中的配置提取出来传给 Session：

```ts
// session-manager.ts
async handleCreateSession(clientId, payload) {
  const config: SessionConfig = {
    model: payload.model ?? "deepseek-chat",
    apiKey: payload.apiKey ?? process.env.DEEPSEEK_API_KEY,
    systemPrompt: payload.systemPrompt,
  };
  const session = new Session();
  await session.init(config);
  this.sessions.set(sessionId, session);
}
```

## MVP 不包含的能力（后续迭代）

- 子 agent (sub-agents)
- 文件系统 backend / Shell 执行
- 上下文压缩 / 摘要
- TODO 规划 (`write_todos`)
- 人工审批 (human-in-the-loop)
- 持久记忆
- 代码解释器

## 依赖变更

```json
// packages/sidecar/package.json
{
  "dependencies": {
    "deepagents": "^0.6.8",
    "@langchain/community": "^0.3.x",
    // 保留现有依赖：@langchain/core, @langchain/langgraph, ws
    // 可移除（如未使用）：@langchain/anthropic, @langchain/openai
  }
}
```

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `deepagents` 内置 tools（write_todos 等）可能被模型自动调用 | MVP 不传 tools 配置，仅用纯对话 |
| DeepSeek API 可能不支持某些 tool calling 协议 | MVP 不涉及 tool calling，仅验证对话流 |
| `streamEvents` v2 格式与现有 `onAgentToken` 回调不兼容 | 在 Session 内部做事件格式适配，不暴露到外部 |

## 验证标准

1. `yarn workspace @hip/sidecar dev` 启动后 WebSocket 服务正常运行
2. 前端发送消息后能收到 `token:stream` 流式 token
3. 完整对话回合以 `message:complete` 收尾
4. 中断 `cancel` 能正常停止流
5. 错误场景（无网络、API Key 无效）有合理的 `error` 消息
