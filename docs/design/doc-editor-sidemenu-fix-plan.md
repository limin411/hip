# 文档编辑器「＋ / 六点手柄」整改 · 执行计划（Plan）

> 依据：`docs/design/doc-editor-sidemenu-fix-spec.md`（**v3.0**，方向已确认）  
> 视觉基准：`docs/design/doc-editor-sidemenu-fix-preview.html`（浏览器打开对照 §2 图标实验室 + §3 交互）  
> 范围护栏（spec §3.5，本计划**不包含**）：Move to、飞书分栏蓝线、Comment/AI、语雀缩进菜单、菜单 portal 到 body、全局设计语言改造。  
> 文件域（窄）：几乎只动  
> - `src/components/knowledge/DocBlockNoteEditor.tsx`  
> - `src/components/knowledge/knowledge-blocknote.css`  
> - `src/i18n/*.ts`（少量键）  
> - 对应单测 / 既有 e2e 选择器适配  
> 估算：**P0 1.5–2 人日 + P1 1–1.5 人日 ≈ 2.5–3.5 人日**（可 2–3 个提交合入）

---

## 1. 计划总览

| 切片 | 阶段 | 主题 | spec | 依赖 | 估算 | 状态 |
|---|---|---|---|---|---|---|
| **S1** | P0 | **视觉 gutter**：横向布局 + 真 SVG 六点 + 细线 `+` + 颜色/hover + 定位 middleware | §3.1–3.3、P1–P5/P8 | 无 | 0.5–0.75 人日 | ✅ |
| **S2** | P0 | **`+` 插入菜单**：弃用默认 AddBlock 语义，贴手柄打开类型菜单 | §3.4 `+`、P6 | S1（按钮壳已就位） | 0.5–0.75 人日 | ✅ |
| **S3** | P0 | **`⋮⋮` 块菜单**：Turn into / Duplicate / 项序 / position right | §3.4 `⋮⋮`、P7 | S1（手柄可点） | 0.5–0.75 人日 | ✅ |
| **S4** | P1 | **打磨**：codeBlock 首行对齐、拖/点冲突阈值、暗色 token、e2e 全绿 | §3.1 首行、§5 验收 | S1–S3 | 0.5–1 人日 | ✅ |

**推荐合入节奏**

1. **Commit A（S1）**：只改「看起来对」——用户已确认方向，优先交付视觉，可单独 review / 合入。  
2. **Commit B（S2+S3）**：点击行为对齐 Notion。  
3. **Commit C（S4）**：回归与边角。

**并行**：S2 与 S3 文件同域（`DocBlockNoteEditor.tsx`），**不要并行改同一文件**；S1 的 CSS 可先合，S2/S3 再叠。

---

## 2. S1 — 视觉 gutter（P0，0.5–0.75 人日）

**目标**：悬停块时左侧出现 **横向** `[+][⋮⋮]`，图标几何对齐 preview §2 AFTER；不再竖条/假点/肥加号。

