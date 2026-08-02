# Changes 面板改版 Spec

> 状态：草案 · 2026-08-02  
> 范围：项目场景右侧 Artifact 面板 ·「更改」tab  
> 相关实现：`ChangesView.tsx` / `DiffDisplay.tsx` / `diffStore.ts`

---

## 1. 问题摘要

| # | 问题 | 影响 |
|---|------|------|
| P1 | 文件 jump-list 与下方 diff 列表信息重复 | 首屏被摘要占满，diff 被挤出视口 |
| P2 | 上下 3:2 固定比例 | 有改动时提交区抢高度；无改动时上半空白 |
| P3 | 定位夹在「只读 diff」与「完整 SCM」之间 | 用户预期可提交/丢弃，实际不能 |
| P4 | 主操作藏在右键 | 审阅 → 下一步 路径过长 |
| P5 | 对比基线（session-start / HEAD）无 UI | store 已有，能力不可发现 |
| P6 | 提交记录不可点 | 查看历史提交 diff 需外部工具 |
| P7 | 窄栏下并排视图几乎不可用却占一级入口 | 控件噪音 |

---

## 2. 产品定位

**会话工作区审阅板（Session Workspace Review）**，不是 VS Code Source Control。

| 做 | 不做（本版） |
|----|-------------|
| 看清本会话 / 相对 HEAD 的未提交改动 | stage / unstage / partial stage |
| 高效浏览 diff（单列表手风琴） | 面板内写 message + Commit |
| 丢弃单文件、打开文件、标注 hunk 给 agent | stash / pull / push / PR |
| 一键把「审查 / 提交」意图发给 agent | 完整 git graph |
| 浏览本会话区间的提交，并可点开看 diff | 替代外部 git GUI |

> 变更写入路径保持 agent-first：`git_commit` 等工具；面板负责 **看见 + 决策 + 把意图交回对话**。

---

## 3. 信息架构

```
更改 tab
├── Toolbar
│   ├── 标题：未提交 · N    +a −d
│   ├── 基线：会话起点 | HEAD
│   └── 溢出菜单：统一/并排、全部折叠/展开、刷新
├── File list（唯一列表，手风琴）
│   └── File row
│       ├── [M|A|D|R]  path    +n −m
│       ├── hover/选中：丢弃 · 打开 · ⋯
│       └── expanded → unified hunks（默认）
│           └── hunk 右键：复制 / 标注给 agent / 引用到输入框
└── Commits（可折叠，默认可拖分隔）
    ├── 标题：最近提交 · K
    └── Commit row → 点击加载该 commit diff（替换或叠在列表区）
```

**删除**：独立 jump-list（`files.length > 1` 时顶部摘要条）。

---

## 4. 布局

### 4.1 比例与分隔

| 状态 | 未提交区 | 提交区 |
|------|----------|--------|
| 有未提交改动 | `1fr`（优先） | 默认收起到约 36px 标题条；用户可展开；记忆高度 |
| 无未提交、有提交 | 空状态紧凑（~120px） | 占满剩余 |
| 两边皆空 | 居中空状态 | 隐藏提交区 |

- 中间 **可拖拽分隔条**（min 未提交 160px / min 提交标题 36px）。
- 比例写入 `uiStore`（按 session 或全局均可，推荐全局 + 本次展开态）。

### 4.2 窄栏约束

- 右栏宽度 < 420px 时：**隐藏并排入口**（或菜单内 disabled + tooltip「面板过窄」）。
- 默认 **统一视图**；并排仅宽面板可用。
- 文件状态用单字母 `M/A/D/R`，不用「修改」整词 chip（省横向空间）。

---

## 5. 交互细则

### 5.1 文件列表（手风琴）

- **单击行**：展开/折叠该文件 diff；`⌘/Ctrl+Click` 可多开（可选，v1 可只支持多开已有 `collapsed` map）。
- **默认**：首个文件展开，其余折叠（文件数 ≤ 3 时可全展开，避免空荡）。
- **行内 `+/-`**：保留 monospace tabular。
- **Sticky header**：展开文件的行头在滚动时吸顶（沿用现逻辑）。

### 5.2 行级操作（暴露，不全靠右键）

| 操作 | 位置 | 行为 |
|------|------|------|
| 丢弃 | hover 图标 / ⋯ 菜单 | 确认后 `git checkout -- path` 或等价；仅 unstaged working tree |
| 在 Files 打开 | hover / ⋯ | 切 Files tab 并选中路径 |
| 复制路径 | ⋯ / 右键 | 已有 |
| 显示全文 / 收起 | diff 底栏 | 已有 |
| 请 agent 审查此文件 | ⋯ | 向 composer 注入 chip + 提示文案 |

危险操作（丢弃）需轻确认（Popover confirm，非全屏 Modal）。

