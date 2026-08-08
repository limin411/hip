# 「文档管理」V2 · 细分任务清单与验收测试标准

> 依据：`spec.md`（v2.1）+ `plan.md`（阶段计划）。本文件把每个阶段拆到**可逐日执行的任务粒度**，每项给出**验收测试标准**（含具体输入/期望输出/阈值/运行命令）。
> 全局门禁（每任务合入前）：`yarn tsc --noEmit` 通过、`yarn test` 全绿（知识相关测试文件见 §7）、round-trip 清单绿（E0 后为硬门禁）。

---

## 0. 总览（依赖与估算）

```
P0（3–5 人日）
  T1.1→T1.2→T1.3→T1.4（V2-S1 ⌘K 搜索，串行）
  T2.1→T2.2→T2.3（V2-N1 最近，可与 T1 并行）
P1（13–19 人日）
  ├─ T3.1→T3.2→T3.3→T3.4→T3.5（V2-E0 收口，串行）
  └─ 之后分支并行：
      ├─ T4.1→…→T4.12（V2-E1 编辑器补齐，串行 8–12 人日）
      └─ T5.1→…→T5.6（V2-L1 反链面板，并行 3–4 人日，数据已在 Rust 侧）
P2（3–5 人日，按需）
  T6.1 / T6.2 / T6.3（V2-P1 性能，可并入 P1 收尾）
```

| 任务 | 名称 | 估算 | 依赖 |
|---|---|---|---|
| T1.1–T1.4 | ⌘K 统一搜索 | 2–3 人日 | 无 |
| T2.1–T2.3 | 最近文档列表 | 1 人日 | 无 |
| T3.1–T3.5 | 编辑模型收口 E0 | 2–3 人日 | 无 |
| T4.1–T4.12 | 编辑器补齐 E1 | 8–12 人日 | T3（同文件域） |
| T5.1–T5.6 | 反链面板 L1 | 3–4 人日 | T4.6 的预览卡组件（可先占位） |
| T6.1–T6.3 | 大文档性能 P1 | 3–5 人日 | 无 |

---

## 1. P0-1 — V2-S1 ⌘K 统一搜索（T1）

### T1.1 命令面板数据源扩展（0.5 人日）
- [ ] 接入 `searchKnowledge(q)`（`domain/knowledge/search.ts`，MiniSearch 已有）到命令面板搜索源
- [ ] 结果模型：`{ group: '命令' | '文档' | '最近', items }`；最近组数据来自 `RECENT_KEY`（`knowledgeStore`）
- [ ] 空 query 时：显示「最近 + 常用命令」，不显示全库文档

**验收测试标准**（`command-palette/*.test.ts` 新增）：
1. `searchKnowledge('harness')` 返回标题/正文命中文档，按分数降序，`limit` 生效
2. 空 query：文档组为空且隐藏；最近组显示 `RECENT_CAP` 条
3. 中文 query（如「评测」）命中；大小写不敏感（英文）

### T1.2 文档结果行渲染（0.5 人日）
- [ ] 结果行：路径面包屑（复用浏览模式路径拼接）+ 命中 snippet（`capBodyPreview` 已有）+ 分组计数
- [ ] 无命中时显示空态「无匹配结果」

**验收测试标准**：
1. 渲染 3 条以上结果时计数 = 实际条数
2. snippet 超长截断（`BODY_PREVIEW_CAP` 2048 内）且无换行泄漏
3. 空态文案显示，且不残留上次结果

### T1.3 键盘导航与直达（1 人日）
- [ ] ↑↓ 跨组选择（组边界循环）、Enter 直达、Esc 关闭
- [ ] 文档项 Enter → `revealPath(nodeId)` 打开 + 命中词高亮（`searchReveal.ts` 已有）
- [ ] 命令项 Enter → 执行命令；最近项 Enter → 直达

**验收测试标准**（交互测试）：
1. ↑↓ 到组尾再按 ↓ 回到首项（循环）；选中态跟随
2. Enter 后 `revealPath` 以正确 `nodeId` 被调用（mock 断言参数）
3. 打开后正文中命中词带高亮 class，1.2s 后移除（与原型 `.flash` 行为一致）
4. Esc 关闭且焦点归还触发元素