### 2.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| S1-1 | 重写 side-menu CSS | `knowledge-blocknote.css` | 删除 `flex-direction: column` 与 radial-gradient 点阵整段；改为 `row` + `gap: 2px`；按钮 `18×24`、`border-radius: 4px`、透明底；hover `var(--state-hover)`；`--kb-grip` / `--kb-grip-hover`（亮 `#b4b2ad`→`#6b6862`，暗 `rgba(255,255,255,.35/.55)`）；fade-in 120ms；`:focus-visible`；`user-select: none` | 与 preview §2 AFTER 同构；无 54px 竖条 |
| S1-2 | 自研/包装 `+` 按钮 | `DocBlockNoteEditor.tsx` | **弃用**默认 `AddBlockButton` 的 MdAdd 展示（S1 可先保留其 onClick 临时行为，或 noop + toast 级占位，避免半吊子语义；**推荐 S1 仅换皮：点击仍可暂时走 slash，S2 再换菜单**——见下方「S1 点击策略」） | DOM 中 `+` 为 stroke SVG 14 / sw 2.25；保留 `data-test="dragHandleAdd"`、`data-testid` 兼容 |
| S1-3 | 六点真 SVG | `DocBlockNoteEditor.tsx` | **方案 A（推荐）**：`KnowledgeDragHandleButton` 包装 `DragHandleButton` 能力——`draggable` + `SideMenuExtension.blockDragStart/End` + `freezeMenu`/`unfreezeMenu` + 内联 SVG： | 6 个 `<circle>`；无 chevron；无 gradient |
|  |  |  | ```svg<br>viewBox="0 0 10 16"<br>r=1.25 at (2.5,2)(7.5,2)(2.5,8)(7.5,8)(2.5,14)(7.5,14)<br>``` |  |
|  |  |  | **方案 B（降级）**：隐藏默认 icon + `background-image: url("data:image/svg+xml,...")`——仅当 A 拖拽回归失败时用 |  |
| S1-4 | 定位 middleware | `DocBlockNoteEditor.tsx` | `<SideMenuController floatingUIOptions={{ useFloatingOptions: { middleware: [offset(6), shift({ padding: 8 })] } }} />`；`import { offset, shift } from '@floating-ui/dom'`（已是直接依赖） | 与文字约 6–8px 间隙；块顶出视口时手柄仍在可视区 |
| S1-5 | 结构壳 | `DocBlockNoteEditor.tsx` | `KnowledgeSideMenu` 根：`bn-side-menu` + `data-testid="kb-side-menu"` 保留；子序：`+` 在左、`⋮⋮` 在右 | 横向 `[+][⋮⋮]` |

**S1 点击策略（避免半成品）**

- **推荐**：S1 合入时 `+` 点击 **暂时**仍可调用现有 slash 打开逻辑（或保持 AddBlock 语义），**但图标与布局必须是新的**。PR 描述写明「视觉先行，S2 换插入菜单」。  
- **不推荐**：S1 把 `+` 做成无响应按钮（dogfood 会感觉退步）。

### 2.2 测试（S1）

| 类型 | 内容 |
|---|---|
| 单测 | `DocBlockNoteEditor.test.tsx`：挂载后存在 `kb-side-menu`；`+`/`grip` 节点存在；**不**断言旧 radial 类名 |
| 手工 | 打开任意文档 → hover 块 → 对照 preview §2；窄窗 + 长代码块中部 hover → 手柄可见 |
| 回归 | `yarn test src/components/knowledge/DocBlockNoteEditor`；拖拽排序 smoke（S1-3 重点） |

### 2.3 提交

```
style(knowledge): horizontal Notion-like + / six-dot gutter (sidemenu S1)
```

---

## 3. S2 — `+` 插入菜单（P0，0.5–0.75 人日）

**目标**：点 `+` → **贴手柄右侧**打开内容类型菜单；空块转换 / 非空下方插入；**不再**「先插空段 + 光标处 slash」。

### 3.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| S2-1 | 抽取核心类型表 | 可内联于 `DocBlockNoteEditor.tsx`，或 `domain/knowledge/sideMenuBlocks.ts`（若 >40 行则抽文件） | 白名单 id：`paragraph(正文合成)` / `h1` / `h2` / `h3` / `task` / `bullet` / `ordered` / `toggle` / `fence` / `quote` / `hr` / `callout`；icon/label 复用 `KNOWLEDGE_SLASH_ITEMS` + `slashItemLabelKey` | 与 slash 目录同源，无第二套文案 |
| S2-2 | `KnowledgeAddMenu` 组件 | `DocBlockNoteEditor.tsx`（同文件优先，避免过早拆包） | 绝对定位在 `+` 右侧（`left: calc(100% + 6px)` 或 getBoundingClientRect + fixed）；宽 ~220px；行高 30px；图标左列；无搜索框；Escape/外点关闭；打开时 `freezeMenu()`，关闭 `unfreezeMenu()` | 菜单贴 `+`，不跑到光标处 |
| S2-3 | 执行语义 | 同上 | 选项点击 → `insertOrUpdateBlockForSlashMenu(editor, partialBlock)` 或复用 `buildKnowledgeSlashItems` 的 `run`；然后关菜单 | 空段点「标题 1」→ 当前块变 H1；非空段 → 下方插入 |
| S2-4 | 接线 | `KnowledgeSideMenu` | `+` onClick → toggle `addOpen`；与 `⋮⋮` 菜单互斥（开一个关一个） | 无双菜单叠层 |
| S2-5 | i18n | `src/i18n/*.ts` | `knowledge.sideMenu.addBlock`（aria）；类型 label 尽量复用 `knowledge.slash.*` | 5 语言 key 不缺 |

