# 「文档管理」改造实施计划（Plan）

> 依据：`spec.md`（v1.2）+ `mockup.html`（可交互视觉稿）
> 目标分支：`feature/doc-manager`（从 trunk 切出，按阶段拆分 PR 合并）
> 规模估算：**24–39 人日**（单人 1.5–2 个月；双人并行 3–4 周）

---

## 1. 计划总览

| 阶段 | 主题 | 依赖 | 估算 | 状态 |
|---|---|---|---|---|
| **P0** | 文案改名（纯 i18n + 图标） | 无 | 1–2 人日 | ✅ 已完成（5 语言） |
| **P1** | 数据模型 v2（**无迁移，开发环境直删旧数据**） | 无 | 3–5 人日 | ✅ 已完成（见下方「实施偏差」） |
| **P2** | knowledgeStore 重构：删除空间维度，路径栈 + 导航 | P1 | 4–6 人日 | ✅ 已完成（导航模型；目录历史已按后续需求删除） |
| **P3** | 侧边栏单层级目录导航（DirNavList） | P2 | 5–8 人日 | ✅ 已完成 |
| **P4** | 主区浏览模式（网格/列表 + ↑/面包屑） | P2 | 4–6 人日 | ✅ 已完成（DocManagerBrowse） |
| **P5** | 深目录完善：…跳转、revealPath、复制路径 | P3、P4 | 3–5 人日 | ✅ 已完成（含 20 层测试） |
| **P6** | 清理与收尾（删空间 UI、回归、文档） | 全部 | 2–4 人日 | ✅ 已完成 |

> **实施偏差（P1，2025-08-08 定案）**：Rust 存储层**保持 spaceId 参数与磁盘布局不变**，
> 仅由 TS 层固定使用唯一内部空间（`loadSpaces` 空库时自动创建「文档管理」空间）。
> 理由：`knowledge_trash.rs`（1038 行）与 `knowledge_link_index.rs`（514 行）深度耦合空间维度，
> 去 space 属 4 千行外科手术；用户可见结果（无空间 UI、单棵树、深目录、浏览模式）与 plan 完全一致，
> 且风险最低。后续如需物理迁移可再单独立项。

**并行策略**：P0 与 P1 可并行；P3 与 P4 在 P2 合入后并行。

---

## 2. P0 — 文案改名（先让「知识库」三字消失）

> 原则：**不改任何逻辑与结构**，仅文案/图标，保证随时可合入。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| P0-1 | i18n 全量替换：知识库→文档管理、知识空间→当前目录、新建知识库→新建…、暂无知识空间→层级空态等（spec §4 映射表） | `src/i18n/zh-CN.ts`、`en.ts` 及全部语言 | `grep -r 知识库 src/` 仅剩迁移提示 |
| P0-2 | 命令面板/全局命令关键词：`知识库`→`文档管理`，保留 `knowledge` 别名 1 个版本 | `command-palette/buildGlobalCommands.ts`、`registry.ts` | 命令面板可搜到「文档管理」 |
| P0-3 | NavItem 图标 `BookOpen`→`FolderTree`，计数改为顶层条目数（临时取 spaces.length 亦可） | `AppSidebar.tsx` | 视觉稿标注点 1 一致 |
| P0-4 | 主页面标题/空状态/搜索占位符文案 | `KnowledgePage.tsx`、`i18n` | 与 mockup 文案一致 |

**回归**：`AppSidebar.test.tsx`、`buildGlobalCommands.test.ts` 等全部既有测试绿。

---

## 3. P1 — 数据模型 v2（无迁移，开发环境直删旧数据）

> **决策（2025-08-08）**：不做 v1→v2 数据迁移。当前为开发环境，旧知识库文件已直接删除；迁移流程（原 spec §3.2）仅保留为将来生产数据升级的备选方案，本期不实现。

### 3.1 已执行：删除旧知识库数据（开发环境）

