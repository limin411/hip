# Changes 面板改版 Spec v2（评审修订稿）

> 状态：草案 v2 · 2026-08-02  
> 基线：v1（`changes-panel-spec.md`）+ 外部案例评审（VS Code / GitHub Desktop / Zed / JetBrains Air / JetBrains Group with AI / Linear Diffs / Warp / Cursor / Claude Code）  
> 范围：项目场景右侧 Artifact 面板 ·「更改」tab  
> 相关实现：`ChangesView.tsx` / `DiffDisplay.tsx` / `diffStore.ts` / `uiStore.ts`

---

## 0. v2 修订摘要

v2 在 v1 基础上修正 9 处，全部来自评审发现或外部案例对照：

| # | 修订 | 来源 |
|---|------|------|
| R1 | 默认态统一：有未提交改动时提交区收起为 36px 标题条，预览同步展示 | v1 spec 与预览不一致 |
| R2 | 仅展开文件的行头吸顶；多开时按展开顺序堆叠，不再互相遮挡 | v1 sticky 实现缺陷 |
| R3 | 丢弃 = 文件副本先入回收站 + `git checkout`，语义固定为恢复到 HEAD | VS Code / GitHub Desktop |
| R4 | hunk 操作 hover 可见（复制 / 标注 / 引用），右键保留 | Warp / VS Code diff gutter |
| R5 | 「审查」定义结果落点：结构化报告回对话，prompt 内置红牌清单 | VS Code AI Code Review / GitHub 官方指南 |
| R6 | 最小键盘集：`j/k`、`space`、`⌘+Enter`、`Esc` | Zed Git 面板 |
| R7 | 窄栏同时压缩 toolbar（隐藏统计、并排入口置灰），toolbar 不换行 | v1 遗漏 |
| R8 | 新增「忽略空白」开关 | GitHub Desktop / Linear |
| R9 | 提交区数据范围改为仓库最近历史（`HEAD` 起最多 100 条），标题固定「最近提交」，不再按 session-start 过滤 | 用户反馈：git 项目应展示历史提交记录 |

## 1. 问题摘要

在 v1 P1–P7 基础上新增三项：

| # | 问题 | 影响 | v2 对策 |
|---|------|------|---------|
| P8 | 无键盘路径 | 审阅 → 下一步仍依赖鼠标长路径 | §5.9 最小键盘集 |
| P9 | 丢弃不可恢复，基线切换与丢弃语义未对齐 | 误操作丢数据；用户对「丢到哪」无预期 | §5.2 回收站 + 固定 HEAD 语义 |
| P10 | 审查结果落点未定义 | Phase C 验收模糊 | §5.8 结构化报告回对话 |

v1 的 P1–P7（jump-list 重复、3:2 固定比例、定位夹层、主操作藏右键、基线无 UI、提交不可点、窄栏并排不可用）沿用，对应对策不变。

## 2. 产品定位

同 v1：**会话工作区审阅板（Session Workspace Review）**，不是 VS Code Source Control。补充两点：

1. **审查 = 先让 agent 扫描，人做判断**。「审查」prompt 内置 agent PR 红牌清单：CI 弱化、代码复用盲区、幻觉正确性、边界条件、安全边界、测试证据（源自 GitHub 官方《Agent pull requests are everywhere》指南）。
2. **面板负责发起意图，闭环在对话**。v2 不引入行内编辑；但把「标注 hunk 给 agent」升级为可批量回交的反馈通道（Phase D，对齐 Warp / JetBrains Air）。

## 3. 信息架构

```
更改 tab
├── Toolbar
│   ├── 标题：未提交 · N    +a −d
│   ├── 基线：会话起点 | HEAD
│   └── 审查（主 CTA）· ⋯（统一/并排 · 忽略空白 · 全部折叠/展开 · 刷新）
├── File list（唯一列表，手风琴）
│   └── File row
│       ├── [M|A|D|R]  path    +n −m
│       ├── hover/选中：丢弃 · 打开 · ⋯
│       └── expanded → unified hunks（默认）
│           └── hunk 行 hover：复制 / 标注给 agent / 引用到输入框（右键保留全量）
└── Commits（默认收起标题条，可拖分隔）
    ├── 标题：最近提交 · K
    └── Commit row → 点击加载该 commit diff（替换或叠在列表区）
```

**删除**：独立 jump-list（`files.length > 1` 时顶部摘要条）。

## 4. 布局

### 4.1 比例与分隔

| 状态 | 未提交区 | 提交区 |
|------|----------|--------|
| 有未提交改动 | `1fr`（优先） | **默认收起 ~36px 标题条**；用户可展开；记忆高度 |
| 无未提交、有提交 | 空状态紧凑（~120px） | 自动占满 |
| 两边皆空 | 居中空状态 | 隐藏 |

- 中间可拖拽分隔条（min 未提交 160px / min 提交标题 36px）；比例写入 `uiStore`（全局 + 本次展开态）。

### 4.2 吸顶规则（R2）

