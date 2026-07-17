# 附录：hip ↔ Orca 能力对照

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Purpose** | 决策与路线图的依据表；非实现任务列表 |
| **主文档** | [00 决策](./00-decision-brief.md) · [01 路线图](./01-roadmap.md) · [02 方案](./02-schemes.md) |

**图例**

| 符号 | 含义 |
|------|------|
| ● | 产品级可用 / 深度实现 |
| ◐ | 有底座或部分实现 |
| ○ | 无或可忽略 |
| →Px | 建议升级落入的阶段 |

---

## 1. 产品与架构

| 能力 | hip | Orca | 对 hip 的含义 |
|------|-----|------|----------------|
| 桌面壳 | Tauri ● | Electron ● | 保持 Tauri |
| 内生 Agent 运行时 | LangGraph ReAct ● | ○（外挂为主） | **护城河，加深** |
| 外部 CLI Agent | ACP ◐ | 广覆盖 ● | →P1 worker 体验，不做全矩阵 |
| 多 session | ● | ● | 已有 |
| 并行 worktree 产品面 | ◐ API | ● 主叙事 | →**P0** |
| 编排 / DAG | ● orchestrator | ● orchestration CLI | 对齐状态可视化，勿双栈 |
| Plan / HITL | ● | ◐（视 agent） | 保持优势 |
| Memory | ● | ○/弱 | 保持优势 |
| Knowledge wiki | ● | ○ | 保持优势 |
| Skills / Plugins / MCP | ● | ● skills | 持续 |
| 能力 eval 矩阵 | ● UI-first | 偏 e2e/perf | **门禁保留** |
| Headless CLI | ◐ harness | ● 产品脚本 | →**P0** |
| Mobile companion | ○ | ● | →P2 |
| SSH 远程 | ○ | ● | →P1 |
| 嵌入浏览器 / Design Mode | ○ | ● | →P1 |
| Computer Use | ○ | ● | →P2 / defer |
| GitHub/Linear 原生 | ○ | ● | →P1 GitHub；Linear MCP |
| Diff 批注回灌 | ◐ diff UI | ● | →**P0** |
| 终端 IDE 级 | ◐ 基础 xterm | ● | →**P0** |
| 自动更新 / 分发 | ◐ 开发构建 | ● | →P2 |
| 多语言 / 本地化工程 | ◐ i18n | ● 审计流水线 | 渐进 |
| 可靠性 gates / perf bench | ◐ | ● | 贯穿引入 |

---

## 2. hip 工具面（sidecar）vs Orca 控制面

| hip 内生工具（示例） | Orca 侧近似 |
|----------------------|-------------|
| read/write/edit/ls/glob/grep | 各 CLI agent 自带 + 文件面板 |
| run_script | 终端 / orca terminal |
| git / worktree tools | orca worktree |
| task / dispatch / task_batch | orchestration dispatch |
| enter/exit plan mode | 视 agent；Orca 偏终端内 plan |
| use_skill / plugin_install | bundled skills + guides |
| web_search / web_fetch | 浏览器 + 搜索 |
| media | 附件 / 拖拽 |

结论：hip **工具闭环更完整**；Orca **宿主与远程/浏览器更完整**。

---

## 3. 升级主题优先级总表

| 主题 | 用户价值 | 架构契合 | 成本 | 阶段 | Scheme |
|------|----------|----------|------|------|--------|
| Worktree Studio | 5 | 5 | 中 | **P0** | A |
| 终端工作面 | 5 | 4 | 中高 | **P0** | B |
| 产品 CLI | 4 | 5 | 中 | **P0** | C |
| Diff 批注 | 4 | 5 | 低中 | **P0** | D |
| Design Mode | 4 | 4 | 中 | P1 | E |
| 远程 sidecar | 4 | 3 | 高 | P1 | F |
| GitHub 任务入口 | 4 | 4 | 中 | P1 | G |
| ACP worker 体验 | 3 | 4 | 中 | P1 | H |
| 通知 / companion | 3 | 2 | 高 | P2 | I |
| Automations | 3 | 4 | 中 | P2 | J |
| 分发更新 | 3 | 4 | 中 | P2 | K |
| Computer Use | 2 | 2 | 很高 | P2/defer | L |

---

## 4. 代码体量直觉（规划时心理预期）

| 区域 | 量级（约） | 含义 |
|------|------------|------|
| hip UI + sidecar + protocol | 较小，可快速迭代 | 适合 P0 聚焦 4 主题 |
| Orca main + renderer + shared + mobile | 大一个数量级 | 勿试图「功能清单对齐」 |

升级成功 ≠ 功能数追上 Orca；= **选定叙事上体验打穿 + 智能面持续领先**。

---

## 5. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-17 | 初版：对照本地 Orca 树与 hip 协议/sidecar/UI |