### 5.3 Toolbar 主 CTA

有未提交时工具栏右侧：

1. **审查**（次要）— 注入全局审查 prompt（已有 slash/技能文案可复用）
2. **⋯** — 统一/并排、全部折叠、全部展开、刷新

不在本版放 Commit 按钮；若未来加，文案应为「让 Agent 提交…」打开预填 composer，而非本地 `git commit` 表单。

### 5.4 对比基线

- 分段控件：`会话起点` | `HEAD`
- 绑定已有 `diffStore.base` + `requestDiff(sessionId, base)`
- 无 session-start checkpoint 时：禁用「会话起点」并 tooltip 说明，自动落在 HEAD
- 切换后重新拉 diff，折叠状态可重置为默认

### 5.5 最近提交

- 数据范围：仓库最近历史（`HEAD` 起最多 100 条），不按 session-start 过滤
- **单击 commit**：在未提交区位置展示该 commit 的 diff（toolbar 出现「← 返回未提交」）
- 右键保留：复制 SHA、复制 message
- 行展示：`shortSha` + message（truncate）+ 相对时间；author 放 tooltip，减噪

### 5.6 空 / 错误态

| 状态 | UI |
|------|-----|
| clean | 简洁空状态 +「工作区干净」；若有提交记录，下方提交区自动展开 |
| not_a_repo | 保持 Init 按钮 |
| git_missing / no_cwd | 保持现文案 |
| 加载中 | 文件行骨架，勿整页闪烁 |

### 5.7 刷新

- 保持：tab 激活、agent 写工具 debounce、turn complete
- 本版可加：toolbar 手动刷新
- 不强制本版上 fs watcher（可单独立项）

---

## 6. 视觉规范（对齐 DESIGN.md）

- 表面：实色 `--bg-app` / sticky 头 `--bg-subtle`；1px `--border`
- 状态字母色：`A` success · `D` danger · `M` warning · `R` secondary
- diff 行底：`success/danger` 约 7% 透明（沿用）
- 圆角：行内按钮 2px，chip 4px
- 动效：仅 opacity / background ≤ 120ms
- 字号：路径 meta/mono；toolbar caption medium

### 文件行密度（comfortable）

```
h ≈ 32px | px-3
[chevron 14] [M] [icon] path…     +2  −0   [discard] [open]
```

展开后 diff 区 `font-mono text-meta`，行高 ~1.55。

---

## 7. 组件改造映射

| 现有 | 改动 |
|------|------|
| `ChangesView.tsx` | 重做 shell：toolbar、splitter、commits 折叠、基线切换、commit-diff 模式 |
| `DiffDisplay.tsx` | **去掉 jump-list**；默认 `collapsed` 策略；可选 `showJumpList={false}` 过渡 |
| `diffStore.ts` | 暴露/使用 `base`；commit diff 缓存（可选 `viewingCommitSha`） |
| `uiStore.ts` | `changesCommitSectionHeight` / `changesCommitExpanded`；窄屏隐藏 split |
| context menus | 丢弃、审查文件；commit → 查看 diff |
| sidecar `workspace-git` | `git checkout -- path` / discard；`git show sha` diff（若尚无） |
| i18n | 基线、丢弃确认、返回未提交、最近提交、审查 CTA |

---

## 8. 分阶段交付

### Phase A — 布局与去重（低风险，纯 UI）

- [ ] 删除 jump-list
- [ ] 默认首文件展开、其余折叠
- [ ] 状态改为单字母
- [ ] 提交区改为可折叠 + 可拖分隔；有改动时默认收起标题条
- [ ] 窄栏隐藏并排

**成功标准**：同截图 4 文件场景，首屏可见至少 1 个文件的 diff 正文。

### Phase B — 基线与提交可点

- [ ] 基线切换 UI
- [ ] 点击 commit 查看 diff + 返回
- [ ] 提交区展示仓库最近提交（上限 100 条）

### Phase C — 主路径动作

- [ ] 丢弃文件（确认）
- [ ] 行 hover 打开 Files
- [ ] Toolbar「审查」注入 composer
- [ ] （可选）「请 Agent 提交」预填

### Phase D — 体验加固（可选）

- [ ] fs watcher 自动刷新
- [ ] 文件路径筛选
- [ ] hunk 级 discard

---

## 9. 非目标与风险

- **不**在 Changes 内做完整 commit form，避免与 agent `git_commit` 双路径冲突。
- Discard 与 agent 并发写同一文件：discard 前若 session running，按钮 disabled + 说明。
- 并排在宽屏仍保留，避免「功能回退」抱怨；仅按宽度降级。

---

## 10. 预览

交互 HTML 预览（Before / After）：

[`docs/design/changes-panel-preview.html`](./changes-panel-preview.html)

本地打开：

```bash
open docs/design/changes-panel-preview.html
```
