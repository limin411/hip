# Session History & Real-LLM Tests Design

**Date**: 2026-06-07
**Status**: Approved

## Goal

让 `Session` 维护多轮对话历史，并引入基于真实 DeepSeek LLM 的测试，验证流式协议映射、历史记忆和取消行为。

## Architecture

- `Session` 内部持有 `messages: BaseMessage[]` 数组
- 每轮用户提问追加 `HumanMessage`，AI 回复完整后追加 `AIMessage`
- `sendMessage` 把完整 history 传给 `agent.streamEvents({ messages })`
- 测试通过依赖注入传入 `ChatOpenAI` 实例，使用真实 DeepSeek API

## Changes

### `packages/sidecar/src/session/session.ts`

**新增：**
- 构造函数第三个参数 `model?: BaseLanguageModel`
- 私有字段 `messages: BaseMessage[] = []`
- 使用 `HumanMessage` 和 `AIMessage` 组装历史

**修改：**
- `sendMessage` 的输入从单条消息改为 `{ messages: this.messages }`
- AI 回复完成后 `this.messages.push(new AIMessage(aiText))`
- 错误时不 push AI message，但 HumanMessage 保留在 history 中

### `packages/sidecar/src/session/session.test.ts` (new)

三个测试：

1. **single-turn response** — 验证协议事件顺序和 message:complete 内容
2. **history across turns** — 两轮对话，第二轮测试模型是否记得第一轮内容
3. **cancel emits error** — 发送长文本并立即 cancel，验证收到 error 事件

所有测试均使用真实 DeepSeek API（`ChatOpenAI` + `baseURL: https://api.deepseek.com/v1`）。

### `vitest.config.ts`

扩展 `test.include`：

```ts
include: ['src/**/*.test.ts', 'packages/sidecar/src/**/*.test.ts']
```

### `packages/sidecar/package.json`

确认已有 `@langchain/core` 依赖。`HumanMessage` / `AIMessage` 从 `@langchain/core/messages` 导入，无需新增包。

## Protocol Messages Unchanged

所有 WebSocket 消息类型保持不变：
- `agent:started`
- `token:stream`
- `agent:finished`
- `message:complete`
- `error`

前端无需改动。

## Running Tests

```bash
DEEPSEEK_API_KEY=sk-b10b96a9b540473787962b869c34f4aa \
  yarn vitest run packages/sidecar/src/session/session.test.ts
```

## Risks

- 真实 API 调用存在成本和延迟；测试运行时间可能在 10–30 秒/测试
- 模型输出非确定性可能导致偶发失败；测试断言使用宽松匹配（`toContain`, `toMatch`）
- Abort 时机依赖实际网络 RTT；cancel 测试可能偶发不触发 error

## Future Work (out of scope)

- 持久化 history 到磁盘 / checkpointer
- 消息数量/长度截断，防止上下文超限
- 支持多 provider 的 model 工厂
