# 知识库（Knowledge Base）Spec

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-13 |
| 状态 | **P0 + P1 search + CodeMirror Implemented**；编辑体验跟进见 [`2026-07-13-knowledge-editor-ux-spec.md`](./2026-07-13-knowledge-editor-ux-spec.md)（export/import 仍为可选后续） |
| 范围 | 顶部标签栏 `+` 入口；独立知识库工作表面；多空间 + 目录树 + Markdown 读写 + 搜索 |
| 原型 | [`../../prototypes/knowledge-base/index.html`](../../prototypes/knowledge-base/index.html) |
| 关联 plan | [`../plans/2026-07-13-knowledge-base.md`](../plans/2026-07-13-knowledge-base.md) |
| 关联 design | [`./2026-07-13-knowledge-base-design.md`](./2026-07-13-knowledge-base-design.md) — **冲突时以 design 为准** |
| 参考产品 | 飞书云文档（树导航）、语雀（空间卡片）、Obsidian（本地 Markdown 资产；**不**做图谱） |
| 现状代码 | `SessionTabBar`（`+` → 新对话/代码项目）；`ActiveView` = chat/code/settings/history；`MarkdownBody` + `react-markdown` / `remark-gfm`；`FileTree`（Code 表面文件树） |

---

## 1. Overview

### 1.1 问题

hip 是桌面 AI 工作台，已有 Chat / Code 会话表面与 Memory（自动记忆），但**缺少用户主动维护的、可编辑的知识资产层**：

| 能力 | 现状 | 缺口 |
|------|------|------|
| 会话 | 临时对话与项目上下文 | 无法沉淀为可复用文档库 |
| Memory | 自动生成的记忆条目（设置页管理） | 非「书本式」组织；用户心智是系统记忆，不是知识库 |
| 技能 / 插件 | 工具扩展 | 不是可读可编的文档树 |
| 文件系统 | Code 表面绑定 cwd 看仓库 | 不是跨项目的个人/团队知识空间 |

用户期望：像语雀/飞书一样维护**空间 + 目录 + 文档**，本地优先，与 Chat/Code **并列**，而非埋在设置里。

### 1.2 产品定位（锁定）

**知识库 = 本地优先的 Markdown 知识空间管理器。**

- 一级入口：标题栏标签列表旁的 `+` 菜单 →「知识库」
- 打开后：独立标签 / 工作表面（与会话可并行存在）
- 组织模型：**空间 → 文件夹树 → 文档**
- 文档格式：**Markdown**（GFM）
- 发现路径：**目录浏览 + 全文搜索**

明确**不是**：AI 问答台、会话附件柜、Memory 替代品、Obsidian 图谱产品。

### 1.3 目标

| ID | 目标 |
|----|------|
| G1 | **入口** — `+` 菜单在「新对话 / 代码项目」下增加「知识库」；点击打开知识库表面 |
| G2 | **独立表面** — 知识库以独立标签（或等价 tab 实体）存在，可关闭；不占用 Chat/Code session id 语义 |
| G3 | **多空间** — 用户可创建 / 重命名 / 删除空间；首页展示空间卡片 + 最近打开 |
| G4 | **目录树** — 空间内文件夹与文档的层级树；新建 / 重命名 / 删除；展开收起 |
| G5 | **Markdown 文档** — 阅读与编辑正文；自动或显式保存；与现有 `MarkdownBody` 预览风格一致 |
| G6 | **搜索** — 在当前空间或全部空间内按标题 / 正文检索 |
| G7 | **本地持久化** — 数据落在 hip 用户数据目录，重启可恢复 |
| G8 | **i18n** — en / zh-CN / zh-TW 文案齐全 |

### 1.4 非目标（本期）