- 仅**展开文件**的行头吸顶；收起文件的行头不吸顶。
- 多开时按展开顺序堆叠：后一行 `top` 偏移 = 前序展开行高度之和（渲染后计算 sticky offset）。
- 展开行背景 `--bg-subtle`；堆叠边界用 1px `--border` 分隔。

### 4.3 窄栏约束（R7）

- 右栏 < 420px：并排入口隐藏（菜单置灰 + tooltip「面板过窄」）；toolbar 隐藏 `+a −d` 统计；基线分段与「审查」保留；文件状态单字母。
- toolbar 不换行：放不下的项进 ⋯ 菜单。

## 5. 交互细则

### 5.1 文件列表（手风琴）

- 单击行展开/折叠该文件 diff；`⌘/Ctrl+Click` 可多开。
- 默认首个文件展开、其余折叠（文件数 ≤ 3 时可全展开）。
- 多开时吸顶堆叠（见 §4.2）。

### 5.2 行级操作

| 操作 | 位置 | 行为 |
|------|------|------|
| 丢弃 | hover 图标 / ⋯ | Popover 确认 → sidecar 先将文件副本移入回收站（系统 Trash 或 `~/.hip/trash/<yyyy-MM-dd>/`）→ `git checkout -- path`；仅 unstaged working tree |
| 在 Files 打开 | hover / ⋯ | 切 Files tab 并选中路径 |
| 复制路径 | ⋯ / 右键 | 已有 |
| 显示全文 / 收起 | diff 底栏双态按钮 | 已有，v2 补齐「收起」 |
| 请 agent 审查此文件 | ⋯ | 注入 composer chip + 提示文案 |

- **丢弃语义固定为恢复到 HEAD**；基线切换只影响 diff 查看。Popover 文案注明「丢弃 = 恢复到最近提交（HEAD）」。
- session running 时丢弃按钮 disabled + 说明。
- 危险操作确认用 Popover（非全屏 Modal），样式对齐浮层规范。

### 5.3 Toolbar 主 CTA

- 有未提交时：「审查」（主 CTA，窄栏保留）+ ⋯。
- ⋯ 菜单：统一/并排（宽屏）、忽略空白、全部折叠/展开、刷新。
- 不在本版放 Commit 按钮；若未来加，文案为「让 Agent 提交…」打开预填 composer。

### 5.4 对比基线

同 v1：分段控件 `会话起点 | HEAD`；无 session-start checkpoint 时禁用「会话起点」+ tooltip；切换后重新拉 diff。

### 5.5 最近提交

数据范围：仓库最近历史（`HEAD` 起最多 100 条），不按 session-start 过滤（R9）。其余同 v1：可折叠标题条；单击 commit 查看 diff +「← 返回未提交」；右键复制 SHA / message；行展示 shortSha + message + 相对时间。

### 5.6 空 / 错误态

同 v1：clean 空状态；有提交记录时提交区自动展开；not_a_repo / git_missing / no_cwd 保持现文案；加载中文件行骨架。

### 5.7 刷新

同 v1：tab 激活、agent 写工具 debounce、turn complete、toolbar 手动刷新；fs watcher 单独立项。

### 5.8 审查（R5，新增）

1. 点击「审查」→ 向 composer 注入意图 chip + 提示文案，内容包含：文件清单、当前基线、审查要点模板（红牌清单）。
2. **结果落点**：agent 在对话内输出结构化报告，固定结构：
   - 总览（规模、风险面一句话）
   - 按影响分组（High / Medium / Low，参考 JetBrains Group with AI）
   - 逐文件要点（每文件条数上限）
   - 建议动作（改什么、是否补测试）
3. 面板侧：审查发起后工具栏 CTA 变「审查中…」并 disabled；完成状态由对话消息驱动，不新建独立结果视图。
4. Phase C 验收标准：注入内容含红牌清单模板；报告能按上述结构返回。

### 5.9 键盘（R6，新增）

| 键 | 行为 |
|----|------|
| `j` / `k`（或 ↑/↓） | 文件行间移动 |
| `space` | 展开/折叠当前行 |
| `⌘/Ctrl+Enter` | 触发「审查」 |
| `Esc` | 关闭确认弹层 / 菜单 / 返回未提交 |
| `?` | 显示快捷键提示（可选） |

### 5.10 忽略空白（R8，新增）

- ⋯ 菜单勾选项；开启后 diff 忽略纯空白变化（对齐 GitHub Desktop Hide Whitespace）。
- 切换时重算统计与行号；空白-only 行以低透明度降噪显示（不删除，保留上下文）。
- 状态写入 `uiStore`（全局）。

## 6. 视觉规范

同 v1 对齐 DESIGN.md（实色、1px 边框、2/4px 圆角、fade ≤120ms）。补充：

- hunk hover 浮出按钮：2px 圆角、`--bg-subtle` 底、1px `--border`。
- 确认 Popover：实色 + 1px 边框 + 轻 scrim，纯 fade（对齐浮层规范，非 Modal）。
- 快捷键提示：tooltip / 菜单项右侧 caption 字号。

## 7. 组件改造映射