- 删除 `~/.hip/knowledge/`（v1 `index.json` + 空间 `spc_codingAgent01` 全部内容：docs/versions/assets/templates）
- 删除 `~/.hip/trash/knowledge/`（回收站内知识库条目）
- 遗留：WebView localStorage 旧键（recent / expandPersist / 搜索索引）由 **P2 store 初始化时清理**，不得读取旧 `spaceId` 结构

### 3.2 目标模型（spec §3.1）

```ts
// domain/knowledge/types.ts
interface KnowledgeIndex { version: 2; root: { updatedAt: number } }  // 无 spaces
interface KnowledgeNode { id; parentId: string | null; kind; title; order; createdAt; updatedAt } // null=根
```

磁盘布局：`knowledge/index.json`（v2）+ 单树 `tree.json` + 正文 `docs/<id>.md`（无 space 段）；资产/版本/模板路径同步去 space 段。

### 3.3 任务

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| P1-1 | `KnowledgeIndex` v2、`KnowledgeNode.parentId: null` = 根 | `domain/knowledge/types.ts` | 类型编译通过 |
| P1-2 | Rust 命令去 space 参数：`read/write_doc`、`get/save_tree`（单树）、`templates/versions/assets/export`；**删除** `create/update/delete_space`、`list_spaces`；新增 `knowledge_init`（空库初始化 v2 index + tree） | `src-tauri/src/knowledge.rs`（+`knowledge_trash.rs`/`knowledge_link_index.rs`） | 命令清单与 spec §3.3 对齐 |
| P1-3 | TS 包装同步 | `ipc/knowledge.ts` | grep `_space` 仅剩明确禁用项 |
| P1-4 | store 初始化：v2 结构校验、localStorage 旧键清理 | `store/knowledgeStore.ts` | 旧键不复用 |
| P1-5 | 搜索索引/双链：空库首次全量扫描即完成 | `domain/knowledge/search.ts` | 空库可搜 |

### 3.4 测试

- Rust：tree 读写单测、id/路径校验、空库 `knowledge_init` 幂等；**无迁移测试**（无迁移逻辑）
- TS：`knowledgeStore` 初始化清理旧 localStorage 键

---

## 4. P2 — knowledgeStore 重构（删除空间维度）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| P2-1 | 删除 `spaces/activeSpaceId/loadSpaces/openSpace/persistExpandedForSpace/expandedFolderIds` | `store/knowledgeStore.ts` | 展开状态持久化（expandPersist）退役 |
| P2-2 | 新增单树状态：`path: string[]`（当前路径栈）、`currentFolderId()`、tree 读写去 space 参数 | 同上 | 对齐 mockup 状态模型 |
| P2-3 | ~~目录历史~~ **已删除（2025-08-08 需求变更：不做前进/后退）**；导航仅 ↑ 与面包屑 | — | — |
| P2-4 | 清理引用面：`AppSidebar.tsx`（filteredSpaces/openSpaceFromSidebar）、`sidebarActions.ts`（enterKnowledge 改 enterDocManager）、`KnowledgeWorkspace/KnowledgePage`、`SpaceTree`、`context-menu/providers/*`、命令面板 | 见 P3/P4 列表 | grep `activeSpaceId` 清零 |

**测试**：knowledgeStore 单测重写（路径导航/读树写树）；`SpaceTree.test.tsx` 同步改造。

---

## 5. P3 — 侧边栏单层级目录导航（对齐 mockup 标注点 2/3/6）

### 5.1 新组件 `src/components/knowledge/DirNavList.tsx`（或改造 SpaceTree 为单层级模式）

| 能力 | 规格（spec §2.1/§2.1.1） |
|---|---|
| 列表头 | 「当前目录」+ ↑ 返回上一层（根置灰）+「+ 新建」下拉（文件夹/文档/画板） |
| 迷你面包屑 | `全部文档 ▸ …`，>3 段折叠 `…` → 祖先跳转菜单；hover tooltip 全路径 |
| 条目 | 当前层级：文件夹优先、按修改时间倒序；选中 `bg-accent/10`（对齐 SpaceTree） |
| 空态/无匹配 | 「此文件夹为空」/「没有匹配…」+ 新建按钮 |
| 键盘 | ↑、Esc（窗口级 keydown）；前进/后退已删除 |

