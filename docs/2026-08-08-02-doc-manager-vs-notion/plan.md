# 「文档管理」× Notion 对比与改进方案 · 执行计划（Plan）

> 依据：`spec.md`（v2.1）+ 全屏原型 `editor-prototype-fullscreen.html`（交互基准）
> 目标分支：`feature/doc-manager-v2`（从 trunk 切出，按阶段拆分 PR 合并）
> 规模估算：**P0 3–5 人日 + P1 13–19 人日 + P2 3–5 人日 ≈ 20–29 人日**（单人 4–6 周；双人并行 2.5–3.5 周）
> 细分任务与验收测试标准见 [`tasks.md`](./tasks.md)（T1–T6 粒度）。

---

## 1. 计划总览

| 阶段 | 主题 | 提案 | 依赖 | 估算 | 状态 |
|---|---|---|---|---|---|
| **P0**（1 周） | ⌘K 统一全局搜索 | V2-S1 | 无 | 2–3 人日 | ✅ |
| | 最近文档列表 | V2-N1 | 无 | 1 人日 | ✅ |
| **P1**（3–4 周） | 编辑模型收口（无源码模式） | V2-E0 | 无 | 2–3 人日 | ✅ |
| | 编辑器补齐（分栏/块引用/同步块/模板变量） | V2-E1 | V2-E0（同一文件域） | 8–12 人日 | ✅ |
| | 反向链接面板 + 悬停预览 | V2-L1 | 无 | 3–4 人日 | ✅ |
| **P2**（按需） | 大文档性能优化 | V2-P1 | 可并入 P1 收尾 | 3–5 人日 | ✅ |

**并行策略**：P0 独立先行（纯 UI 组装，风险最低）；P1 内 **E0 → E1 串行**（编辑器模式收敛先行，扩展在同一文件域），**L1 与 E1 并行**（互不依赖，L1 数据已在 Rust 侧就绪）。

> 范围护栏（spec §5/§7 非目标，本计划不包含）：数据库视图、导入导出、AI 文档功能、云端能力、本地评论、自动备份、置顶、**源码模式功能**、**文档元数据（状态/标签/负责人等）**。

---

## 2. P0-1 — V2-S1 ⌘K 统一全局搜索（2–3 人日）

**目标**：⌘K 一处可搜「命令 + 文档 + 最近」，回车 `revealPath` 直达并高亮。能力（MiniSearch `searchKnowledge`、`searchReveal`、命令面板）已全部具备，纯 UI 组装。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| P0-1-1 | 命令面板新增「文档」结果组：`searchKnowledge(q)` 结果与命令组并列分组渲染（命令 / 文档 / 最近） | `src/components/command-palette/*`（`catalog.ts` / `feature.ts` / 结果组件） | ⌘K 打开可同时看到三组，组间可导航 |
| P0-1-2 | 文档结果行：路径面包屑 + 命中 snippet；回车调用 `revealPath` 直达任意深度并高亮命中 | `command-palette/*` + `domain/knowledge/searchReveal.ts`（已有） | 与 mockup ② 行为一致（原型可交互对照） |
| P0-1-3 | ⌘K 快捷键：确认/补齐全局焦点态可用（编辑器、阅读器、侧边栏均有焦点时 ⌘K 均生效） | 命令面板挂载点 + `DocEditor/DocReader` 焦点态 | 任意焦点态 ⌘K 打开 |
| P0-1-4 | i18n 文案（搜索占位、分组名「文档/最近/命令」） | `src/i18n/{zh-CN,en,ja,ko,zh-TW}.ts` | 5 语言无缺失 key |

**测试**：`buildGlobalCommands.test.ts` 回归；新增：文档组过滤、分组计数、回车 reveal 调用的单测。

---

## 3. P0-2 — V2-N1 最近文档列表（1 人日）