| ID | 非目标 | 说明 |
|----|--------|------|
| NG1 | 知识库内 AI 问答 / 摘要 / 自动整理 | 用户明确排除 |
| NG2 | 与 Chat/Code 会话注入、@ 引用、上下文挂载 | 用户明确排除 |
| NG3 | 关系图谱、双向链接体系、反向链接面板 | 用户明确排除 |
| NG4 | 实时多人协作 / CRDT / 云同步 | 桌面本地优先 |
| NG5 | 复杂块编辑器 / Notion 式数据库 | 先 Markdown |
| NG6 | 完整 RBAC / 租户 / 分享链接 | 单机用户 |
| NG7 | 替换或合并 Memory 设置页 | Memory 保持独立 |
| NG8 | 完整导入 Obsidian Vault 插件生态 | 可选「导入文件夹」可后续 |

### 1.5 原则

1. **Simplicity first** — 最小可交付：入口 + 空间 + 树 + MD + 搜索；不预埋 AI 接口。
2. **本地 Markdown 为真源** — 文档以文件（或等价可导出 MD）存储，便于备份与外部编辑器打开。
3. **Surgical integration** — 扩展 `+` 菜单与 `ActiveView`（或等价 tab 模型）；不重写 session 主循环。
4. **复用现有渲染** — 预览优先 `MarkdownBody` / `react-markdown` + `remark-gfm`。
5. **依赖克制** — 能用现有组件（`FileTree` 模式、Radix 菜单）则不引重型框架。

---

## 2. 用户体验

### 2.1 入口

```text
TitleBar tablist
  [session tabs…]  [ + ]
                      ├ 新对话
                      ├ 代码项目
                      └ 知识库   ← 新增（分隔线后可选）
```

- `data-testid` 建议：`new-session-kb` / `open-knowledge-base`
- 打开后：出现知识库标签（文案如「知识库」或当前空间名）；主内容区切换到知识库 UI
- 再次点 `+` → 知识库：若已有打开的知识库标签则聚焦，否则打开

### 2.2 信息架构

```text
Knowledge Home
  ├ 搜索（全部空间）
  ├ 我的空间（卡片网格）
  │    └ 点击 → Space Workspace
  └ 最近打开（文档列表）

Space Workspace（两栏）
  ├ 左：空间切换 + 目录树 + 新建文档/文件夹
  └ 右：面包屑 + 工具栏（编辑/导出）+ 阅读或编辑区
```

对齐原型三场景：**入口 (+)** → **知识库首页** → **空间/文档**。

### 2.3 核心交互

| 操作 | 行为 |
|------|------|
| 新建空间 | 输入名称；可选 emoji/图标；创建空根目录 |
| 删除空间 | 二次确认；删除空间内全部文档 |
| 新建文件夹 / 文档 | 在选中节点下创建；文档默认标题「未命名」 |
| 重命名 | 树内联或对话框 |
| 打开文档 | 右侧只读预览；点「编辑」进入编辑模式 |
| 保存 | 编辑模式下防抖自动保存 + 失焦保存；失败 toast |
| 搜索 | 结果列表：标题、所属空间/路径、片段高亮；点击打开 |
| 导入 | MVP 可只做「选择文件夹导入 `.md`」（P1）；首期可延后 |
| 导出 | 单文档导出 `.md`；空间导出 zip（P1） |

### 2.4 与 Chat/Code 的关系

| 维度 | 行为 |
|------|------|
| 标签 | 知识库标签与 session 标签并列显示在 tablist（实现见 §3.2） |
| 切换 | 点 session 标签 → 回到对应 Chat/Code；点知识库标签 → 回知识库 |
| 数据 | **无**会话注入、**无**自动把文档塞进 prompt |
| Memory | 不读写 Memory store |

---

## 3. 设计

### 3.1 领域模型

```text
Space
  id: string
  name: string
  icon?: string          // emoji 或预置 id
  createdAt, updatedAt: number
  rootPath: string       // 磁盘根目录

Node (folder | doc)
  id: string
  spaceId: string
  parentId: string | null
  kind: 'folder' | 'doc'
  title: string
  slug?: string          // 文件名安全片段
  order: number          // 同级排序
  createdAt, updatedAt: number

Doc content
  body: string           // Markdown 全文
  // 可选 frontmatter：title, tags[]（P1）
```

**存储布局（推荐）**：