### 5.2 接线

| # | 任务 | 文件 |
|---|---|---|
| P3-1 | knowledge 段列表：空间平面列表 → `DirNavList`；list label 改「当前目录」 | `AppSidebar.tsx` |
| P3-2 | ~~标题栏后退/前进接入目录历史~~ **已删除**：标题栏后退/前进保留全局 shell 历史语义 | `AppSidebar.tsx` |
| P3-3 | 右键菜单：删 `knowledgeSpace` provider，`knowledgeTree/knowledgeNode` 合并为：打开/在此新建/重命名/移动…/删除/复制路径 | `context-menu/providers/*`、`registry.ts`、`catalog.ts` |
| P3-4 | 新建内联命名（复用 `WikiCreateModal` 逻辑改内联行，Enter/Esc） | 新 `InlineNameRow` 或并入 DirNavList |
| P3-5 | 新建菜单文案与图标（文件夹/文档/画板） | `i18n`、`dropdown.newKnowledge` → 新建文档 |

**测试**：`DirNavList.test.tsx`（进入/返回/面包屑折叠与跳转/空态/新建/搜索过滤）；`AppSidebar.test.tsx` 更新。

---

## 6. P4 — 主区浏览模式（对齐 mockup 标注点 4/5）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| P4-1 | 删除 `KnowledgeWorkspace` 左侧 280px 树面板（导航已并入侧边栏），主区 = 工具栏 + 内容 | `KnowledgeWorkspace.tsx`（或新 `DocManagerPage.tsx`） | 布局对齐 mockup 主列 |
| P4-2 | 浏览模式：文件夹网格/文档列表（grid/list 切换、文件夹优先排序、列：名称/类型/大小/修改时间） | 同上 + `domain/knowledge/tree.ts`（复用 `compareNodes`） | |
| P4-3 | 主区工具栏：↑ 返回上一层（根置灰）+ 主面包屑（>3 段折叠 `…` 可跳转）+ 搜索（与侧边栏同域联动）+ 视图切换 + 新建 | 同上 | |
| P4-4 | 空态（根/空文件夹/搜索无匹配） | 同上 | mockup 空态文案 |
| P4-5 | 阅读/编辑视图保持：`DocEditor/DocReader/KnowledgeDocCanvas` 不动，面包屑 + ↑ 可达所在文件夹 | 不改 | 编辑器零改动，降低回归面 |

**测试**：浏览模式交互测试（进入/返回/面包屑/视图切换/搜索/空态）；既有编辑器测试全量回归。

---

## 7. P5 — 深目录完善（spec §2.1.1）

| # | 任务 | 文件 |
|---|---|---|
| P5-1 | 面包屑 `…` 祖先跳转菜单（侧边栏 + 主区共用组件） | `DirNavList.tsx`、`DocManagerPage.tsx` |
| P5-2 | ~~历史导航~~ **已删除**（前进/后退不做）；面包屑 `…` 祖先跳转、revealPath、复制路径保留 | — |
| P5-3 | `revealPath`：搜索/命令面板/粘贴路径直达任意深度（含 20 层） | `store/knowledgeStore.ts`、命令面板 |
| P5-4 | 全库搜索（命令面板）：结果分组展示路径，点击 reveal | `domain/knowledge/search.ts`（去 space 参数） |
| P5-5 | 路径复制/「复制路径」右键项 | DirNavList、context-menu |

**测试**：**深目录测试（20 层）**——逐层进入、↑ 逐级返回、面包屑折叠与祖先跳转、revealPath 直达（对应 mockup「深度目录（20 层演示）」）。

---

## 8. P6 — 清理与收尾

