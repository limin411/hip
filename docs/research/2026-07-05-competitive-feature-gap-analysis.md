# hip 与主流 AI Workbench 的功能差距分析

**Date:** 2026-07-05  
**Scope:** 将 `hip`（Tauri + React/TS + Node.js sidecar + LangGraph 的桌面 AI workbench）与 Trae Work、Claude Desktop、Codex Desktop、Qoder Work 进行功能层面对比，识别差距与补强方向。  
**Sources:** 本报告基于同日生成的 5 份研究笔记，所有引用均来自竞品官方文档、公开博客或 `hip` 本地代码路径。

---

## 1. 执行摘要

`hip` 的技术底座与竞品方向一致——本地优先、桌面原生、LangGraph 驱动、MCP 扩展。但在**产品形态、工作空间、安全沙箱、长期记忆/检索、跨端协作**四个维度上，与头部产品存在明显差距。最大短板不是"没有 Agent"，而是：

1. **UI 仍停留在"单会话聊天"**，缺少多模式工作台、分屏编辑、内嵌终端/预览等现代桌面 AI workbench 的标配。
2. **Agent 编排是 prompt 驱动的扁平流水线**，没有 enforceable DAG、并行分支、reviewer gate 或用户可定义的子代理团队。
3. **没有向量检索与长期记忆层**，无法做项目级 RAG、跨会话记忆、或基于历史会话的复用。
4. **安全模型偏简单**：明文 API key、无 OS 级沙箱、权限模式只有 chat/edit/full 三档。
5. **协作与同步为零**：无团队空间、无会话导出、无云同步/远程控制。

下面按维度展开，并给出对 `hip` 的优先级建议。

---

## 2. hip 当前状态（基线）

`hip` 的运行时由三部分组成：Tauri Rust 壳、React 前端、Node.js sidecar。sidecar 使用 LangGraph 维护一个 `START → compact → agent → tools → compact/END` 的循环，支持 `task`/`dispatch_agent` 两种子代理调用。详见 [`2026-07-05-hip-self-architecture.md`](./2026-07-05-hip-self-architecture.md)。

已具备的核心能力：

- **双模式会话**：Chat（只读）与 Code（文件工具 + Git + diff）。[`packages/protocol/src/index.ts:6-9`](../packages/protocol/src/index.ts)
- **流式输出 + 工具调用时间线 + Plan 审批**。[`packages/sidecar/src/session/session.ts:1403-1417`](../packages/sidecar/src/session/session.ts)
- **Git checkpoint / diff / revert**。[`packages/sidecar/src/session/session.ts:459-472`](../packages/sidecar/src/session/session.ts)
- **Skills / Plugins / MCP / 外部 Agent 扩展**。详见 hip 自研报告 §6。
- **本地 SQLite 会话持久化 + FTS**。[`packages/sidecar/src/persistence/`](../packages/sidecar/src/persistence/)

关键局限（作为后续对比基线）：

- 无 embedding / 向量检索 / 长期记忆。
- Agent 流水线由 LLM 调用 `task` 工具顺序触发，非结构化 DAG。
- 纯本地，无协作/同步。
- API key 明文存储于 `~/.hip/config/auth.json`（设计如此）。
- UI 为单应用布局，无分屏 IDE 式工作空间。

---

## 3. 竞品关键差异与差距

### 3.1 工作空间 / UI 形态