```text
~/.hip/knowledge/
  index.json                 # 空间列表元数据
  <spaceId>/
    meta.json                # 空间名、图标、树索引（可选）
    tree.json                # 节点元数据（id/parent/kind/title/order）
    docs/
      <docId>.md             # 正文真源
```

备选：纯文件夹层级（`folder/sub/doc.md`）无 `tree.json`——导入友好，但重命名/排序/稳定 id 更难。  
**MVP 推荐 `tree.json` + `docs/<id>.md`**，保证 UI 树稳定；导出时再写成人类可读路径。

### 3.2 前端架构

#### 3.2.1 导航状态

扩展 `ActiveView`（或并列模型）：

```ts
type ActiveView = 'chat' | 'code' | 'settings' | 'history' | 'knowledge'
```

知识库内部 UI 状态（可放 `knowledgeStore`，不必全部 persist）：

```ts
{
  activeSpaceId: string | null
  activeDocId: string | null
  mode: 'home' | 'workspace'
  editing: boolean
  searchQuery: string
}
```

**标签呈现**（二选一，实现时定一种）：

| 方案 | 说明 | 建议 |
|------|------|------|
| A. 伪 session 标签 | `openSessionIds` 旁增加 `knowledgeTabOpen: boolean` + 固定知识库 chip | **推荐 MVP**：改动小 |
| B. 统一 Tab 实体 | `openTabs: Array<SessionTab \| KnowledgeTab>` | 更干净，改动面大 |

#### 3.2.2 UI 组件（建议路径）

```text
src/components/knowledge/
  KnowledgeHome.tsx          # 空间卡片 + 最近打开 + 搜索
  KnowledgeWorkspace.tsx     # 两栏壳
  SpaceTree.tsx              # 目录树
  DocReader.tsx              # MarkdownBody 只读
  DocEditor.tsx              # 编辑器（见 §4）
  KnowledgeSearch.tsx
src/store/knowledgeStore.ts
src/domain/knowledgeService.ts   # 或 ipc 薄封装
```

`AppLayout.renderMainContent`：`activeView === 'knowledge'` → `<KnowledgePage />`。

`SessionTabBar`：`+` 菜单增加项；条件渲染知识库 tab。

### 3.3 持久化与 IPC

| 层 | 职责 |
|----|------|
| UI store | 当前打开的 space/doc、编辑缓冲 |
| IPC / Rust 或 sidecar | 读目录、写文件、列空间（**路径沙箱**：仅允许 `~/.hip/knowledge/**`） |
| 索引 | 启动或变更时构建搜索索引 |

实现选型（实现阶段二选一，spec 不锁死）：

1. **Tauri `fs` + 前端 knowledgeService** — 简单，适合纯本地文件  
2. **Sidecar 协议消息** — 与 memory/skills 一致，便于日后共享 FTS  

MVP 优先 **Tauri 受限 FS + 前端服务**，避免阻塞 sidecar 协议膨胀；若需 SQLite FTS 再迁 sidecar。

### 3.4 搜索

| 范围 | 行为 |
|------|------|
| 首页搜索框 | 默认全部空间 |
| 空间内（可选） | 仅当前 `spaceId` |
| 字段 | title 权重高；body 全文 |
| 结果 | 最多 N 条；展示 path 面包屑 |

### 3.5 错误与空态

| 场景 | UX |
|------|----|
| 无空间 | 首页空态 +「新建空间」主按钮 |
| 空空间 | 树提示「新建第一篇文档」 |
| 读盘失败 | toast + 重试 |
| 写盘失败 | 保留编辑缓冲，toast，不静默丢稿 |
| 损坏的 tree.json | 安全模式：只列 docs 目录，提示修复 |

---

## 4. 依赖与框架调研

> 调研日期：2026-07-13。结论：**没有合适的「整包知识库框架」可直接嵌入 hip**；应按层挑选轻量库，并最大化复用现有代码。

### 4.1 整包 / 参考产品（不直接依赖）

| 名称 | 说明 | 对本需求 |
|------|------|----------|
| Obsidian | 本地 MD + 图谱插件生态 | 产品参考；不可嵌入 |
| 语雀 / 飞书 | 云端知识库 | 交互参考；无开源嵌入 SDK |
| mdSilo、Lokus、各类 Tauri notes | 独立笔记应用 | 架构参考；不引入其 monorepo |