**目标**：侧边栏「最近」区块（数据 `RECENT_KEY = 'hip-knowledge-recent'` 已落盘，仅缺 UI）。**不做置顶**（v1.2 决策）。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| P0-2-1 | 侧边栏文档管理段下方新增「最近」区块：最近 N 项（标题 + 相对时间），空态隐藏 | `src/components/layout/AppSidebar.tsx` | 打开过的文档出现在列表 |
| P0-2-2 | 确认打开文档时写入 recent（`knowledgeStore` 现有调用点补缺）；上限 `RECENT_CAP` | `src/store/knowledgeStore.ts` | 超出上限截断 |
| P0-2-3 | 点击最近项 = `revealPath` 直达；右键可移除单条 | `AppSidebar.tsx` + 侧边栏右键菜单 | 直达 + 移除生效 |

**测试**：`AppSidebar.test.tsx` 扩展（最近列表渲染、移除、直达）。

---

## 4. P1-1 — V2-E0 编辑模型收口（无源码模式，2–3 人日）

**目标**：live 编辑器 = 唯一编辑表面；源码模式无任何用户入口；`source` 仅内部兜底；`preview` 代码清理；Markdown round-trip 无损为存储层硬约束。代码侧已有基础（`editorMode.ts` 注释即为 Notion/Feishu-style live 主路径）。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| E0-1 | **移除源码模式用户入口**：`editorMode` 状态机收敛为恒 `'live'`；`KNOWLEDGE_LIVE_FLAG_KEY` / `KNOWLEDGE_EDITOR_MODE_PREF_KEY` / `KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY` 读取路径退役（保留兼容读取，不产生任何 UI/快捷键/命令面板路径） | `src/domain/knowledge/editorMode.ts`、`src/store/knowledgeStore.ts`、`src/components/knowledge/KnowledgeWorkspace.tsx` | grep：无用户可触达的 source 入口；文档注释声明 source = 内部兜底 |
| E0-2 | **preview 清理**：`mdPreview.ts` 写入模式移除；`typoraPreview.ts` 仅保留给阅读/导出（DocReader / htmlExport）；store 中 preview 分支收敛 | `src/domain/knowledge/mdPreview.ts`、`typoraPreview.ts`、`knowledgeStore.ts` | `preview` 类型/引用清零（除历史兼容读取） |
| E0-3 | **内部兜底**：live 渲染失败 / 超大文档（>1MB）自动降级 source（无 UI 入口），顶部非侵入提示「已进入兼容视图」 | `KnowledgeWorkspace.tsx`、`DocBlockNoteEditor.tsx` | 降级触发点仅限两处；提示可关闭 |
| E0-4 | **存储层保障**：round-trip 无损列为硬约束——`dialectRoundTrip` / `frontmatterWrite` / `linkRoundTrip` 测试清单化；已知 lossy 项逐条收敛（能修则修，不能修写入存储规范） | `domain/knowledge/blocks/dialectRoundTrip.test.ts` 等 + 新文档 `docs/design/doc-storage-spec.md` | 测试清单全绿；存储规范文档化 |
| E0-5 | DocReader 阅读视图保持可用（回归确认） | `src/components/knowledge/DocReader.tsx` | 阅读入口/样式无回归 |

**测试**：`editorMode` 相关单测改写（仅 live 路径）；round-trip 清单全绿；`knowledgeStore` 模式相关测试收敛。

---

## 5. P1-2 — V2-E1 编辑器补齐（8–12 人日）

