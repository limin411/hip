# 补全测试套件设计文档

## 背景

当前 `e2e/specs/` 只有 4 个 spec 文件（`app-launch`、`project-workspace`、`diff-workspace`、`slash-commands`），覆盖的是启动、文件树/预览、Git diff、slash palette 这几条最基础的 happy path。

与此同时，应用已经包含大量未在 E2E 中验证的核心能力：

- 会话列表、搜索、新建会话
- 已有会话的聊天往返、消息气泡、thinking/error/interrupt 状态
- Composer 附件、ModelPicker、PermissionModePicker、停止生成
- Plan approval、Permission modal、Tool trace / Turn timeline
- Settings（Model / Agents / MCP / Skills / Plugins）
- Timeline / Branch switcher / Changes badge 等 Artifact 面板功能

单元测试已有 75 个文件，但仍有部分交互较重的组件缺少覆盖。

## 目标

把 E2E 和单元测试补齐到“主要用户流程与关键 UI 状态都有自动化覆盖”。

## 范围与分阶段策略

采用分阶段推进，避免一次性大爆炸带来的 Review 与稳定性风险。

### Phase 1：核心 UI E2E + 关键单元测试

不依赖外部 LLM/MCP，只验证 UI 状态与交互。

| 新增 E2E Spec | 覆盖点 |
|---------------|--------|
| `chat-session.spec.ts` | 发送消息创建会话、消息气泡渲染、jump-to-latest、error retry |
| `session-list.spec.ts` | 新建会话按钮、会话列表、会话搜索 |
| `attachment.spec.ts` | 附件按钮、附件 chip、移除附件 |
| `settings-smoke.spec.ts` | 进入/退出设置、各 tab 切换、关键控件存在 |
| `composer-widgets.spec.ts` | ModelPicker、PermissionModePicker、Stop 按钮状态 |

关键单元测试补齐：

- `MessageBubble`、`Composer`、`CodeBlock`
- `PermissionModal`、`PlanApprovalCard`
- `FilePreview`、`FileTree`

### Phase 2：真实 LLM/MCP E2E

复用本地已配置的 provider / MCP / agent 跑真实请求。

| 新增 E2E Spec | 覆盖点 |
|---------------|--------|
| `llm-chat.spec.ts` | 普通对话发送 → 看到 assistant 回复 |
| `plan-approval.spec.ts` | 触发 plan approval → approve / amend / reject |
| `permission-modal.spec.ts` | ACP agent 触发 permission modal → 选择选项 |
| `mcp-and-tool.spec.ts` | MCP / tool trace 在消息中展示 |
| `agent-chat.spec.ts` | 选择 agent 后发送消息，验证 agent 相关 UI |

### Phase 3：剩余单元测试

补齐未覆盖的组件与交互：

- `DiffDisplay`、`ChangesView`
- `TimelineView`、`BranchSwitcher`
- `ArtifactCard`、`ToolTrace`、`SubAgentCard`
- `SettingsPanel` 内各子页面对应组件

## 关键设计决策

1. **复用本地配置**
   - 当环境变量 `E2E_USE_REAL_CONFIG=1` 存在时，测试启动前把 `~/.hip/config/` 复制到隔离的 `HIP_DATA_DIR`。
   - sidecar 自动读取 provider key、MCP server、agent 配置，无需在代码中硬编码。
2. **默认 provider 与 fallback**
   - 优先使用 `deepseek/deepseek-v4-flash`。
   - 失败时 fallback 到 `kimi-for-coding/k2p7`。
3. **无配置自动跳过**
   - 检测不到可用 provider key 时，LLM 相关 spec 用 `this.skip()` 跳过，避免 CI 裸跑失败。
4. **超时与重试**
   - LLM 用例 timeout 120–180s。
   - mocha 配置 `retries: 1` 用于 LLM spec 文件。
   - prompt 尽量简短（如 `"hi"`、`"say hi"`），控制 token 与费用。
5. **敏感信息不泄露**
   - 测试代码不输出、不打印、不提交任何 API key。
   - 设计文档与代码只引用目录路径或环境变量。

## E2E 架构

继续沿用 **WebdriverIO + Tauri** 现有栈。

### Page Objects 扩展

- `ChatPage`
  - 新增消息气泡、附件、error/interrupt、jump-to-latest、plan approval、permission modal 的 getter。
- `SettingsPage`
  - 进入/退出设置、切换 tab、操作表单。
- `ArtifactPanelPage`
  - Changes / Timeline / Branch / Diff 相关操作。

### Helpers 扩展

- `settings.ts`：进入/退出设置页。
- `session.ts`：创建/切换/搜索会话。
- `llm.ts`：等待 assistant 回复、等待 plan/permission/tool trace 出现。

### 新增 Spec 文件

```text
e2e/specs/
  chat-session.spec.ts
  session-list.spec.ts
  attachment.spec.ts
  settings-smoke.spec.ts
  composer-widgets.spec.ts
  llm-chat.spec.ts
  plan-approval.spec.ts
  permission-modal.spec.ts
  mcp-and-tool.spec.ts
  agent-chat.spec.ts
```

## 单元测试架构

继续沿用 **Vitest + @testing-library/react + happy-dom**。

- 对 store 依赖重的组件使用 `vi.mock('@/store/...')` 或提供 mock state。
- 对 `domain` 层的复杂 hook，必要时 mock `sessionService`。
- 优先补齐“无测试 + 交互重”的组件。

## 风险与应对

| 风险 | 应对 |
|------|------|
| 真实 API 费用/延迟 | 短 prompt、单测先行、LLM E2E 默认只在本地/带 key 环境跑 |
| Plan/permission/tool 不稳定 | 每个 LLM 用例独立重试；长时间未触发则 fail，不隐藏问题 |
| 改动量巨大 | 分阶段提交，每阶段跑通 `type-check`、`test`、`test:e2e` |
| 敏感 key 泄露 | 不硬编码、不打印、不提交 config；复制目录路径也不出现在日志 |

## 验收标准

- Phase 1：新增 5+ E2E spec、核心组件单元测试补齐，`yarn test` 与 `yarn test:e2e` 均通过。
- Phase 2：新增 5+ LLM E2E spec，在带本地配置环境下稳定跑通。
- Phase 3：主要缺失组件均有单元测试，`yarn test` 全绿。