### T1.4 全局快捷键与 i18n（0.5 人日）
- [ ] ⌘K（Ctrl+K）在编辑器/阅读器/侧边栏/浏览模式任意焦点态均可打开
- [ ] i18n 5 语言：分组名「文档 / 最近 / 命令」、占位符、空态

**验收测试标准**：
1. 手动测试矩阵：焦点在块编辑器、DocReader、侧边栏文件项、浏览模式工具栏 → ⌘K 均打开
2. `yarn tsc` 通过且 `grep -c "knowledge.search\|kcmd\|⌘K" src/i18n/*.ts` 每语言 key 齐全（无 missing key 测试报错）

---

## 2. P0-2 — V2-N1 最近文档列表（T2）

### T2.1 store 层补齐（0.3 人日）
- [ ] 确认打开文档写入 recent 的调用点，缺失则补（`knowledgeStore`，`RECENT_KEY`）
- [ ] 去重（同文档移到首位）、上限截断

**验收测试标准**（`knowledgeStore` 单测）：
1. 打开 A→B→A：recent = [A, B, …]，A 不重复且在首位
2. 写入第 `RECENT_CAP+1` 条时最旧一条被截断
3. localStorage 落盘 key 仍为 `hip-knowledge-recent`（兼容旧数据读取）

### T2.2 侧边栏「最近」区块 UI（0.5 人日）
- [ ] `AppSidebar.tsx` 文档管理段下方渲染最近列表（标题 + 相对时间「x 分钟前/昨天」）
- [ ] 点击 = `revealPath`；右键「从最近移除」；空列表隐藏区块
- [ ] **不提供置顶**（v1.2 决策）

**验收测试标准**（`AppSidebar.test.tsx`）：
1. 空 recent → 区块不渲染
2. 点击最近项 → `revealPath` 被调用且参数正确
3. 移除单条 → 列表与存储同步；移除最后一条 → 区块隐藏
4. 相对时间：<1min「刚刚」、<1h「x 分钟前」、<24h「x 小时前」、否则日期

### T2.3 测试收尾（0.2 人日）
- [ ] 全量单测 + `AppSidebar` 快照更新

---

## 3. P1-1 — V2-E0 编辑模型收口（T3）

### T3.1 收敛 editorMode 为恒 live（1 人日）
- [ ] `editorMode.ts` / `knowledgeStore.ts`：状态机收敛为 `'live'`；`KNOWLEDGE_LIVE_FLAG_KEY`、`KNOWLEDGE_EDITOR_MODE_PREF_KEY`、`KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY` 读取路径退役（保留兼容读取，不再产生模式切换）
- [ ] `KnowledgeWorkspace.tsx` 移除模式切换 UI 与快捷键；命令面板移除 source 相关命令

**验收测试标准**：
1. `grep -rn "KNOWLEDGE_LIVE_FLAG_KEY\|KNOWLEDGE_EDITOR_MODE" src/ | grep -v "// 兼容\|readDocModeMap\|const KEY"` → 用户路径 0 命中
2. 手动测试：编辑器界面无模式切换入口；⌘K 命令面板搜「源码/Markdown 模式」无结果
3. 单测：`editorMode` 相关测试仅保留 live 路径（删除 source/preview 用例）
4. 兼容读取：localStorage 残留 `hip-knowledge-live=false` 时行为仍为 live（注释 + 测试）

### T3.2 preview 清理（0.5 人日）
- [ ] `mdPreview.ts` 写入模式移除；`typoraPreview.ts` 仅保留给 DocReader 阅读与 htmlExport 导出
- [ ] store 中 preview 分支收敛（历史兼容读取保留）

**验收测试标准**：
1. `grep -rn "'preview'" src/` → 仅历史兼容读取注释处命中
2. 阅读模式渲染与 HTML 导出样式回归通过（现有快照测试）

### T3.3 内部兜底（0.5 人日）
- [ ] live 渲染失败 / 文档 >1MB 时自动降级 source（**无 UI 入口**），顶部非侵入提示「已进入兼容视图（可返回实时编辑）」
- [ ] 恢复条件：重试成功 / 用户关闭提示后回到 live