| 竞品 | 核心工作空间形态 | 对 hip 的启示 |
|---|---|---|
| **Claude Desktop** | Chat / Cowork / Code 三标签；并行会话侧边栏；可拖拽分屏：chat、diff、terminal、file editor、preview。[Desktop Quickstart](https://code.claude.com/docs/en/desktop-quickstart) | hip 当前是单 React hash-router 应用，缺少分屏 IDE 体验。 |
| **Trae Work** | Work / Code / Design 三模式；跨桌面、Web、Mobile；云端并行执行；White-box 执行与 diff review。[TRAE Work landing](https://www.trae.ai/work) | hip 没有非代码工作模式，也没有设计模式与移动/Web 客户端。 |
| **Codex Desktop** | 多项目/多线程并行；Git worktree 隔离；内嵌终端、diff、浏览器预览、Appshots、浮动窗口。[Codex app features](https://developers.openai.com/codex/app/features) | hip 缺少项目-线程模型、worktree 隔离、浏览器预览。 |
| **Qoder Work** | General / Design / Slides / Writing 工作区；全局 QuickPick；语音输入；Task Monitor。[QoderWork UI](https://docs.qoder.com/qoderwork/ui-overview) | hip 缺少全局快捷入口、语音、非代码文档工作区。 |

**差距结论**：hip 的 UI 更接近"带文件面板的聊天工具"，而竞品已演进为"多模式任务工作台"。

### 3.2 Agent 架构与编排

| 竞品 | Agent 编排方式 |
|---|---|
| **hip** | LangGraph 单循环 + Supervisor → Planner → Coder → Reviewer 的 prompt 顺序委托。`task` 子代理最大 10 并发，深度为 1。[`graph.ts:478-492`](../packages/sidecar/src/session/graph.ts) |
| **Claude** | Claude Code 交互循环 + Cowork 本地 VM 自主代理 + Subagents / Agent teams + Routines（云端调度）。[Cowork architecture](https://support.anthropic.com/en/articles/14479288-claude-cowork-desktop-architecture-overview) |
| **Codex** | 线程即代理；用户可 spawn 子代理；自定义 TOML agent；`max_threads`/`max_depth` 并发守卫；Git worktree 作为隔离单元。[Subagents](https://developers.openai.com/codex/subagents) |
| **Trae** | Orchestrator / Architecture / Development / QA / DevOps 分层团队；/plan、/spec、SubAgent。[TreeRouter review](https://api.treerouter.ai/en/blog/bytedance-trae-2-0-ai-ide-multi-agent-review) |
| **Qoder** | Quest Agent Mode；Experts Mode（Lead + Researcher + FSE + QA + Reviewer + UI Operator + Debug Engineer）并行。[Experts Mode](https://docs.qoder.com/user-guide/quest/experts-mode) |

**差距结论**：hip 的流水线是隐式、顺序、单深度的；竞品普遍提供**显式角色定义、并行子代理、review gate、worktree/VM 隔离**。如果 hip 要支持复杂工程任务，需要从"prompt 委托"升级到"结构化 DAG/团队编排"。

### 3.3 上下文、检索与记忆

| 竞品 | 关键能力 |
|---|---|
| **hip** | SQLite 消息历史 + FTS；Skills 作为 prompt 注入；无 embedding/RAG。 |
| **Claude** | Projects + 自动 RAG；Memory summaries；搜索历史会话；@ mentions。[Projects](https://support.anthropic.com/en/articles/9517075-what-are-projects) |
| **Codex** | `AGENTS.md`；Memories；web search；skills references；MCP resources。[Memories](https://developers.openai.com/codex/memories) |
| **Trae** | 上下文工程：需求文档 + spec + repo + 链接的多模态合成。[aibase](https://news.aibase.com/news/23105) |
| **Qoder** | Awareness memory：`SOUL.md` / `AGENTS.md` / `USER.md` / `MEMORY.md`；Repo Wiki 解析 10 万文件。[Awareness](https://docs.qoder.com/qoderwork/memory) |

**差距结论**：上下文是 Agent 质量的放大器。hip 目前只有会话级历史，缺少**项目级 RAG、跨会话记忆、in-repo 指导文件（AGENTS.md 类）**。Codex/Qoder 已将 `AGENTS.md` 等文件作为生态标准。

### 3.4 扩展性（Skills / MCP / Plugins / Marketplace）

| 竞品 | 扩展模型 |
|---|---|
| **hip** | Skills（Markdown 文件夹）、Plugins（.plugin/plugin.json）、MCP（stdio/SSE/HTTP）、外部 agents。[Skills.rs](../src-tauri/src/skills.rs) |
| **Claude** | MCP + `.mcpb` Desktop Extensions（一键安装、OS keychain 密钥）+ Skills/Hooks/Plugins marketplace。[Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions) |
| **Codex** | Skills + Plugins + MCP + Hooks + Custom agents + App Server。[Plugins](https://developers.openai.com/codex/plugins) |
| **Trae** | Skills + MCP + VS Code 扩展生态。[we0.ai](https://we0.ai/articles/trae-work-ai-office-platform-analysis) |
| **Qoder** | Skills + Expert Kits + Connectors（OAuth MCP）+ Workbench + Hooks。[Expert Kits](https://docs.qoder.com/qoderwork/expert-kits) |

**差距结论**：hip 的扩展点数量不少，但**缺少一键分发/发现机制**（如 `.mcpb`、marketplace、Expert Kits）。MCP stdio 命令还限制在 `/usr/bin`、`/usr/local/bin`、`/opt`、`~/.hip/bin`，安装门槛较高。

### 3.5 安全与权限模型

| 竞品 | 安全模型 |
|---|---|
| **hip** | `chat`/`edit`/`full` 三档；HITL 审批；API key 明文 `auth.json`（`0600`）。[`auth.rs`](../src-tauri/src/auth.rs) |
| **Claude** | 默认只读；审批模式；`/sandbox`；Cowork 本地 VM；企业 MDM/OpenTelemetry/SIEM。[Security](https://code.claude.com/docs/en/security) |
| **Codex** | OS 级沙箱（Seatbelt / bubblewrap / Windows custom sandbox）；默认拒绝网络；approval policies。[Windows sandbox](https://openai.com/index/building-codex-windows-sandbox/) |
| **Trae** | 沙箱、命令黑名单、MCP 白名单、审计日志。[we0.ai](https://we0.ai/articles/trae-work-ai-office-platform-analysis) |
| **Qoder** | 8 层权限规则栈；`default` → `accept_edits` → `auto` → `yolo`；protected paths；Bash/MCP 规则；Hook 可覆盖权限模式；Seatbelt/bubblewrap/Windows sandbox。[Permissions](https://docs.qoder.com/en/cli/permissions) |

**差距结论**：hip 的权限模型在消费级原型中可接受，但与企业/敏感场景竞品相比差距明显。OS 级沙箱、细粒度规则栈、Hook 策略覆盖都是后续必经工程。

### 3.6 协作、同步与远程控制

| 竞品 | 协作/同步 |
|---|---|
| **hip** | 纯本地；无团队空间、无导出、无同步。 |
| **Claude** | Team/Enterprise Projects、共享知识库、Org plugin marketplace。[Projects](https://support.anthropic.com/en/articles/9517075-what-are-projects) |
| **Codex** | Team skills、marketplace、GitHub PR review、Linear/Slack、远程连接、手机审批。[Remote connections](https://developers.openai.com/codex/remote-connections) |
| **Trae** | 云同步 Workspace、评论、版本、团队并发任务。[TRAE Work](https://www.trae.ai/work) |
| **Qoder** | Skill 分享链接、Expert Kits、Teams、IM Channels（钉钉/飞书/企微/微信）。[Expert Kits](https://docs.qoder.com/qoderwork/expert-kits) |

**差距结论**：hip 目前完全没有协作层。如果目标用户是团队/企业，这是最大准入门槛。

### 3.7 桌面集成与非代码能力

| 竞品 | 桌面级能力 |
|---|---|
| **hip** | Tauri 窗口 + sidecar；文件/脚本/Git 工具；无 GUI 自动化。 |
| **Claude** | 浏览器 Native Messaging、远程控制、SSH、手机端。[Claude Code Overview](https://docs.anthropic.com/en/docs/claude-code/overview) |
| **Codex** | Computer Use、Chrome 扩展、Appshots、浮动窗口、语音、远程连接。[Codex app](https://developers.openai.com/codex/app) |
| **Trae** | 桌面/Web/Mobile 三端；Design Mode；Cloud execution。 |
| **Qoder** | Computer Use（辅助功能/录屏）、浏览器连接器、语音、QuickPick。[Computer Use](https://docs.qoder.com/qoderwork/computer-use) |

**差距结论**：hip 仍聚焦"代码代理"。若要与 Work 类产品竞争，必须拓展到**浏览器自动化、桌面 GUI 控制、语音/全局入口**。

---

## 4. 核心差距矩阵

| 维度 | hip | 竞品平均水平 | 差距等级 |
|---|---|---|---|
| 多模式工作台 UI | ⭐⭐ | ⭐⭐⭐⭐⭐ | **高** |
| Agent 编排（DAG/并行/团队） | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **高** |
| 向量检索 / RAG / 长期记忆 | ⭐ | ⭐⭐⭐⭐ | **高** |
| 安全沙箱与细粒度权限 | ⭐⭐ | ⭐⭐⭐⭐⭐ | **高** |
| 扩展分发 / Marketplace | ⭐⭐⭐ | ⭐⭐⭐⭐ | 中 |
| 协作 / 同步 / 团队 | ⭐ | ⭐⭐⭐⭐ | **高** |
| 非代码/Computer Use 能力 | ⭐ | ⭐⭐⭐⭐ | **高** |
| 跨端 / 远程控制 | ⭐ | ⭐⭐⭐⭐ | 中-高 |
| 项目级 in-repo 指导文件 | ⭐⭐ | ⭐⭐⭐⭐⭐ | 中 |
| Git worktree / 隔离执行 | ⭐⭐ | ⭐⭐⭐⭐ | 中 |

*注：星级为相对竞品平均水平的主观评估，用于快速定位优先级。*

---

## 5. 补强优先级建议

### P0 — 决定产品定位前必须先补齐

1. **明确 hip 是"Code-first workbench"还是"General workbench"**。Trae/Qoder/Claude Cowork 都走向通用工作，Codex 仍偏代码。定位不同，后续投入差异巨大。
2. **升级 Agent 编排**：把 Supervisor→Planner→Coder→Reviewer 从 prompt 委托升级为可配置 DAG/团队。参考 Codex 的 `max_threads`/`max_depth`、Qoder 的 Experts Mode。
3. **引入项目级检索与记忆**：最低成本方案是本地 embedding + 向量库（如 `sqlite-vec` 或 LanceDB）+ `AGENTS.md` 自动加载。

### P1 — 6-12 个月内可显著缩小差距

4. **重构 UI 为分屏/多面板工作台**：chat + diff/editor + terminal + preview 至少四面板可拖拽，参考 Claude Desktop。
5. **加强安全模型**：OS keychain 存储 API key；细粒度规则引擎（文件路径、命令、MCP 工具）；危险命令 Hook 拦截。
6. **扩展分发层**：统一 Skill/Plugin/Connector 包格式，提供一键安装/发现 UI（类似 `.mcpb` 或 Expert Kits）。
7. **Git worktree 隔离**：为并行子代理或实验性任务自动创建 worktree，降低冲突风险。

### P2 — 中长期差异化

8. **Computer Use / 浏览器连接器**：如果做通用 workbench，这是必备能力。
9. **团队协作空间**：会话/知识库/技能共享；IM 通道集成。
10. **跨端/远程控制**：手机审批、SSH host、云端 Routine。

---

## 6. 参考文件

- hip 自架构研究：[`2026-07-05-hip-self-architecture.md`](./2026-07-05-hip-self-architecture.md)
- Trae Work 研究：[`2026-07-05-trae-work.md`](./2026-07-05-trae-work.md)
- Claude Desktop 研究：[`2026-07-05-claude-desktop.md`](./2026-07-05-claude-desktop.md)
- Codex Desktop 研究：[`2026-07-05-codex-desktop.md`](./2026-07-05-codex-desktop.md)
- Qoder Work 研究：[`2026-07-05-qoder-work.md`](./2026-07-05-qoder-work.md)

---

*本报告基于公开文档与本地代码分析，未做 live 产品测试。功能描述可能随竞品更新而变化，建议每季度复核一次。*