### 3.2 测试（S2）

| 类型 | 内容 |
|---|---|
| 单测 | mock editor：空块 + 选 h1 → `updateBlock`/`insertOrUpdate…` 路径；非空 → `insertBlocks` after；外点关闭 |
| 手工 | 空行 / 已有段落 / 代码块旁点 `+`；对照 preview §3 |
| 回归 | slash `/` 菜单仍可用且不受影响 |

### 3.3 提交

```
feat(knowledge): + opens insert menu at handle (sidemenu S2)
```

---

## 4. S3 — `⋮⋮` 块菜单（P0，0.5–0.75 人日）

**目标**：点击六点打开 Notion 主路径菜单；拖拽排序不回归。

### 4.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| S3-1 | 菜单项重排 | `KnowledgeDragHandleMenu` 子节点顺序 | 1. **转换成… ▸** `TurnIntoItem`（`Generic.Menu` `sub: true`，抄 `BlockColorsItem`）<br>2. **颜色 ▸** 复用 `BlockColorsItem`<br>3. **复制链接到块**（现有 CopyBlockLinkItem，改 label）<br>4. **创制副本** `DuplicateBlockItem`：`insertBlocks([structuredClone 安全子集], block, 'after')`<br>5. 分隔<br>6. **加入多选**（保留 MultiSelectItem）<br>7. 分隔<br>8. **删除**（RemoveBlockItem + danger 样式） | 项序与 preview / Notion Help 一致；hip 扩展在分隔后 |
| S3-2 | Turn into 执行 | 新小组件 | 子菜单类型表与 S2 核心集一致；`editor.updateBlock(block, { type, props })`；失败 toast | 段落 → 待办 / 标题可转换 |
| S3-3 | Duplicate 安全克隆 | 同上 | 不要原样 clone 内部运行时字段；构造 `PartialBlock`：`{ type, props, content }`（表格/代码抽测） | 副本出现在下方且可编辑 |
| S3-4 | 菜单方向 | `DragHandleButton` / Menu.Root | `position: "right"`（现 left） | 向内容区展开，左缘不裁切 |
| S3-5 | 拖/点冲突 | `KnowledgeDragHandleButton` | pointerdown 记录坐标；move > 4px 则 `suppressClick`；与现有 multiselect 兼容 | 轻点开菜单；拖动能排序 |
| S3-6 | i18n | `src/i18n/*.ts` | `turnInto` / `duplicate` / `copyLinkToBlock` / 删除沿用 | 中英文案可读 |

### 4.2 测试（S3）

| 类型 | 内容 |
|---|---|
| 单测 | 菜单子项 testid 存在；Duplicate 调用 `insertBlocks`；Turn into 调用 `updateBlock`；删除仍走 `removeBlocks` |
| e2e | `knowledge-multiselect` 等：若依赖旧菜单入口，改为新项 label/testid |
| 手工 | 拖拽跨块；打开菜单后移动鼠标到子菜单「转换成」不闪（freezeMenu） |

### 4.3 提交

```
feat(knowledge): Notion-like block handle menu (sidemenu S3)
```

---

## 5. S4 — 打磨与回归（P1，0.5–1 人日）

