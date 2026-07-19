# hip

hip 是一款**桌面 AI 工作台**（Tauri 壳 + React UI + Node sidecar），产品版本 **{{HIP_PRODUCT_VERSION}}**。每个 UI 标签页是独立会话。默认产品回路是 **Supervisor ReAct** 智能体：用工具完成工作，并可通过 `task` / `dispatch_agent` / `task_batch` 委派——普通轮次**不会**强制 Planner → Coder → Reviewer 流水线。

本技能是 *hip 产品本身* 的权威指南。用户项目中的普通编码任务**不要**加载本技能。

用**用户的语言**回答产品问题（例如用户用中文提问则用中文答），但配置路径与标识符请保持原文准确。

## 渐进式披露

- **Level 1**（系统提示 Skills 列表）：仅名称 + 描述
- **Level 2**（本文件）：下方概览，通过 `use_skill({ name: "hip" })` 加载
- **Level 3**：`references/` 中的深入主题——需要时用 `read_file` 读绝对路径

若某产品细节未写在此处，请如实说明，不要编造 UI 文案或配置键。

## 界面（Surfaces）

| 界面 | 用途 |
|------|------|
| **Code** | 项目工作台：文件工具、git 指导、MCP 目录、完整智能体工具 |
| **Chat** | 更轻的会话面：更短提示、无 git 提交指导；可预览交付物（`page.html`、`notes.md`、SVG 等）请 `write_file` 到工作区以便工件面板展示 |

界面在 UI 中选择；系统提示会反映当前界面。

## 权限模式

| 模式 | 效果 |
|------|------|
| **edit**（默认） | 文件系统工具限制在项目根沙箱内 |
| **chat** | 只读：不能写/改文件，不能跑脚本 |
| **full** | 未沙箱的文件系统（用户明确授权）；优先绝对路径 |

edit/chat 下的路径约定：以 `/` 开头的项目根相对形式（如 `/src/index.ts` 映射到 `<cwd>/src/index.ts`）。不要发明 shell 工具名——有则用 `run_script`。

## 设置（桌面 UI）

常见入口（具体文案可能随 UI 微调）：

- **提供商 / API 密钥** — 明文保存在 `~/.hip/config/auth.json`（按设计为 0600）
- **记忆** — 跨会话记忆**默认关闭**；在 设置 → 记忆 开启（见 `references/memory.md`）
- **技能** — 启用/禁用已安装技能（`hip.toml` + 技能目录）
- **插件** — 安装/启用插件（技能、智能体、MCP、钩子）
- **智能体** — 固定配置（supervisor / plan / explore / coder）与自定义内部或外部智能体
- **网络策略** — 可选的出站工具允许/拒绝

## 技能、插件、MCP

- **技能**：Claude 格式 `SKILL.md` 文件夹。全局：`~/.hip/skills/<id>/`。项目：`.hip/skills/<id>/`。渐进披露：L1 元数据 → `use_skill` 正文 → `references/` + `assets/`。
- **插件**：位于 `~/.hip/plugins/`；可贡献技能、智能体、MCP 与钩子。见 `references/agents-and-plugins.md`。
- **MCP**：配置的服务器暴露工具。Code 面系统提示可能列出目录；用 `mcp_search` 查找，再调用 `mcp__<server>__<tool>`。

## 智能体与委派

- 默认会话智能体决定何时用工具或委派。
- 有专用花名册时优先：**explore**（只读搜索）、**plan**（仅设计）、**coder**（带脚本实现）。
- 多个独立子任务 → 一次 `task_batch`（不要顺序多个 `dispatch_agent`）。
- 显式工作流 / 多智能体 handoff **不是**普通产品路径。
- 深入：`references/agents-and-plugins.md`。

## CLI（`@hip/cli`）

仅附着到**已运行**的 hip 应用（共享 sidecar 与 `~/.hip` 数据）。不会启动产品 sidecar。

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

应用未运行时 CLI 失败并返回 `APP_NOT_RUNNING`。

## 项目指导文件

项目中若存在 `AGENTS.md` / `Claude.md` / `.hip` 配置等，hip 可能注入。**项目**约定优先遵循那些文件；本技能描述**产品**行为。

## Level 3 参考

加载本技能后，`use_skill` 会返回绝对路径。需要深度时：

- 记忆启用、注入、抽取、隐私 → `references/memory.md`
- 本地数据布局、配置、环境变量 → `references/config-and-data.md`
- 常见故障（无密钥、CLI 未运行、记忆为空） → `references/troubleshooting.md`
- 智能体、插件、MCP → `references/agents-and-plugins.md`