**验收测试标准**：
1. 注入测试：mock BlockNote 初始化抛错 → 兼容视图渲染原始 md、提示出现、无任何模式切换控件
2. 手动：构造 1MB+ 文档 → 打开即兼容视图；提示关闭后尝试回 live
3. 提示可关闭且 24h 内同文档不重复打扰（localStorage 记录）

### T3.4 round-trip 无损清单 + 存储规范（0.5 人日）
- [ ] `dialectRoundTrip` / `frontmatterWrite` / `linkRoundTrip` 测试用例清单化（新增缺失覆盖）
- [ ] 新文档 `docs/design/doc-storage-spec.md`：存储格式规范 + 已知 lossy 项登记表

**验收测试标准**：
1. 清单文件列出 ≥10 个 round-trip 用例，全部可运行且绿（`yarn vitest run dialectRoundTrip` 等）
2. 每个已知 lossy 项有：现象 / 触发条件 / 现状处置（修 or 记录）/ 回归用例编号
3. 规范文档覆盖：frontmatter 结构、块类型 ↔ md 语法映射表、注释守卫约定（`carriers.ts` 手法）

### T3.5 回归与测试改写（0.5 人日）
- [ ] `DocReader` 回归；知识相关测试文件更新（见 §7 清单）

**验收测试标准**：`yarn test` 全绿（除基线既有失败）；`DocReader.test.tsx` 通过。

---

## 4. P1-2 — V2-E1 编辑器补齐（T4）

### T4.1 分栏 block：schema + 渲染（1 人日）
- [ ] `blocks/schema.ts` 新增 `columns` block（子块容器，2–4 列）；`DocBlockNoteEditor.tsx` 渲染列容器
- [ ] 斜杠菜单「分栏」+ 快捷创建（2 列默认）

**验收测试标准**：
1. 创建 2/3/4 列分栏；每列可输入段落、嵌套列表/待办/引用/代码
2. 光标在分栏内 ↑↓ 跨块移动正常；Enter 在列内拆分
3. 分栏删除整块后子内容不残留孤儿 DOM

### T4.2 分栏列宽拖拽（1 人日）
- [ ] 列间分隔线拖拽调宽（min 100px / max 600px），宽度存块属性

**验收测试标准**：
1. 拖动分隔线 → 相邻两列按比例变化，其他列不变
2. 拖到边界值被钳制（100/600px）；刷新重载后宽度保持（属性持久化）
3. 宽度不进入 Markdown（注释守卫内），往返后宽度保持默认（lossy 项登记到存储规范）

### T4.3 分栏 Markdown 往返守卫（1 人日）
- [ ] `carriers.ts` 手法：分栏序列化为 HTML 注释守卫（`<!-- hip-columns:2 -->…<!-- /hip-columns -->`），解析回块

**验收测试标准**（`dialectRoundTrip.test.ts` 新增 4 用例）：
1. 分栏（含嵌套列表/待办/代码）md → 块 → md **幂等**（两次序列化一致）
2. 分栏内 wiki 链接、math、mermaid 往返无损
3. 手工编辑 md 破坏守卫注释 → 容错解析（降级为段落），不崩溃
4. 无分栏文档序列化输出与改造前一致（回归快照）

### T4.4 分栏斜杠/快捷键收尾（0.5 人日）
- [ ] 斜杠菜单项、键盘：分栏内 `/` 可用；`Ctrl+Alt+C` 快速分栏（如有快捷键体系）

**验收测试标准**：手动对照全屏原型：`/` 菜单过滤「分栏」可用；原型快捷键一致。

### T4.5 块引用：链接格式 + 复制（1 人日）
- [ ] 块链接格式 `#nodeId#blockId`（文档 id + 块锚点）；块菜单「复制块链接」
- [ ] 粘贴/输入解析为可点击引用（扩展 `wikiInline.ts`）

**验收测试标准**：
1. 复制块链接 → 剪贴板格式 `hip://doc/<nodeId>#<blockId>`（协议+锚点），粘贴回编辑器渲染为引用
2. 解析器：格式非法时按纯文本处理，不抛错
3. 引用渲染样式与原型一致（下划线虚线 + hover 态）

### T4.6 块引用悬停预览卡（1 人日）
- [ ] 悬停引用 → 预览卡（标题 + 块内容摘要 + 来源路径 + 入链数），位置跟随防溢出
- [ ] 组件与 L1 共用（`BlockHoverCard.tsx`）

