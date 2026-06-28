# 全面测试体系现代化设计

## 1. 背景与现状诊断

当前 `hip` 项目包含约 **203 个测试文件**、近 3000 条测试，覆盖前端 React、sidecar Node 服务、protocol 契约和 Tauri 桌面端 E2E。但「真机测试」与整体测试基础设施存在明显缺陷：

| 层级 | 当前状态 | 主要问题 |
|------|----------|----------|
| **E2E 真机测试** (`e2e/specs/*.spec.ts`) | 3/3 文件失败 | `core.invoke` 桥接超时、surface 切换点不动、spec 少 |
| **单元/集成测试** (`yarn test`) | 263 文件通过，1 文件失败 | `external-acp.integration.test.ts` 2 条用例 flaky 失败；无 CI 守门 |
| **Coverage** | 报告存在但不可信 | 包含 `dist/` 导致 0% statements；integration/contract 被排除 |
| **Protocol** | 测试本身通过 | `index.contract.test.ts` 在包自身 `type-check` 下报错 |
| **CI** | 无 | `.github/workflows/` 不存在 |

### 1.1 关键发现

- `yarn test:e2e` 启动真实 Tauri app + sidecar，但 3 个 spec 全部失败：
  - `app-launch.spec.ts` 等不到 `#/login`、登录后找不到「新对话」。
  - `project-workspace.spec.ts` / `diff-workspace.spec.ts` 的 `before all` 中 `[aria-label="代码"]` 点不动。
  - 日志充斥 `Tauri core.invoke not available after 5s timeout`，说明 WebDriver/Tauri 桥接不稳定。
- `yarn test` 在本地通过 2941 条，但 `external-acp.integration.test.ts` 的权限/取消用例偶发失败，存在 race condition。
- `packages/protocol/src/index.contract.test.ts` 使用 `as SessionEvent` 后访问变体字段，导致 `yarn workspace @hip/protocol type-check` 失败。
- Coverage 配置未排除 `packages/sidecar/dist/**`，报告被编译产物污染。
- 前端 `src/` 157 个源文件中，大量高价值组件（`ChatPane`、`Composer`、`MessageBubble`、`ArtifactPanel`、`BranchSwitcher`、`TimelineView` 等）零测试。

## 2. 目标与非目标

### 2.1 目标

1. **E2E 真机测试可用**：修复现有 3 个 spec，新增核心 GUI 流程 spec，能在本地稳定跑通。
2. **所有既有测试稳定绿跑**：修复 flaky 失败、消除 coverage 污染、修复 protocol type-check。
3. **测试分层清晰**：unit / integration / contract / e2e 职责明确，命名与目录一致。
4. **CI 自动化**：引入 GitHub Actions，至少跑通 unit + contract + e2e smoke。
5. **覆盖率可信**：修复 coverage 配置，设定阶段性覆盖率目标。

### 2.2 非目标

- 不追求 100% 覆盖率。
- 不一次性重写全部 203 个测试文件；按优先级分 phase 增量改造。
- 不改动业务代码行为来迁就测试（除非测试揭示了真实 bug）。
- 不引入新的测试框架；保留 Vitest + WebdriverIO + Mocha。

## 3. 设计原则

1. **真实优先，但可控**：E2E 使用真实 Tauri app + sidecar + LLM；LLM 用例通过 API key 门控，默认跳过，避免阻塞无 key 环境。
2. **失败优先**：先修复跑不通的测试，再扩展覆盖。
3. **最小侵入**：尽量复用现有工具链与测试约定，避免大范围重构业务代码。
4. **统一 fixture**：建立共享的 test helpers、page objects、mock agents、临时目录管理。
5. **渐进交付**：按 phase 发布，每个 phase 都有可验证的绿跑状态。

## 4. 整体测试架构