**目标**：在 live 表面之上补齐 Notion 块体验：分栏、块引用、同步块、模板变量。原型 `editor-prototype-fullscreen.html` 为交互基准（块编辑/斜杠/快捷键体验先行对齐）。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| E1-1 | **分栏布局**：新 block `columns`（2–4 列、宽度拖拽、栏内可嵌套任意块）；斜杠菜单项「分栏」；Markdown 往返用 HTML 注释守卫 | `domain/knowledge/blocks/schema.ts`、`carriers.ts`、`DocBlockNoteEditor.tsx` | 分栏内嵌套块可编辑；`dialectRoundTrip` 扩展测试通过 |
| E1-2 | **块引用**：复制块链接（`#nodeId#blockId` 锚点）；悬停预览卡（标题 + 块内容 + 来源）；点击跳转并高亮；移动/重命名时 linkIndex 重映射 | `domain/knowledge/blocks/wikiInline.ts` 扩展、`linkIndex.ts`、`DocReader.tsx`（预览卡组件可复用） | 长报告内「指向某章节」直达 + 高亮；断链并入反链面板 |
| E1-3 | **同步块**：嵌入其他文档某块的只读镜像（双向/单向更新）；源块修改后镜像跟随；一键解除（fallback：解除 = 变为普通引用链接） | `domain/knowledge/blocks/schema.ts`、新 `syncBlock.ts(x)`、store 订阅源块变更 | 源块编辑 → 镜像跟随；解除后不再跟随 |
| E1-4 | **模板变量**：`{{date}}` / `{{title}}` 新建时替换（**无 `{{tags}}`**，v2.1 元数据决策） | `TemplatePickerModal.tsx`、`WikiCreateModal.tsx` | 从模板新建文档生成带日期标题 |

**测试**：分栏往返（含嵌套块）、块引用锚点跳转与重映射、同步块跟随/解除、模板变量替换；`DocBlockNoteEditor.test.tsx` 扩展；全量回归。

---

## 6. P1-3 — V2-L1 反向链接面板（3–4 人日）

**目标**：文档底部反链面板 + wiki 链接悬停预览 + 断链一键创建。数据全部在 Rust 侧就绪（`knowledge_link_index.rs`），纯 UI 暴露。

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| L1-1 | 文档底部「反向链接」面板（DocReader + DocEditor 共用组件）：入链 / 出链 / 断链三组，点击跳转；长列表懒渲染（>5 条折叠） | 新 `src/components/knowledge/BacklinkPanel.tsx` + `DocReader.tsx` / `DocEditor.tsx` 底部挂载 | 与 mockup ③ 交互一致（页签切换/展开） |
| L1-2 | 断链操作：一键「创建缺失文档」（就地建 doc 并建立链接）/「重新指向」（重选目标） | `BacklinkPanel.tsx` + `knowledgeSoftDeleteNodes` 同族命令（新增 create + link 写入） | 断链数归零；新建文档可打开 |
| L1-3 | wiki 链接悬停预览卡（标题 + 摘要 + 入链数），复用 E1-2 的预览卡组件 | 预览卡组件共用 + `DocReader.tsx` | 悬停跟随、点击直达 |

**测试**：面板分组渲染/计数、断链创建闭环（含索引更新）、悬停卡片；Rust 侧新增命令单测。

---

## 7. P2 — V2-P1 大文档性能优化（3–5 人日，按需）

| # | 任务 | 文件 | 验收 |
|---|---|---|---|
| P2-1 | 超大文档（>500KB）编辑器分片加载 + 大纲懒渲染（`DocOutline` 虚拟化） | `DocBlockNoteEditor.tsx`、`DocOutline.tsx` | 500KB 文档打开/滚动不卡顿 |
| P2-2 | 搜索索引增量更新（当前全量重建成本随库增长） | `domain/knowledge/search.ts`（`upsertSearchDoc` 已有，补齐增量触发路径） | 单文档变更不全量重建 |

---

## 8. 测试与验收（对应 spec §8 验收清单）

| 验收项 | 对应任务 | 验证方式 |
|---|---|---|
| ⌘K 一处可搜「命令 + 文档 + 最近」，回车直达并高亮 | P0-1 | 单测 + mockup ② 交互对照 |
| 侧边栏「最近文档」列表 | P0-2 | `AppSidebar.test.tsx` |
| 无任何「源码模式/Markdown 模式」入口（grep 清零） | E0-1 | `grep -rn "editorMode.*source\|mode.*toggle" src/` |
| `preview` 写入模式清理；source 仅内部兜底 + 非侵入提示 | E0-2/E0-3 | 单测 + 手动降级注入 |
| round-trip 无损：测试清单全绿 + 存储规范文档化 | E0-4 | `yarn test` 指定清单 |
| 阅读视图保留可用 | E0-5 | DocReader 回归 |
| 分栏嵌套 / 块引用悬停+跳转高亮 / 同步块跟随+解除 / 模板变量替换 | E1-1..4 | 单测 + 原型对照 |
| 反链面板页签切换 / 断链一键创建 | L1-1..3 | 单测 + mockup ③ 交互对照 |
| 大文档不卡顿；索引增量 | P2-1/2 | 性能基线 + 单测 |