**验收测试标准**：
1. 悬停 150ms 内出现；移出 200ms 内消失
2. 卡片右侧越界时左移（边界测试：引用位于文档右缘）
3. 内容为只读快照（不进入编辑态）

### T4.7 块引用跳转高亮 + 重映射（1 人日）
- [ ] 点击引用 → 跳转目标文档/块 + 高亮 1.2s（对齐原型 `.flash`）
- [ ] 文档移动/重命名时 linkIndex 重映射锚点；失效引用进入断链

**验收测试标准**：
1. 跳转后目标块滚动居中且高亮 class 应用/按时移除
2. 重命名文档 → 引用目标跟随更新（`linkIndex` 单测：rename 后 resolve 成功）
3. 删除目标块 → 引用变为断链，出现在反链面板断链组（与 T5 联测）

### T4.8 同步块：数据模型 + 只读镜像（1.5 人日）
- [ ] 新 block `sync`：记录 `{ sourceNodeId, sourceBlockId, mode: 'mirror' }`；渲染源块只读镜像
- [ ] 斜杠菜单「同步块」+ 从块菜单「嵌入为同步块」

**验收测试标准**：
1. 嵌入后镜像内容与源块一致（段落/列表/待办）
2. 镜像不可编辑（点击无光标）；源块仍可编辑
3. 自引用（嵌入自身）被拒绝并有提示

### T4.9 同步块：跟随更新 + 解除（1 人日）
- [ ] 源块变更 → 镜像跟随（store 订阅）；块菜单「解除同步」
- [ ] 解除 fallback：变为普通引用链接（内容不再跟随）

**验收测试标准**：
1. 编辑源块 → 500ms 内镜像更新（防抖一致）
2. 解除后编辑源块 → 镜像内容不变；显示为引用链接
3. 源块被删 → 镜像显示「源块已删除」占位 + 转为断链提示
4. 嵌套场景：同步块内包含分栏/另一同步块 → 不递归死循环（深度上限 3，超出显示占位）

### T4.10 模板变量（0.5 人日）
- [ ] `{{date}}` / `{{title}}`（**无 `{{tags}}`**）在新建文档时替换（`TemplatePickerModal.tsx` / `WikiCreateModal.tsx`）

**验收测试标准**：
1. 从模板新建：`{{date}}` → 当天 `YYYY-MM-DD`；`{{title}}` → 新文档标题
2. 手动创建（非模板）不触发替换
3. 未知变量（如 `{{foo}}`）原样保留不报错

### T4.11 原型对照收尾（0.5 人日）
- [ ] 以 `editor-prototype-fullscreen.html` 为基准核对：块编辑、斜杠、快捷输入、拖拽、待办行为一致

**验收测试标准**：对照清单（Enter 拆分/Backspace 合并/`#``-``[ ]``>` 快捷输入/拖拽落点指示/待办勾选）逐项手动验证通过。

### T4.12 全量回归（1 人日）
- [ ] 知识相关全量测试（§7 清单）+ `yarn tsc`

**验收测试标准**：全绿（除基线既有失败）；无快照漂移。

---

## 5. P1-3 — V2-L1 反向链接面板（T5）

### T5.1 BacklinkPanel 组件（1 人日）
- [ ] 新 `components/knowledge/BacklinkPanel.tsx`：入链/出链/断链三组 + 计数 + 页签（对齐 mockup ③）
- [ ] 长列表：>5 条折叠 + 「展开全部」

**验收测试标准**（`BacklinkPanel.test.tsx`）：
1. 三组数据与 `knowledgeLinkIndexBacklinks/Outbound/Broken` 返回值一致（mock 断言）
2. 计数徽章 = 实际条数；空组页签计数 0 且禁点
3. 折叠/展开切换正确；>5 条时默认折叠

### T5.2 挂载到 DocReader / DocEditor（0.5 人日）
- [ ] 文档底部渲染面板；编辑态面板只读（交互仅跳转）

**验收测试标准**：阅读/编辑两态均渲染；编辑态点入链跳转不丢未保存内容（先保存或提示）。