```
┌─────────────────────────────────────────────────────────────┐
│  E2E 真机层 (WebdriverIO + @wdio/tauri-service)              │
│  - 启动真实 Tauri app + sidecar                              │
│  - 覆盖跨组件/跨进程的完整用户流程                           │
│  - 依赖真实 LLM 的用例 key-gated                             │
├─────────────────────────────────────────────────────────────┤
│  Integration 层 (Vitest)                                     │
│  - sidecar 与真实文件系统 / git / SQLite / 子进程交互        │
│  - 真实 LLM / 网络用例 key-gated                             │
├─────────────────────────────────────────────────────────────┤
│  Contract 层 (Vitest)                                        │
│  - protocol 消息序列化/反序列化 round-trip                   │
│  - 类型守卫编译时检查                                        │
├─────────────────────────────────────────────────────────────┤
│  Unit 层 (Vitest + happy-dom)                                │
│  - 纯函数、store、domain 逻辑                                │
│  - React 组件渲染与交互                                      │
├─────────────────────────────────────────────────────────────┤
│  Rust/Tauri 后端测试 (cargo test)                            │
│  - 当前未纳入 JS 测试脚本，需单独配置                         │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 测试命名与目录约定

| 类型 | 文件名模式 | 位置示例 |
|------|------------|----------|
| 单元测试 | `*.test.ts(x)` | `src/store/diffStore.test.ts` |
| 集成测试 | `*.integration.test.ts` | `packages/sidecar/src/session/*.integration.test.ts` |
| 契约测试 | `*.contract.test.ts` | `packages/protocol/src/*.contract.test.ts` |
| E2E | `*.spec.ts` | `e2e/specs/*.spec.ts` |

新增约定：
- 所有需要真实 LLM 的集成/单元测试统一使用 `describe.skipIf(!hasApiKey('deepseek'))` 等门控。
- 所有需要外部网络（非 LLM）的测试使用 `describe.skipIf(process.env.CI === 'true' || !hasNetwork())`。

## 5. Phase 1：止血与基础设施（第一交付）

**目标**：让 `yarn test` 和 `yarn test:e2e` 全部绿跑。

### 5.1 修复 E2E 真机测试

1. **诊断并修复 `core.invoke` 超时**
   - 文件：`wdio.conf.ts`、`e2e/specs/*.spec.ts`
   - 可能原因：
     - 配置使用 release bundle 路径，但实际启动的是 debug binary；路径不一致导致桥接初始化问题。
     - 应用启动后未等待 sidecar 就绪就执行操作。
   - 行动：
     - 统一 app binary 路径，优先使用 `src-tauri/target/debug/hip` 作为开发/E2E 默认，或提供 `E2E_BINARY` 环境变量覆盖。
     - 在 `wdio.conf.ts` 的 `onPrepare` 中增加 sidecar 健康检查（等待 `ws-server` 端口或 `core.invoke` 可用）。
     - 在 `e2e/helpers/app.ts` 中提供 `waitForAppReady()` helper，等待 `window.__TAURI_INTERNALS__` 或 `window.wdioTauri` 就绪。

2. **修复登录与 surface 切换**
   - 文件：`e2e/specs/app-launch.spec.ts`、`e2e/specs/project-workspace.spec.ts`、`e2e/specs/diff-workspace.spec.ts`
   - 问题：
     - `app-launch.spec.ts` 等不到 `#/login`。
     - surface 切换按钮 `[aria-label="代码"]` 点不动（可能 app 没进入主界面、或 rail 未渲染）。
   - 行动：
     - 提取共享 `skipLoginIfPresent()` 到 `e2e/helpers/auth.ts`。
     - 添加 `waitForMainApp()` helper，等待 `#/app` 与关键 chrome（rail、sidebar）渲染。
     - 为 rail 按钮增加稳定的 `data-testid`（如 `rail-chat`、`rail-code`、`rail-domain`），减少对 aria-label 的依赖。
     - 在 `before` hook 中增加更长的冷启动等待（sidecar 首次启动可能 >10s）。

3. **建立 E2E 共享 helpers**
   - 新建目录结构：
     ```
     e2e/
     ├── helpers/
     │   ├── auth.ts          # 登录/跳过登录
     │   ├── app.ts           # 启动/ readiness
     │   ├── surface.ts       # surface 切换
     │   ├── composer.ts      # 发送消息
     │   └── fs.ts            # 临时目录/夹具
     ├── page-objects/
     │   ├── LoginPage.ts
     │   ├── ChatPage.ts
     │   ├── CodePage.ts
     │   └── SettingsPage.ts
     └── specs/
     ```

### 5.2 修复 flaky 集成测试

1. **稳定 `external-acp.integration.test.ts`**
   - 文件：`packages/sidecar/src/session/external-acp.integration.test.ts`
   - 问题：权限响应/取消用例依赖固定 `setTimeout`，存在 race。
   - 行动：
     - 将基于 sleep 的断言改为等待 terminal 事件（`message:complete` / `error`）。
     - 在 `afterEach` 中调用 `acpConnections.disposeAll()` 并清空 mock agent 的模块级状态。
     - 为 `mock-acp-agent.mjs` 增加 per-test reset 协议（stdin 发送 `{"reset": true}`）。

### 5.3 修复 coverage 与 type-check

1. **修复 coverage 配置**
   - 文件：`vitest.config.ts`
   - 行动：
     - 在 `coverage.exclude` 中增加 `**/dist/**`、`**/src-tauri/**`、`**/coverage/**`。
     - 确保 `coverage.include` 只包含源码，不包含测试文件。
     - 生成新 coverage 报告并验证数字合理。

2. **修复 protocol 包 type-check**
   - 文件：`packages/protocol/src/index.contract.test.ts`
   - 行动：
     - 将 `as SessionEvent` 改为 `as Extract<SessionEvent, { type: 'user_message' }>` 等具体变体断言。
     - 运行 `yarn workspace @hip/protocol type-check` 验证通过。

### 5.4 新增最小 CI

- 新建 `.github/workflows/test.yml`：
  - 触发：`push`、`pull_request`
  - Job 1：`unit-and-contract` — 安装依赖、运行 `yarn type-check`、`yarn test`。
  - Job 2：`e2e-smoke`（可选，先标记为 `continue-on-error: true`，因真实 app 构建慢）— 构建 Tauri debug app、运行 `yarn test:e2e`。

## 6. Phase 2：E2E 真机测试扩展

**目标**：覆盖核心用户流程，新增 12–15 个 spec。

### 6.1 新增 E2E spec 清单

按优先级排序：

1. **auth.spec.ts** — 跳过登录、登录状态保持、登出回到登录页。
2. **surface-navigation.spec.ts** — Chat / Code / Domain / Settings 切换。
3. **session-lifecycle.spec.ts** — 新建会话、重命名、删除、搜索、切换。
4. **chat-send.spec.ts** — 输入消息、发送、等待 assistant 回复、停止生成。
5. **chat-message-actions.spec.ts** — 复制、重新生成最后一条消息。
6. **project-workspace-extended.spec.ts** — 在现有 project-workspace 基础上增加 lazily expand、切换文件、刷新 tree。
7. **diff-workspace-extended.spec.ts** — 在现有 diff-workspace 基础上增加 commit log、revert checkpoint。
8. **timeline.spec.ts** — checkpoint 列表、mode 切换、revert 确认。
9. **branch-switcher.spec.ts** — 分支切换、冲突/错误状态。
10. **settings-general.spec.ts** — 语言、主题切换并持久化。
11. **settings-model.spec.ts** — provider/API key 配置、模型选择。
12. **plan-approval.spec.ts** — 计划审批 approve / amend / reject（需可控 mock agent）。
13. **permission-modal.spec.ts** — ACP 工具权限 grant / deny。
14. **attachment.spec.ts** — 选择文件、附件 chip、发送带附件消息（如 UI 支持）。
15. **sidebar-chrome.spec.ts** — 折叠/展开 sidebar、右侧面板开关、主题响应。

### 6.2 E2E 测试数据与 LLM 策略

- **真实 LLM 用例**：
  - `chat-send.spec.ts`、`plan-approval.spec.ts`、`permission-modal.spec.ts` 默认使用真实模型，通过 `~/.hip/config/auth.json` 提供 key。
  - 在 CI/无 key 环境使用 `describe.skipIf(!hasRealModelKey())` 跳过，不失败。
- **可控非 LLM 用例**：
  - project/diff/timeline/branch 等不依赖模型，使用固定临时目录与 git 仓库。
- **会话隔离**：
  - 每个 spec 使用独立的 `HIP_DATA_DIR`（通过 env 注入 Tauri），避免会话污染。
  - 在 `wdio.conf.ts` 的 `onPrepare`/`onComplete` 中管理全局数据目录。

### 6.3 E2E 稳定性机制

- 全局 `before` hook 等待 app + sidecar + Vite 全部就绪。
- 使用 `data-testid` 优先于文本选择器。
- 增加 `browser.waitUntil` 重试，避免硬编码 `browser.pause`。
- 单 worker（`maxInstances: 1`）保持串行，避免 sidecar 端口冲突。

## 7. Phase 3：前端单元测试补强

**目标**：覆盖高价值组件与 IPC，减少 UI 回归。

### 7.1 优先级组件测试

| 区域 | 待测文件 | 测试重点 |
|------|----------|----------|
| Chat 核心 | `ChatPane`、`Composer`、`MessageBubble`、`MessageActions` | 渲染消息列表、发送、复制、重新生成 |
| 审批/权限 | `PlanApprovalCard`、`PermissionModal` | approve/amend/reject、权限选择 |
| Artifact | `ArtifactPanel`、`FileTree`、`FilePreview`、`ChangesView`、`DiffDisplay`、`TimelineView`、`BranchSwitcher` | 文件树交互、diff 渲染、timeline revert |
| 设置 | `SettingsPage`、`ProviderList`、`AgentGrid`、`ModelConfig` | 导航、表单提交、状态同步 |
| 布局 | `AppLayout`、`LoginScreen`、`RequireAuth`、`MenuRail` | 路由守卫、surface 切换、登录流程 |
| IPC | `ws-client.ts`、`transport.ts`、`hooks.ts` | 连接状态、重连、消息路由 |

### 7.2 测试模式统一

- 统一使用 `@testing-library/user-event` 替代 `fireEvent`（除已稳定使用的文件外）。
- 统一 `vi.mock('@tauri-apps/api/core')` 与 `vi.mock('react-i18next')` 模式。
- 为 Zustand store 提供 `createTestStore` 重置工具，避免测试间状态泄漏。

## 8. Phase 4：Sidecar 集成与契约测试加固

### 8.1 Sidecar 集成测试改进

1. **移除 sleep-based 等待**
   - 扫描 `*.integration.test.ts` 中的 `await new Promise(r => setTimeout(...))`。
   - 替换为等待事件流 terminal 状态或 Promise 回调。

2. **统一临时资源清理**
   - 所有创建临时目录/数据库/子进程的测试在 `afterEach`/`afterAll` 中清理。
   - 提供 `using` 风格的 `tempDir()` helper。

3. **真实 LLM smoke 测试**
   - 保持 `session.test.ts`、`session-anthropic.test.ts`、`reasoner-reasoning.integration.test.ts` 的 key-gated 策略。
   - 增加 CI nightly job 在 secrets 存在时运行这些测试。

### 8.2 Protocol 契约测试扩展

1. **修复命名一致性**：将 `orchestration-types.test.ts`、`subagent-protocol.test.ts` 重命名为 `*.contract.test.ts`，或从 coverage exclude 中移除对 `*.contract.test.ts` 的排除。
2. **新增契约测试**：
   - `providerKeyEnv.contract.test.ts` — 覆盖唯一运行时函数。
   - 补充 `ClientMessage`/`ServerMessage` 中缺失的消息变体。
   - 补充 `Message`、`ToolCall`、`Attachment`、`DiffFile` 等核心数据结构的 round-trip。

## 9. Phase 5：CI/CD、覆盖率与可观测性

### 9.1 GitHub Actions 工作流

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: yarn install --frozen-lockfile
      - run: yarn type-check
      - run: yarn workspace @hip/protocol type-check
      - run: yarn workspace @hip/sidecar type-check

  unit-contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: yarn install --frozen-lockfile
      - run: yarn test --coverage
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }

  e2e-smoke:
    runs-on: macos-latest
    needs: [type-check]
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - run: yarn install --frozen-lockfile
      - run: yarn tauri build --debug
      - run: yarn test:e2e
```

### 9.2 覆盖率目标

| 阶段 | 目标 |
|------|------|
| Phase 1 | 修复报告，获得可信基线 |
| Phase 3 结束 | `src/lib` ≥80%，`src/store` ≥70%，新增组件 ≥60% |
| Phase 4 结束 | `packages/sidecar/src` 单元测试 ≥60%（不含 integration） |
| Phase 5 | CI 中展示 coverage diff |

### 9.3 Flakiness 跟踪

- 在 CI 中收集每个测试的耗时与失败率。
- 对连续 3 次失败的 flaky 测试强制禁用并创建 issue。

## 10. 测试环境与数据策略

### 10.1 环境变量约定

| 变量 | 用途 |
|------|------|
| `HIP_MODEL_<PROVIDER>_API_KEY` | 真实 LLM key |
| `HIP_AUTH_PATH` | 测试用临时 auth.json 路径 |
| `HIP_DATA_DIR` | E2E 会话/配置隔离目录 |
| `HIP_DB_PATH` | 集成测试 SQLite 路径；`:memory:` 默认 |
| `E2E_BINARY` | 覆盖 E2E 使用的 Tauri binary 路径 |
| `E2E_GREP` / `E2E_INVERT` | 选择性运行 E2E |
| `CI` | 跳过高成本网络测试 |

### 10.2 Fixture 目录

```
e2e/fixtures/
├── sample-project/          # 已有
├── sample-git-repo/         # 含若干 commit 的 git 仓库
├── sample-multi-file/       # 多文件项目
└── sample-binary/           # 含图片/PDF 的项目
```

## 11. 文件/目录变更清单

### 新增
- `.github/workflows/test.yml`
- `e2e/helpers/{auth.ts,app.ts,surface.ts,composer.ts,fs.ts}`
- `e2e/page-objects/{LoginPage.ts,ChatPage.ts,CodePage.ts,SettingsPage.ts}`
- `e2e/specs/{auth,surface-navigation,session-lifecycle,chat-send,chat-message-actions,project-workspace-extended,diff-workspace-extended,timeline,branch-switcher,settings-general,settings-model,plan-approval,permission-modal,attachment,sidebar-chrome}.spec.ts`
- `packages/protocol/src/providerKeyEnv.contract.test.ts`
- 前端若干 `*.test.tsx`

### 修改
- `wdio.conf.ts` — binary 路径、sidecar readiness、数据目录隔离
- `vitest.config.ts` — coverage exclude
- `vitest.setup.ts` — 保持现有逻辑，增加 `CI` 环境适配
- `e2e/specs/app-launch.spec.ts` / `project-workspace.spec.ts` / `diff-workspace.spec.ts` — 修复失败
- `packages/sidecar/src/session/external-acp.integration.test.ts` — 去 flaky
- `packages/protocol/src/index.contract.test.ts` — 修复 type-check
- `packages/protocol/src/orchestration-types.test.ts`、`subagent-protocol.test.ts` — 命名/覆盖一致性

### 重命名（可选）
- `packages/protocol/src/orchestration-types.test.ts` → `orchestration-types.contract.test.ts`
- `packages/protocol/src/subagent-protocol.test.ts` → `subagent-protocol.contract.test.ts`

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| E2E 真实 Tauri app 启动慢/不稳定 | CI 时间长、易失败 | debug binary、单 worker、ready wait、key-gated 跳过 |
| LLM 调用费用高 | 开发/CI 成本高 | 仅核心流程用真实 LLM；其余 mock 或测到发送即止 |
| 范围过大导致无法一次完成 | 交付风险 | 按 Phase 交付，每个 Phase 独立绿跑 |
| 测试改坏现有行为 | 回归 | 每个 Phase 先跑全量测试基线，再改动 |
| `core.invoke` 桥接问题无法简单修复 | E2E 不可用 | 升级 `@wdio/tauri-service`、检查 Tauri v2 plugin 初始化、必要时加 polyfill |

## 13. 成功标准

- [ ] `yarn test` 全绿，无 flaky 失败。
- [ ] `yarn test:e2e` 全绿（本地有 key 时）。
- [ ] `yarn type-check`、`yarn workspace @hip/protocol type-check`、`yarn workspace @hip/sidecar type-check` 全通过。
- [ ] Coverage 报告排除 `dist/`，数字可信。
- [ ] GitHub Actions `unit-contract` job 绿跑。
- [ ] 新增 E2E spec ≥12 个，覆盖 6.1 清单中的核心流程。
- [ ] 新增前端组件/IPC 测试覆盖 7.1 中的高价值区域。

## 14. 实施顺序建议

1. **Phase 1.1**：修复 `vitest.config.ts` coverage、protocol type-check、external-acp flaky。
2. **Phase 1.2**：修复 E2E 现有 3 个 spec。
3. **Phase 1.3**：新增最小 CI（type-check + unit）。
4. **Phase 2**：E2E helpers + page objects + 新增 spec。
5. **Phase 3**：前端组件/IPC 测试补强。
6. **Phase 4**：sidecar integration/contract 加固。
7. **Phase 5**：完整 CI、e2e-smoke job、覆盖率门禁。

---

*作者：Kimi Code CLI*  
*日期：2026-06-28*
