# Hip 升级决策简报

| Field | Value |
|-------|-------|
| **Title** | hip 相对 Orca 的升级方向 — 决策用一页纸 |
| **Date** | 2026-07-17 |
| **Status** | Decision brief — 待产品拍板 |
| **对照对象** | `/Users/lijiamin/data/code-repository/github/orca`（Orca，Electron 并行 Agent IDE） |
| **详读** | [01 路线图](./01-roadmap.md) · [02 方案](./02-schemes.md) · [附录对照表](./appendix-capability-matrix.md) |

---

## §0 三十秒

**hip 是什么：** 自带 LangGraph 运行时的桌面 AI 工作台（Tauri + React + Node sidecar）。  
**Orca 是什么：** 托管外部 CLI agent（Claude Code / Codex / …）的并行 IDE + 远程 + 移动端。

**不要做的事：** 把 hip 改造成第二个 Orca（Electron 壳 + 纯 PTY 宿主 + 海量 vendor 适配）。  
**要做的事：** 用 Orca 验证过的「并行 / 终端 / 远程 / 集成 / 可脚本化」补齐 **工作流面**；用 memory、plan、eval、工具 jail 继续拉大 **智能面**。

---

## §1 三个战略选项（互斥主叙事）

| 选项 | 主叙事 | 12 个月长什么样 | 风险 |
|------|--------|-----------------|------|
| **A. Parallel Studio**（推荐主线） | 一 prompt → 多 worktree 多 agent → 对比合并 | 并行编码是默认体验；CLI 可脚本化 | 与 Orca 正面竞争叙事 |
| **B. Smart Loop First** | 极致内生 agent 质量 + eval 门禁 | 单会话最强；并行/远程偏弱 | 工作流面落后，留不住「IDE 型」用户 |
| **C. Orchestrator Shell** | 全面跟 Orca：多 CLI + SSH + mobile | 像 Orca 的 Tauri 版 | 放弃差异化；体量爆炸 |

### 推荐（作者建议）

**主选 A，用 B 的质量体系托底，明确拒绝 C 作为主叙事。**

| 决策项 | 建议 | 理由 |
|--------|------|------|
| 主叙事 | **A Parallel Studio** | Orca 证明「并行 worktree」是刚需；hip 已有 worktree API / background-worktree，缺的是产品面 |
| 质量底线 | **保留 B 的 eval / plan / jail** | 这是 hip 相对 Orca 的护城河，不可为并行砍掉 |
| 外部 CLI agent | **ACP 作 worker，不作唯一大脑** | 补生态即可，不写 Orca 级 vendor 矩阵 |
| 远程 / mobile | **P1 远程 sidecar；P2 companion** | 长任务有价值，但依赖并行与事件流先稳 |
| 浏览器 Design Mode | **P1** | 前端改 UI 闭环，ROI 高于 Computer Use |
| Computer Use | **P2 或 defer** | 权限/原生成本高，Design Mode 先吃 80% |
| 技术栈 | **保持 Tauri + sidecar** | 不迁 Electron；relay/daemon 按需加进程，不换壳 |

---

## §2 阶段取舍（一句话）

| 阶段 | 窗口（参考） | 交付主题 | 成功标准（可验收） |
|------|--------------|----------|--------------------|
| **P0** | 约 12 周 | 并行 Worktree + 终端工作面 + 产品 CLI + Diff 批注 | 一句话起 3 隔离 agent；终端/diff 可回灌；`hip` 可脚本 session/worktree |
| **P1** | +1 季度 | Design Mode + SSH 远程 + GitHub 任务入口 + ACP 体验 | 不离开 hip 完成「看 UI → 改 → 测」；大仓可远程跑 |
| **P2** | +半年 | Companion / Automations / 分发 / Computer Use（可选） | 长任务可离桌感知；发布与更新产品化 |

非目标清单见 [01-roadmap §4](./01-roadmap.md#4-非目标non-goals)。

---

## §3 你需要拍板的问题

请直接回复选项字母 / 勾选，便于后续写 PR 计划：

1. **主叙事**  
   - [ ] A Parallel Studio（推荐）  
   - [ ] B Smart Loop First  
   - [ ] C Orchestrator Shell  
   - [ ] 混合：________

2. **P0 范围**（可多选；推荐全选前四）  
   - [ ] A1 并行 Worktree Studio  
   - [ ] A2 终端工作面  
   - [ ] A3 产品级 CLI  
   - [ ] A4 Diff 批注回灌  
   - [ ] 砍掉：________ / 加入：________

3. **外部 CLI agent 策略**  
   - [ ] 仅强化 ACP + 少量 preset（推荐）  
   - [ ] 对标 Orca 做宽 vendor 适配  
   - [ ] 暂不做外部 agent，只做 internal

4. **远程形态（P1）**  
   - [ ] 远程第二 sidecar（推荐，与现架构同构）  
   - [ ] 仅远程 PTY，文件仍本地  
   - [ ] 完整 relay（类 Orca，成本最高）  
   - [ ] P1 不做远程

5. **Mobile**  
   - [ ] P2 再做（推荐）  
   - [ ] P1 做 Web/PWA 通知  
   - [ ] 明确不做

6. **资源约束**（影响切 PR 密度）  
   - [ ] 单人 / 小团队：严格 P0 四项，其余 defer  
   - [ ] 可并行 2 条线：P0 产品 + eval 质量  
   - [ ] 其他：________

---

## §4 作者建议汇总（可直接当默认决议）

若你希望「默认全开推荐、少开会」：

```text
主叙事     = A Parallel Studio
质量底线   = 能力矩阵 eval 持续为门禁（B 的内核）
P0         = Worktree 并行 + 终端 + 产品 CLI + Diff 批注
外部 agent = ACP worker 模式，不做 vendor 矩阵
远程       = P1 远程 sidecar
Mobile     = P2
Computer Use = defer，直到 Design Mode 落地并验证需求
栈         = Tauri + sidecar 不变
```

拍板后：用 [01-roadmap](./01-roadmap.md) 拆里程碑，用 [02-schemes](./02-schemes.md) 起详细 design / PR。