### T5.3 断链一键创建（1 人日）
- [ ] Rust 新命令：创建缺失文档 + 建立链接**原子提交**（一次事务），返回新 nodeId
- [ ] UI：断链行「＋ 创建」→ 就地创建并跳转

**验收测试标准**（Rust 单测 + UI 测试）：
1. 创建后断链计数归零；新文档出现在引用方目录；`linkIndex` 更新可查询
2. 重名文档自动加序号（对齐现有重名校验）
3. 失败回滚：磁盘写入失败时索引不变（原子性断言）

### T5.4 断链重新指向（0.5 人日）
- [ ] 「重新指向」→ 文档选择器（复用 WikiLinkPicker）→ 更新链接目标

**验收测试标准**：重指后原目标链接失效、新目标生效；断链组相应更新。

### T5.5 悬停预览卡联调（0.5 人日）
- [ ] 复用 T4.6 `BlockHoverCard`：wiki 链接悬停显示标题/摘要/入链数

**验收测试标准**：与 mockup ③ 行为一致（卡片跟随、内容正确、点击直达）。

### T5.6 测试收尾（0.5 人日）
- [ ] 全量回归（§7 清单）+ Rust `cargo test`

---

## 6. P2 — V2-P1 大文档性能（T6，按需）

### T6.1 大纲懒渲染/虚拟化（1 人日）
- [ ] `DocOutline.tsx`：>200 个标题节点时虚拟滚动

**验收测试标准**：构造 500 标题文档 → 大纲滚动帧率 ≥ 30fps（肉眼无卡顿）；跳转正确。

### T6.2 编辑器分片（1.5 人日）
- [ ] >500KB 文档：懒加载非首屏块（占位渲染）、首屏优先

**验收测试标准**：
1. 1MB 文档打开耗时 ≤ 3s（旧实现对比基线，性能测试记录）
2. 滚动到未加载区 → 块就位（占位替换）且光标可进入

### T6.3 搜索索引增量（1 人日）
- [ ] `search.ts`：单文档变更走 `upsertSearchDoc` 增量路径，不触发全量重建

**验收测试标准**：spy 断言：编辑文档 A → 仅 A 索引更新，全量重建计数 0 次；批量导入仍走批量重建。

---

## 7. 测试运行命令与回归清单

```bash
yarn tsc --noEmit            # 类型门禁
yarn test                    # 全量单测（注意：临时移开 ~/.hip/config/auth.json 避免付费 LLM 测试）
cd src-tauri && cargo test   # Rust 侧（T5.3 新增命令 + 既有 knowledge 模块）
```

**知识相关回归文件清单**（每个 P 阶段结束必须全绿）：
- 编辑器：`DocBlockNoteEditor.test.tsx`、`DocEditor.test.tsx`、`DocReader.test.tsx`、`DocOutline.test.tsx`、`KnowledgeWorkspace.paper.test.tsx`、`InlineDocTitle.test.tsx`
- 往返/存储：`dialectRoundTrip.test.ts`、`bnLiveRoundTrip.test.ts`、`blockRoundTrip.test.ts`、`frontmatterWrite.test.ts`、`frontmatter.test.ts`、`linkSanitize.test.ts`、`rewriteWikiTitles.test.ts`
- 搜索/导航：`search.test.ts`、`searchReveal.test.ts`、`tree.test.ts`、`AppSidebar.test.tsx`、`DocManagerBrowse`/`DirNavList` 相关
- 命令面板：`buildGlobalCommands.test.ts`、`composerBridge.test.ts`
- 侧边栏/菜单：`sidebarActions.test.ts`、`workItem.test.ts`、`knowledgeTree.ts` provider 相关
- Rust：`knowledge.rs` / `knowledge_trash.rs` / `knowledge_link_index.rs` 单测

---

## 8. 验收闭环（每个任务的定义 of done）

1. 代码 + 单测 + 测试绿（§7 清单）
2. 与原型/视觉稿行为对照：T4 对 `editor-prototype-fullscreen.html`，T1/T5 对 `mockup.html` ②③
3. 无范围外改动（护栏：不做数据库/导入导出/AI/云端/评论/备份/置顶/源码模式/元数据）
4. 提交 PR（`doc-manager-v2/<阶段>/<任务>` 粒度或按阶段聚合），合入后更新 `plan.md` 勾选与 `spec.md` 验收清单