---

## 9. 风险与对策（spec §9 落地）

| 风险 | 等级 | 对策 | 责任人阶段 |
|---|---|---|---|
| source 兜底残留导致双模维护成本 | 中 | E0-1 grep 清零用户入口；兜底触发点仅限两处（live 渲染失败/超大文档）；代码注释声明 | P1-1 |
| 移除源码模式引发既有用户习惯反弹 | 低 | 快捷键 + 斜杠菜单覆盖输入效率（全屏原型已验证）；粘贴 md 自动分块行为确认 | P1-2 |
| BlockNote 分栏/同步块扩展导致 Markdown 往返丢失 | 中 | 分栏 HTML 注释守卫（`carriers.ts` 手法）；同步块 fallback 引用链接；`dialectRoundTrip` 扩展测试硬门禁 | P1-2 |
| 块引用锚点在重命名/移动后失效 | 中 | 引用存 `#nodeId#blockId`，linkIndex 重映射；断链并入反链面板统一处理 | P1-2/P1-3 |
| ⌘K 聚合搜索库变大首召变慢 | 低 | MiniSearch 增量 upsert + 结果上限 + 分组懒渲染 | P0-1/P2 |
| 反链面板长列表渲染卡顿 | 低 | >5 条折叠 + 懒加载 | P1-3 |
| 断链「一键创建」写索引时序（创建 → 索引 → 计数） | 中 | Rust 侧命令原子化（create + link 一次提交），单测覆盖计数收敛 | P1-3 |

---

## 10. 提交/评审节奏

- 每阶段一个 PR，标题前缀 `doc-manager-v2/P0..P2`；合入门禁：**全量单测绿 + round-trip 清单绿 + 与全屏原型/视觉稿行为对照截图**
- **评审重点**：
  - P0：⌘K 分组与直达的交互契约（与 mockup ② 一致）
  - P1-1（E0）：编辑模式收敛契约（source/preview 引用面清零）
  - P1-2（E1）：BlockNote schema 扩展契约 + Markdown 往返守卫
  - P1-3（L1）：断链创建的索引闭环
- 每阶段合入后更新本 plan 勾选状态与 `spec.md` 验收清单打勾

---

## 11. 实施记录（随执行更新）

- [x] P0-1 ⌘K 统一搜索（V2-S1）— commit `eb770464`（文档/最近分组、count、回车 reveal+flash、matchless 分组）
- [x] P0-2 最近文档列表（V2-N1）— commit `41c149f5`（侧边栏最近区块、右键移除、8 条展示上限）
- [x] P1-1 编辑模型收口（V2-E0）— commit `649636b8`（live 唯一表面、preview 收敛、兼容视图 banner 24h 免打扰、doc-storage-spec.md 27 条门禁）
- [x] P1-2 编辑器补齐（V2-E1）— commit `3a28c7e3`（分栏，BN 0.52 限制改为 props 式 + 守卫注释往返）、`d3170618`（块引用 `[[t#frag]]` + 悬停卡 + hip:// 粘贴、同步块、模板变量）
- [x] P1-3 反向链接面板（V2-L1）— commit `a09358df`（入/出/断链三组、断链一键创建/重指向，Rust 侧沿用既有 index 命令，前端有序写入保证失败回滚语义）
- [x] P2 大文档性能优化（V2-P1）— commit（大纲 >200 标题虚拟化；索引增量已具备 + 回归测试；超大文档由 E0 兼容视图兜底）