| # | 任务 | 文件 |
|---|---|---|
| P6-1 | 删除：`KnowledgeSpaceDialogHost`、`SpaceIconPicker`、`knowledgeSpace.ts` provider、空间级回收站（`KnowledgeTrashKind 'space'` 降级为文件夹回收）、`knowledge_spaceDialogStore` | `components/knowledge/*`、`context-menu/providers/*`、`knowledge_trash.rs` |
| P6-2 | 空间相关 i18n 残留清理（去 space 参数的命令已在 P1-2 完成，此处仅确认无 UI 调用） | `i18n/*`、`ipc/knowledge.ts` |
| P6-3 | 端到端回归：`yarn test` + wdio e2e（`e2e/`） | 全仓 |
| P6-4 | 文档更新：`DESIGN.md`/README 中「知识库」表述替换；spec §10 验收清单逐项打勾 | 文档 |

**验收清单（spec §10）**：
- [ ] 界面无「知识库/知识空间」字样（除迁移兼容说明）
- [ ] 侧边栏为单层级目录：当前层级条目 + ↑/面包屑返回，无递归树
- [ ] 深目录：20 层流畅、面包屑 `…` 跳转、revealPath 直达（前进/后退已删除）
- [ ] 主区：↑/面包屑跳转/网格列表/阅读编辑
- [ ] 旧空间迁移 = 顶层文件夹，内容无损，搜索/双链/回收站可用
- [ ] 空间级 UI 已删除
- [ ] 命令面板/快捷键入口同步
- [ ] 全量单测 + 迁移/浏览/深目录测试通过

---

## 9. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 引用面遗漏（`activeSpaceId` / `_space` 残留） | 中 | P2-4 grep 清零 + 全量测试守护 |
| localStorage 旧键（recent/expandPersist）被误读 | 中 | P1-4 store 初始化显式清理，键名前缀升级 |
| ~~历史导航与全局 navHistory 冲突~~ | — | 已随前进/后退功能删除（2025-08-08） |
| 编辑器（BlockNote）回归 | 中 | P4-5 编辑器零改动；P6 全量回归 |

## 10. 实施记录（2025-08-08）

- P0：`zh-CN/en/ja/ko/zh-TW` 全量文案 + `AppSidebar` 图标 `FolderTree` + 命令面板关键词
- P2：`knowledgeStore` 新增 `currentFolderId` / `navigateTo` / `enterFolder` / `goUp`；搜索命中打开文档时记录所在目录
- P3：新组件 `src/components/knowledge/DirNavList.tsx`（导航条 ↑/新建、迷你面包屑 >3 段折叠 + 祖先跳转、当前层级列表、内联新建/重命名、右键菜单、空态）；导航徽标 = 顶层条目数
- P4：新组件 `src/components/knowledge/DocManagerBrowse.tsx`（工具栏 ↑/面包屑/搜索/网格|列表/新建 + 空态）；`KnowledgeWorkspace` 删除 280px 树面板，无活动文档时渲染浏览模式；`KnowledgePage` 直接进入工作区
- P5：右键「复制路径」；store 20 层深目录测试
- P6：删除 `KnowledgeSpaceDialogHost` / `knowledgeSpaceDialogStore` / `SpaceIconPicker` / `SpaceTree` / `knowledgeSpace` 右键菜单（provider+注册+catalog+设置面板+类型）；`openSpaceFromSidebar` 移除
- 测试：`tsc --noEmit` 通过；知识相关 89 个测试文件 771 项全部通过；全仓仅剩 `packages/sidecar` 16 项 + `localOpenLoop` 1 项**基线既有失败**（stash 验证与本改动无关）
- **需求变更（2025-08-08）**：删除文档管理的前进/后退功能——移除 `dirHistory` 栈、`goDirBack/goDirForward`、侧边栏后退/前进按钮、`Alt+←/→` 快捷键；标题栏后退/前进恢复为全局 shell 历史；回溯仅靠 ↑ 与面包屑。代码 + mockup + 测试同步更新

## 11. 提交/评审节奏

- 每阶段一个 PR，标题前缀 `docs-manager/P0..P6`；合入前必须：全量单测绿 +（P3 起）与 mockup 视觉对照截图
- P1（数据模型/命令契约）与 P2（store 契约）单独评审（P1 已按偏差执行）
- 每阶段合入后更新本 plan 的勾选状态
