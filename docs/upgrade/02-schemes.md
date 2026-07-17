# Hip 升级方案（详案）

| Field | Value |
|-------|-------|
| **Title** | 各升级主题的方案说明（架构、MVP、验收、非目标） |
| **Date** | 2026-07-17 |
| **Status** | Schemes — 实现前可再拆独立 design spec |
| **Depends on** | [00 决策](./00-decision-brief.md) · [01 路线图](./01-roadmap.md) |
| **Reading guide** | 按主题跳转；每节自洽：**问题 → 方案 → MVP → 协议/UI → 验收 → 非目标 → 风险** |

---

## 目录

| Scheme | 阶段 | 标题 |
|--------|------|------|
| [A](#scheme-a-worktree-studio) | P0 | Worktree Studio（并行隔离） |
| [B](#scheme-b-terminal-surface) | P0 | 终端工作面 |
| [C](#scheme-c-product-cli) | P0 | 产品级 CLI |
| [D](#scheme-d-diff-annotate) | P0 | Diff 批注回灌 |
| [E](#scheme-e-design-mode) | P1 | Design Mode（浏览器点选） |
| [F](#scheme-f-remote-runtime) | P1 | 远程运行时 |
| [G](#scheme-g-task-integrations) | P1 | 任务源集成（GitHub 优先） |
| [H](#scheme-h-acp-workers) | P1 | ACP 外部 worker 体验 |
| [I](#scheme-i-companion) | P2 | Companion / 通知 |
| [J](#scheme-j-automations) | P2 | Automations / Headless |
| [K](#scheme-k-distribution) | P2 | 分发与更新 |
| [L](#scheme-l-computer-use) | P2 | Computer Use（可选） |

**通用约束（所有 scheme）：**

- 栈：Tauri shell + React UI + Node sidecar；协议走 `@hip/protocol`。
- 安全默认：worktree 作业不写坏 primary tree；`permission_mode` 默认 `edit`。
- 不破坏现有单 session ReAct 路径；新能力 additive。
- 实现前若单 scheme > ~1 周，先写 `docs/design/YYYY-MM-DD-<topic>.md`。

---

## Scheme A — Worktree Studio

<a id="scheme-a-worktree-studio"></a>

### A.1 问题

Orca 的主打是「一 prompt 扇出多 agent，各 worktree 隔离」。hip 已有 `git:worktree:create|list|remove` 与 background-worktree，但产品叙事仍是单会话；用户难以对比多方案。

### A.2 方案概要

引入 **Parallel Run** 一等概念：

```text
ParallelRun
  ├── prompt / base branch / N
  ├── slots[]: { worktreePath, sessionId, agentKind, status, summary? }
  └── outcome: { selectedSlotId?, mergeStrategy? }
```

- 每个 slot = 独立 git worktree + 独立 hip session（cwd = worktree）。
- 内生 agent 默认；可选 slot 使用 ACP worker（P1 完整化）。
- 编排权威在 hip（状态机在 sidecar 或 UI+sidecar 协同），不是「用户手动开三个 tab」。

### A.3 架构要点

| 层 | 职责 |
|----|------|
| UI | 扇出对话框、slot 卡片、状态点、compare 视图、选赢家 |
| Protocol | `parallel:create` / `parallel:status` / `parallel:select`（名称可调整）；或复用 session 批量 API |
| Sidecar | worktree 创建/清理、session 生命周期、聚合 status、安全删除 preflight |
| Git | `git worktree add`；合并策略 v1 以「展示 diff + 用户/agent 在选定 worktree 继续」为主 |

**与现有 orchestrator：**  
DAG workflow 仍服务「显式 workflow def」。Parallel Run 是 **产品级扇出**，不要强行塞进 DAG 除非已有节点语义天然匹配。可共享 status/事件模型。

### A.4 MVP（P0）

1. Composer：「并行运行」→ 选 N（2–5）、base ref、是否共用同一 prompt。  
2. 创建 N worktree + N session，自动 `message:send`。  
3. 侧栏 Parallel 组：status = `running | awaiting_user | done | failed | stopped`。  
4. 点击 slot 进入该 session；结束可看 `fs:diffSummary`。  
5. 「采用此方案」：标记 selected；可选打开该 worktree 为 primary 继续聊（v1 不做自动 merge 到主分支）。  
6. 清理：一键 remove 未选 worktree（preflight：未提交提醒）。

### A.5 验收

| # | 标准 |
|---|------|
| 1 | 真实 git 仓库 dogfood：N=3 扇出，三路 cwd 互不覆盖 |
| 2 | 主工作树在全程 `git status` 无 agent 污染（eval 可自动化） |
| 3 | 删除 unselected worktree 成功且无残留 gitdir 孤儿（至少测常见路径） |
| 4 | UI 与 CLI（Scheme C）均能列出 parallel/slots |

### A.6 非目标（P0）

- 自动 merge / 自动开 PR  
- 跨 slot 实时共享 blackboard（可后置）  
- 五模型 vendor 矩阵  

### A.7 风险

| 风险 | 缓解 |
|------|------|
| 磁盘与 worktree 泄漏 | TTL 清理、上限 N、设置页「清理孤立 worktree」 |
| 扇出费用（多 LLM） | 默认 N=2；UI 显示预估 |
| 状态机与 session 双源 | slot.sessionId 为唯一权威；UI 不另造运行时 |

---

## Scheme B — 终端工作面

<a id="scheme-b-terminal-surface"></a>

### B.1 问题

Orca 以 Ghostty 级终端为中心；hip 终端偏 artifact 附属，难支撑「看测试输出 → 再指挥 agent」。

### B.2 方案概要

把 Terminal 提升为 **session-scoped 工作面**：

- 每 session ≥1 个 PTY，cwd = session cwd。  
- 生命周期：session 切换不丢 scrollback（进程可 park，不必杀）。  
- 交互：路径可点；选中输出「添加到 Composer」；失败命令快捷「请修复」。

### B.3 架构要点

| 层 | 职责 |
|----|------|
| UI | Terminal panel、与 chat 分栏、主题沿用现有 |
| Tauri / sidecar | PTY 归属：优先 sidecar 管 PTY（与工具 `run_script` 环境一致）；若已在 Tauri 侧，明确单一权威 |
| Protocol | `term:open|write|resize|close|list` + 输出流（若尚未统一） |

**与 `run_script`：** agent 工具输出仍走 tool 卡片；用户交互式 shell 走 Terminal。两者 cwd/jail 策略对齐。

### B.4 MVP（P0）

1. Session 绑定单 PTY；重启 session 可新 shell。  
2. Fit/resize；基础 scrollback 内存保留（持久化可 P0.5）。  
3. OSC/路径启发式：绝对路径点击 → 打开文件预览。  
4. 「Send selection to chat」。  

### B.5 验收

- 切换 session A/B 再回 A，scrollback 仍在（同进程寿命内）。  
- 在 terminal 跑测试失败 → 一键进 Composer 带上下文。  
- 不出现「工具 jail 在 root A、shell 在 root B」的错绑。

### B.6 非目标（P0）

- WebGL / 无限 split / 浮动终端位置持久化（Orca 级）  
- 远程 PTY（归 Scheme F）  

---

## Scheme C — 产品级 CLI

<a id="scheme-c-product-cli"></a>

### C.1 问题

`@hip/cli` 偏 harness（`run` / `doctor`）。Orca 的 `orca worktree|orchestration|browser` 让 **agent 也能驱动产品**。hip 需要同等「控制面」。

### C.2 方案概要

扩展 CLI 为 **同一 sidecar 协议的 headless 客户端**：

```text
hip doctor
hip config auth-status
hip session create|list|send|status|cancel
hip worktree create|list|remove
hip parallel create|status   # 可选，依赖 A
hip permission respond
hip diff summary
hip run …                   # 保留 harness
```

### C.3 架构要点

- 复用 packages/cli 的 connect / turn-runner。  
- 机器可读：`--json`；人读：默认 stream text/tools。  
- 退出码：成功 / HITL 待处理 / 错误 分档（与现有 STATUS_EXIT 对齐扩展）。  
- 隔离：`HIP_*` env 与用户 `~/.hip` 策略文档化（dogfood vs harness）。

### C.4 MVP（P0）

1. `session create --cwd --json` → sessionId  
2. `session send <id> "…"` → 等待 complete 或 HITL  
3. `worktree create --branch --json`  
4. `doctor` 保持  

### C.5 验收

- 无 Tauri 窗口完成「create worktree session + 一轮 turn」。  
- CI 可用（无 key 时 preflight 清晰，不泄密）。  
- 与 UI 创建的 session 可互相 list（同一 sidecar/db）。

### C.6 非目标

- 完整浏览器自动化 CLI（P1+ Design Mode 后再说）  
- 兼容 Orca CLI 旗标  

---

## Scheme D — Diff 批注回灌

<a id="scheme-d-diff-annotate"></a>

### D.1 问题

Review 是并行后的关键一步。Orca「annotate AI diff」把行评注送回 agent；hip 有 ChangesView，缺结构化回灌。

### D.2 方案概要

```text
用户在 Diff 行选区添加 comment
  → 本地 draft annotations[]
  → 「发送给 Agent」打包为 context fragment / 下一条 user message 附件
  → agent 按批注修改
```

### D.3 数据形状（建议）

```ts
type DiffAnnotation = {
  id: string
  path: string
  side: 'old' | 'new'
  startLine: number
  endLine: number
  body: string
  createdAt: number
}
```

注入格式：稳定、可解析的 Markdown 或 JSON fence，便于模型与测试。

### D.4 MVP（P0）

1. ChangesView 行级添加/删除批注。  
2. Composer 显示「N 条 diff 批注」chip。  
3. Send 时自动附带；发送后可选清空。  

### D.5 验收

- e2e 或组件测：批注出现在 outbound message。  
- dogfood：批注「改函数名」后 agent 改对路径。  

### D.6 非目标

- PR 远程 review 同步（GitHub review API）  
- 与 Linear 评论互通  

---

## Scheme E — Design Mode

<a id="scheme-e-design-mode"></a>

### E.1 问题

前端改 UI 需要「看到真页面」。Orca Design Mode：点元素 → HTML/CSS/截图进 prompt。hip 仅有 web_search/fetch。

### E.2 方案概要

**MVP 用 Tauri webview 或系统浏览器 + 扩展桥，优先实现「捕获」而非完整自动化。**

```text
Preview URL
  → 用户点选元素
  → 收集: selector, outerHTML 截断, computed 关键样式, 截图 crop
  → 作为 attachment 进入 Composer / message:send
```

P1.5 再考虑 agent 工具：`browser_snapshot` / 有限 click（安全策略单独设计）。

### E.3 架构选项

| 选项 | 优点 | 缺点 | 建议 |
|------|------|------|------|
| Tauri webview + 注入脚本 | 集成紧 | 自动化能力弱 | **MVP** |
| 嵌入 Chromium（重） | 强 | 体积/维护 | 后置 |
| 外部 Chrome + CDP | 强 | 用户安装负担 | 可选 advanced |

### E.4 MVP（P1）

1. 「打开预览」输入 URL（localhost 优先）。  
2. Design Mode 开关；点选高亮。  
3. 「添加到对话」生成 attachment。  
4. 权限：仅用户手势触发导航；不默认装证书破解。  

### E.5 验收

- 本地 dev server 页面点选按钮 → agent 收到 HTML 片段并改到对应源文件（dogfood）。  

### E.6 非目标（P1）

- 完整 Playwright 级站点爬取  
- 反检测 / Cookie 从系统浏览器大规模导入（Orca 级）  

---

## Scheme F — 远程运行时

<a id="scheme-f-remote-runtime"></a>

### F.1 问题

大仓/重构建需要远程算力。Orca：SSH worktree + relay。hip 需在 **不颠覆 sidecar 模型** 下给出路径。

### F.2 推荐形态：远程第二 Sidecar

```text
本地 UI ──WS──► 本地 sidecar（路由/会话元数据）
                    │
                    └──WS/SSH tunnel──► 远程 sidecar（工具/jail/PTY/worktree 在远端）
```

备选（更窄）：

- **仅远程 PTY**：文件工具仍本地 → 实现快但易「看的是远端、改的是本地」。  
- **完整 relay 二进制**：对标 Orca，成本最高，P2 再评。

### F.3 MVP（P1）

1. 配置 SSH host + remote hip/sidecar 启动方式。  
2. Session 标记 `runtime: remote`；工具在远端 root 执行。  
3. 断线：status 明确；可重连或 fail 干净。  
4. 密钥：使用系统 SSH agent；不把 API key 写进远程磁盘 unless 用户显式。  

### F.4 验收

- 远端改文件，本地 UI 看 diff/读文件一致。  
- 权限 jail 基于远端 root。  

### F.5 风险

- 延迟与大 diff 传输 → 摘要优先、按需拉文件。  
- 安全 → 远程 root allowlist；审计日志。  

---

## Scheme G — 任务源集成

<a id="scheme-g-task-integrations"></a>

### G.1 问题

Orca 内嵌 GitHub/Linear，减少 context switch。hip 应用「Issue → 工作区」缩短启动路径。

### G.2 方案概要

**GitHub 优先（只读列表 + 创建工作）：**

1. PAT / gh auth 配置。  
2. 侧栏 Issues/PRs（当前 repo remote 推断）。  
3. 「在 Worktree 中处理」→ Scheme A 单 slot 或普通 session，prompt 预填 issue body + 链接。  

Linear/Jira：优先 **MCP / plugin**，原生 UI 后置。

### G.3 MVP（P1）

- 当前 repo 的 open issues 列表 + 打开 session。  
- PR 只读标题列表（可选）。  

### G.4 验收

- 从 Issue 一键进入带上下文的 session；cwd/worktree 正确。  

### G.5 非目标

- 完整 PR review/merge UI（可链到浏览器）  
- 多 forge 一次做完  

---

## Scheme H — ACP 外部 Worker 体验

<a id="scheme-h-acp-workers"></a>

### H.1 问题

Orca 靠「能跑任何 CLI agent」获客。hip 有 ACP，但体验与并行 Studio 未拼成一体。

### H.2 方案概要

```text
策略：External agent = worker
      hip supervisor = 可选协调者（或用户直接并排）
```

- Parallel Run slot 可选 `agentKind: internal | acp:<id>`。  
- 统一状态点：running / need_input / done（映射 ACP 事件）。  
- Preset：Claude Code / Codex / OpenCode 等 **配置模板**，不是 fork 各自 runtime。  

### H.3 MVP（P1）

1. 设置页：启用 ACP agent + 探测 command 是否在 PATH。  
2. 并行扇出时可选「slot1=hip, slot2=acp:codex」。  
3. resume / 中断行为文档化。  

### H.4 非目标

- 为每个 vendor 复制 Orca `main/claude`、`main/codex` 业务逻辑树。  
- 账号切换器全矩阵（可后置 usage 显示）。  

---

## Scheme I — Companion / 通知

<a id="scheme-i-companion"></a>

### I.1 问题

长任务需要离桌感知。Orca mobile companion + 通知。

### I.2 方案分阶段

| 子阶段 | 内容 |
|--------|------|
| I0 | 桌面系统通知：`agent:finished` / `permission:request` |
| I1 | 本地 Web 控制台 / PWA：列表 session、只读 timeline、简单 reply |
| I2 | 原生 mobile + 配对（需 relay/鉴权） |

### I.3 MVP 建议

P2 先做 **I0 + I1**；I2 单独立项。

### I.4 安全

- 配对 token 短时；默认仅局域网或隧道；permission 响应需二次确认。  

---

## Scheme J — Automations / Headless

<a id="scheme-j-automations"></a>

### J.1 问题

定时跑 agent、CI 触发、无 UI 批处理。Orca automations + headless serve。

### J.2 方案概要

- 扩展现有 sidecar `cron` + Scheme C CLI。  
- `hip serve`：无 Tauri 长驻 sidecar，供 CI/远程。  
- Automation = { schedule | webhook, prompt template, cwd/worktree policy, notify }。  

### J.3 MVP（P2）

1. `hip serve` + CLI 全流程。  
2. 一个 cron 示例：每日 worktree 上跑固定 prompt。  

---

## Scheme K — 分发与更新

<a id="scheme-k-distribution"></a>

### K.1 问题

对内 dogfood 可以源码跑；对外需要签名、自动更新、安装体验。

### K.2 MVP（P2 / 随对外）

- Tauri updater + 签名流水线。  
- macOS/Windows/Linux 安装包；可选 brew cask。  
- 崩溃与版本信息（注意隐私）。  

### K.3 非目标

- 复制 Orca 全套 electron-builder 生态。  

---

## Scheme L — Computer Use（可选）

<a id="scheme-l-computer-use"></a>

### L.1 问题

桌面 UI 自动化。成本高（原生权限、可靠性、安全）。

### L.2 策略

**Defer 直到 Design Mode 不够用。**  
若做：最小 click/type/screenshot，限前台窗口，完整审计。

### L.3 非目标

- 对标 Orca 三端 native computer-use 完整度作为 P0/P1 目标。  

---

## 跨 Scheme 协议与数据（备忘）

实现时优先 **扩展现有消息**，避免平行世界：

| 概念 | 建议落点 |
|------|----------|
| ParallelRun | protocol 新类型 + sqlite 表或 session 元数据 |
| Terminal | 现有 terminalStore 升级 + protocol 流 |
| Annotations | 前端 draft + message 附件；可选持久化 per session |
| Remote | session config `runtime` 字段 |
| 通知 | 复用 `agent:notification` / finished 事件 |

---

## 实现检查清单（每个 scheme 开工前）

- [ ] 决策简报中该主题已批准进当前阶段  
- [ ] 成功标准可测（UI e2e 或 CLI 或 unit）  
- [ ] 安全：jail / 主仓 / 密钥  
- [ ] 兼容：旧 session 可加载  
- [ ] 文档：用户可见行为 + 非目标  
- [ ] Defer 项已登记，不静默膨胀范围  