**结论：** 自建 UI + 本地文件模型，不引入第三方「知识库应用壳」。

### 4.2 Markdown 预览（已有 — 优先复用）

| 包 | 状态 | 用途 |
|----|------|------|
| `react-markdown` ^9 | **已依赖** | 渲染 MD |
| `remark-gfm` ^4 | **已依赖** | GFM 表格/任务列表等 |
| `MarkdownBody` | **已有组件** | 与 Chat 一致的预览样式 |

**建议：** 阅读态直接复用 `MarkdownBody`，零新增依赖。

### 4.3 Markdown 编辑

| 方案 | 优点 | 缺点 | MVP 建议 |
|------|------|------|----------|
| **受控 `<textarea>` + 预览切换** | 零依赖、最简单、易测 | 无语法高亮 | **P0 可用** |
| **CodeMirror 6** + `@codemirror/lang-markdown` + `@uiw/react-codemirror` | 源码编辑体验好、可扩展、业界常见 MD 笔记栈 | 体积大于 textarea | **P0 增强首选** |
| `@uiw/react-md-editor` | 开箱工具栏 + 预览 | 样式定制成本、与 hip token 难统一 | 备选 |
| TipTap / Milkdown / Lexical | WYSIWYG 强 | 重、学习成本高、与「MD 真源」摩擦 | **本期不选** |
| Monaco | IDE 级 | 过重 | 不选 |

**建议：**

- **P0：** `textarea` 编辑 + `MarkdownBody` 预览（分栏或 Tab），最快闭环。  
- **P0.5 / P1：** 若编辑体验不足，再加 **CodeMirror 6 + lang-markdown**，预览仍用现有渲染。  
- **不引入** TipTap/Milkdown，直到有明确 WYSIWYG 需求。

### 4.4 目录树

| 方案 | 优点 | 缺点 | 建议 |
|------|------|------|------|
| **自研**（仿 `FileTree`） | 无新依赖、风格统一 | DnD/虚拟列表需自写 | **MVP 推荐** |
| `react-arborist` | 虚拟列表、DnD、键盘、成熟 | 新依赖；主题要适配 | 树很大或需要拖拽排序时再上 |
| `@headless-tree/react` 等 | 无头、可访问性好 | 生态较新，需评估维护 | 可选调研 |

**建议：** MVP 用自研轻量树（展开/选中/新建/重命名/删除）；**拖拽排序标为 P1**，届时评估 `react-arborist`。

### 4.5 全文搜索

| 库 | 特点 | 建议 |
|----|------|------|
| **MiniSearch** | 内存倒排索引、字段加权、体积小、适合 MD 集 | **首选（前端索引）** |
| Fuse.js | 模糊匹配好 | 大数据全文偏慢，作标题模糊可 |
| FlexSearch | 极快 | API 复杂一些，备选 |
| Sidecar SQLite FTS | 与 memory 管线类似 | 数据量大或要跨进程时再上 |

**建议：** MVP 用 **MiniSearch** 在打开空间/启动时建索引；文档变更时增量 `add`/`replace`。文档量上万级再考虑 sidecar FTS。

### 4.6 Frontmatter / 元数据（可选）

| 库 | 用途 | 建议 |
|----|------|------|
| `gray-matter` | YAML frontmatter 解析 | P1 若需要 tags/title 内嵌文件 |
| 自管 `tree.json` | 标题与树结构 | **MVP 足够**，可不引 gray-matter |

### 4.7 文件系统

| 能力 | 现状 | 建议 |
|------|------|------|
| Tauri dialog | `@tauri-apps/plugin-dialog` 已有 | 导入文件夹、导出 |
| 受限读路径 | 已有 openPath 边界思路 | 知识库根目录白名单 |
| `@tauri-apps/plugin-fs` | 需确认是否已启用 | 读写 `~/.hip/knowledge` 时启用 scope |

### 4.8 依赖决策汇总