| 现有 | 改动 |
|------|------|
| `ChangesView.tsx` | 重做 shell：toolbar、splitter、commits 折叠、基线切换、commit-diff 模式、键盘 handler |
| `DiffDisplay.tsx` | 去 jump-list；默认 `collapsed` 策略；可选 `showJumpList={false}` 过渡；hunk hover 操作；忽略空白 |
| `diffStore.ts` | 暴露/使用 `base`；commit diff 缓存（可选 `viewingCommitSha`）；`ignoreWhitespace` 参与请求 |
| `uiStore.ts` | `changesCommitSectionHeight/Expanded`、`ignoreWhitespace`；窄屏隐藏 split / 压缩 toolbar |
| context menus | 丢弃、审查文件；commit → 查看 diff |
| sidecar `workspace-git` | 回收站副本 + `git checkout -- path`；`git show sha` |
| i18n | v2 新增文案：丢弃确认、忽略空白、审查中、键盘提示 |

## 8. 分阶段交付

### Phase A — 布局与去重（纯 UI，低风险）

- [ ] 删除 jump-list；默认首文件展开、其余折叠；状态单字母
- [ ] 提交区可折叠 + 可拖分隔；有改动时默认收起标题条（R1）
- [ ] 堆叠吸顶：仅展开行 sticky + offset 计算（R2）
- [ ] 显示全文/收起双态；Popover 确认替换原生 confirm
- [ ] 窄栏隐藏并排（R7 前半）

**成功标准**：4 文件场景首屏可见至少 1 个文件 diff 正文；多开文件时吸顶行不互相遮挡。

### Phase B — 基线与提交可点

- [ ] 基线切换 UI（含无 checkpoint 禁用态）
- [ ] 点击 commit 查看 diff + 返回
- [ ] 键盘集 `j/k`、`space`、`⌘+Enter`、`Esc`（R6）
- [ ] 忽略空白（R8）
- [ ] 窄栏 toolbar 压缩（R7 后半）

### Phase C — 主路径动作

- [ ] 丢弃：回收站副本 + Popover 确认 + HEAD 语义（R3）
- [ ] 行 hover 打开 Files
- [ ] 审查：红牌模板 + 结构化报告 + 「审查中」态（R5）
- [ ] hunk hover 操作（R4）

### Phase D — 体验加固（可选）

- [ ] 行内评论 → 批量回交 agent 闭环（Warp / JetBrains Air 模式）
- [ ] hunk 级 discard
- [ ] fs watcher 自动刷新
- [ ] 文件路径筛选
- [ ] AI 分组摘要（JetBrains Group with AI）
- [ ] 大 diff guided review（Linear Diffs）

## 9. 非目标与风险

- 不做完整 commit form，避免与 agent `git_commit` 双路径冲突；未来「让 Agent 提交」预填。
- 新风险与对策：
  - 回收站副本占用磁盘 → 保留 N 天或大小上限，可配置。
  - 审查报告过长 → 模板限制分组 3 类、每文件要点上限。
  - 行内评论回交与运行中 agent 并发 → 同丢弃规则：session running 时禁用。
  - 忽略空白与行号/统计一致性 → 切换时重算。
- Discard 与 agent 并发写同一文件：discard 前若 session running，按钮 disabled + 说明。

## 10. 外部案例对照

| 案例 | 亮点 | 落地位置 |
|------|------|---------|
| [VS Code Source Control](https://code.visualstudio.com/docs/sourcecontrol/staging-commits) | hover 丢弃、diff gutter 行级操作、AI Code Review、丢弃入回收站 | §5.2 / §5.8 / R3 |
| [GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop) | 回收站丢弃、Hide Whitespace、统一/并排 | R3 / §5.10 |
| [Zed Git 面板](https://zed.dev/blog/git) | 键盘优先、面板底部历史可视化 | §5.5 / §5.9 |
| [JetBrains Air Review](https://www.jetbrains.com/help/air/review.html) | diff 内评论 → agent 下一任务 | Phase D |
| [JetBrains Group with AI](https://www.jetbrains.com/help/ai-assistant/2026.1/group-with-ai.html) | 按影响度（High/Medium/Low）分组 | §5.8 / Phase D |
| [Linear Diffs](https://linear.app/now/code-review-should-be-fast) | guided review 章节、结构高亮 | Phase D |
| [Warp Code Review](https://docs.warp.dev/guides/agent-workflows/how-to-review-ai-generated-code/) | 批量评论回交、hunk attach、revert 单 hunk | R4 / Phase D |
| [Cursor 审查面板](https://cursor.com/cn/changelog/page/11) | 文件级 accept/reject、提交并推送 CTA | 定位对照 / 未来提交 CTA |
| [Claude Code issues #18541 / #31395](https://github.com/anthropics/claude-code/issues/18541) | 会话 diff 只显示真改动、hunk 级 accept/discard 诉求 | 定位 / P4 |
| [GitHub 官方 agent PR 审查指南](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/) | 红牌清单、先扫描后判断 | §5.8 |

## 11. 预览

交互 HTML 预览（v2）：

[`changes-panel-v2-preview.html`](./changes-panel-v2-preview.html)

本地打开：

```bash
open docs/design/changes-panel-v2-preview.html
```