| # | 任务 | 验收 |
|---|---|---|
| S4-1 | `codeBlock`（及必要类型）`--kb-handle-shift` 首行对齐 | 手柄不悬在代码底色上方 |
| S4-2 | 暗色主题 grip 色、菜单 danger、focus ring | 对照 preview 切深色 |
| S4-3 | 窄窗 + 大纲打开：gutter 不触发横向滚动条闪烁 | `knowledge-doc-inline-pad` 下仍可用 |
| S4-4 | 全量相关测试 | 见 §6 |
| S4-5 | 更新 plan 状态勾选；可选：在 `doc-notion-polish-plan.md` PR-4 行注明「侧栏手柄由 sidemenu-fix v3 承接/修正」 | 文档一致 |

### 提交

```
fix(knowledge): sidemenu polish + regression (sidemenu S4)
```

---

## 6. 测试矩阵

| 层级 | 命令 / 用例 | 覆盖 |
|---|---|---|
| 类型 | `yarn tsc` | middleware / 新组件 props |
| 单测 | `yarn test src/components/knowledge/DocBlockNoteEditor` | 壳、菜单、转换、副本 |
| 单测 | `yarn test src/domain/knowledge/blockNoteSlash`（若抽 sideMenuBlocks） | 类型表与 slash 一致 |
| e2e | 既有 `knowledge-live*.spec.ts` / multiselect | 选择器迁移后全绿 |
| 手工对照 | 打开 `doc-editor-sidemenu-fix-preview.html` §2–§3 | 视觉 + 点击路径 |

**手工验收清单（合入前勾完）** — 摘自 spec §5：

- [ ] 横向 `[+][⋮⋮]`，贴首行，非竖条  
- [ ] 六点 6 实心圆、紧凑居中  
- [ ] `+` 细线十字  
- [ ] 点 `+` → 手柄旁插入菜单；空块转换 / 非空插入  
- [ ] 点 `⋮⋮` → 转换成 / 颜色 / 复制链接 / 副本 / 多选 / 删除  
- [ ] 拖六点可排序；块顶出视口手柄仍可见  
- [ ] `/` slash 与右键菜单不坏  

---

## 7. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| 自定义 drag handle 破坏 HTML5 / BN 拖拽 | 高 | S1 单独提交；拖拽失败则方案 B（data-URI 图标）并保留官方 `DragHandleButton` |
| `updateBlock` 转换丢 content | 中 | Turn into 单测覆盖 paragraph↔list↔heading；失败 toast，不静默 |
| `structuredClone` 副本脏字段 | 中 | 只拷 `type/props/content`；表格块手工测 |
| freezeMenu 泄漏（菜单关不掉） | 中 | 一切关闭路径 `unfreezeMenu`；unmount cleanup |
| e2e 选择器漂移 | 低 | 保留 `kb-side-menu`、`dragHandleAdd`；新增 testid 不删旧 |

**回滚**：S1/S2/S3 独立 commit，可按切片 revert；CSS 与侧栏逻辑集中，冲突面小于全局 polish。

---

## 8. 非目标（再次冻结）

- Move to、分栏拖放、Comment、AI  
- 两段式「先手柄再浮 +」（已否，与 Notion 官方不符）  
- 继续用 radial-gradient / MdAdd 填充  
- 改浏览视图 / 侧边栏目录行（属 doc-notion-polish PR-5/6，无关）

---

## 9. 开工检查单（Agent / 人执行前）

1. 打开 preview.html，确认 §2 AFTER 为视觉真理源。  
2. 读 `KnowledgeSideMenu` / `SideMenuController` 现状（约 `DocBlockNoteEditor.tsx:315+`、`1405+`）。  
3. 按 **S1 → S2 → S3 → S4** 顺序改；每切片：实现 → 相关测试 → 手工 1 分钟对照 preview → commit。  
4. 全部完成后跑 §6 矩阵，勾 §6 清单。  

**建议首刀命令**

```bash
# 视觉对照
open docs/design/doc-editor-sidemenu-fix-preview.html

# 改完 S1 后
yarn test src/components/knowledge/DocBlockNoteEditor
yarn tsc
```