| 层级 | MVP | 可选增强 | 明确不引入 |
|------|-----|----------|------------|
| 预览 | 现有 `MarkdownBody` | — | — |
| 编辑 | textarea | CodeMirror 6 | TipTap / Milkdown / Monaco |
| 树 | 自研 | `react-arborist`（DnD/大树） | 完整文件管理器框架 |
| 搜索 | **MiniSearch** | FlexSearch / SQLite FTS | 云搜索 SaaS |
| 存储 | 本地 JSON + MD 文件 | gray-matter | 嵌入式完整 wiki 引擎 |
| 产品壳 | 自建 React 页 | — | Obsidian 插件宿主等 |

**预计新增 npm 依赖（MVP 最小集）：**

```text
minisearch
```

（若选 CodeMirror 路径再增加 `@uiw/react-codemirror`、`@codemirror/lang-markdown` 等。）

---

## 5. 实现分期

### P0 — 可演示闭环

1. `+` 菜单「知识库」+ `activeView: 'knowledge'` + 标签 chip  
2. 首页：空态 / 空间列表 / 新建空间  
3. 工作区：树 + 打开文档只读 + 编辑保存  
4. 本地读写 `~/.hip/knowledge`  
5. 基础 i18n + 单测（store / 路径边界）

### P1 — 好用

1. 全文搜索（MiniSearch）  
2. 最近打开  
3. 重命名、删除、同级排序（或拖拽）  
4. 单文档导出；导入文件夹  
5. CodeMirror 编辑（若 textarea 体验不够）

### P2 — 以后再说（本 spec 不承诺）

1. AI / 会话注入  
2. 图谱与双向链接  
3. 云同步、协作  
4. 与 Memory 双向打通  

---

## 6. 验收标准

| # | 标准 |
|---|------|
| A1 | 点击 `+` →「知识库」进入知识库 UI，主区域非 Chat 草稿页 |
| A2 | 可创建空间并在首页看到卡片 |
| A3 | 可在空间内新建文件夹与文档，树即时更新 |
| A4 | 编辑 Markdown 保存后重启应用内容仍在 |
| A5 | 只读预览 GFM 与 Chat 气泡观感一致（同源渲染组件） |
| A6 | 搜索能命中标题或正文并打开对应文档（P1 可后置，P0 至少标题过滤） |
| A7 | 无任何「问 AI / 注入会话 / 打开图谱」入口（符合非目标） |
| A8 | `yarn tsc` / 相关 unit test 通过；关键路径有 testid 便于 e2e |

---

## 7. 风险与开放问题

| 风险 / 问题 | 备注 |
|-------------|------|
| 标签模型：伪 chip vs 统一 Tab 实体 | 建议 P0 用伪 chip，避免大重构 |
| 存储：tree.json vs 纯目录 | 建议 tree.json；导入导出再映射 |
| 大文档编辑性能 | 超大 MD 时再上 CodeMirror 虚拟化 |
| 与 Code `FileTree` 用户心智混淆 | 文案强调「知识空间」而非项目文件 |
| 是否允许用户自定义知识库根路径 | 默认 `~/.hip/knowledge`；自定义属 P1 |
| 并发编辑（外部编辑器改同一文件） | MVP 不做 file watch；P1 可「重新加载」 |

---

## 8. 相关文件（实现时预计触达）

| 区域 | 文件 |
|------|------|
| 入口 | `src/components/tabs/SessionTabBar.tsx` |
| 布局 | `src/routes/AppLayout.tsx` |
| UI 状态 | `src/store/uiStore.ts` |
| i18n | `src/i18n/{en,zh-CN,zh-TW}.ts` |
| 预览复用 | `src/components/chat/MarkdownBody.tsx` |
| 新模块 | `src/components/knowledge/*`、`src/store/knowledgeStore.ts` |
| 原生 FS | `src-tauri` capabilities / fs scope |
| 原型 | `docs/prototypes/knowledge-base/index.html` |

---

## 9. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-13 | 初稿：基于 HTML 原型与产品收窄（无 AI、无会话绑定、无图谱）；完成依赖调研与 MVP 依赖建议 |
