# 六点手柄菜单 · 行几何与子菜单整改 · 执行计划（Plan）

> 依据：`docs/design/doc-block-menu-delete-row/doc-block-menu-delete-row-spec.md`（**v1.1**，方向已确认）  
> 视觉基准：`docs/design/doc-block-menu-delete-row/doc-block-menu-delete-row-preview.html`（§1 主菜单 · §2 转换成… · §3 颜色 · §5 交互舞台）  
> 前置已落地：`docs/design/doc-editor-sidemenu-fix-spec.md` v3 / plan S1–S4（手柄 gutter、菜单项序、Turn into / Duplicate 已在）  
> 范围护栏（spec §3.6，本计划**不包含**）：
> - 删除确认 Modal  
> - 菜单 portal 到 body  
> - Turn-into 大缩略图块选择器  
> - 颜色与 bubble 行内样式合并  
> - 改菜单项顺序（沿用 sidemenu-fix v3）  
> - 全局设计语言改造  
>
> 文件域（窄）：
> - `src/components/knowledge/DocBlockNoteEditor.tsx`（`DeleteBlockItem` / `TurnIntoItem` / 颜色父行）  
> - `src/components/knowledge/knowledge-blocknote.css`  
> - `src/domain/knowledge/sideMenuBlocks.ts`（+ 对应 test：当前类型判定）  
> - `src/components/knowledge/DocBlockNoteEditor.test.tsx`  
> - P2 另增：颜色 swatch 组件（文件名实施时定，建议同目录 `KnowledgeBlockColorPanel.tsx`）  
>
> 估算：**P0 0.25–0.5 人日 + P1 0.5–0.75 人日 + P2（可选）0.75–1 人日 ≈ 0.75–1.25 人日（必做）/ 至 2 人日（含色板）**

---

## 1. 计划总览

| 切片 | 阶段 | 主题 | spec | 依赖 | 估算 | 状态 |
|---|---|---|---|---|---|---|
| **M1** | P0 | **删除行 + 主/子菜单行几何契约** | §1 删除、§3.1、§3.5、§4.1 | 无 | 0.25–0.5 人日 | ✅ |
| **M2** | P1 | **转换成…**：父 icon、子 `icon` 槽、当前类型 ✓ | §1.2、§3.2–3.3、§4.2 | M1（行契约已在） | 0.35–0.5 人日 | ✅ |
| **M3** | P1 | **颜色父行 icon + ColorPicker 皮肤**（仍列表） | §1.3、§3.4 P1、§4.3 | M1 | 0.15–0.25 人日 | ✅ |
| **M4** | P2 | **颜色 swatch 色板**（可选，另 PR） | §3.4 P2、§4.4 | M3 | 0.75–1 人日 | ⬜ 可选未做 |

**推荐合入节奏**

1. **Commit A（M1）**：止血——删除单行 + 全局 nowrap/danger。可单独 dogfood / 合入。  
2. **Commit B（M2+M3）**：子菜单与主菜单图标列对齐；Turn-into ✓；颜色皮肤。  
3. **Commit C（M4，可选）**：颜色 swatch；独立 PR，不堵 A/B。

**并行策略**

| 可并行？ | 说明 |
|---|---|
| M2 ∥ M3 | **谨慎**：同改 `DocBlockNoteEditor.tsx` + 同 CSS 文件 → **串行更稳**（B 内先 M2 后 M3，或一人顺做） |
| M1 → M2/M3 | 串行：M2/M3 依赖 M1 的行契约选择器 |
| M4 vs A/B | 可完全并行开分支（M4 主要加新组件，碰 Color 接线点时 rebase B） |

**不做的事（再强调）**

- 不重排主菜单项序  
- 不改 `SIDE_MENU_BLOCKS` 名单（12 项保持与 + 菜单同源）  
- 不为「看起来整齐」引入第二次确认或动画

---

## 2. M1 — 删除行 + 行几何契约（P0，0.25–0.5 人日）

**目标**：主菜单「删除」始终单行；图标与 Link/Copy/Multi **左缘共线**；danger 态贴 preview §1 AFTER / §4。

### 2.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| M1-1 | 重写 `DeleteBlockItem` | `DocBlockNoteEditor.tsx` | **弃用** `RemoveBlockItem` children 塞 SVG。改为与 `DuplicateBlockItem` 同构：`Components.Generic.Menu.Item` + `className="bn-menu-item bn-menu-item-danger"` + `icon={<Trash2 size={14} strokeWidth={1.75} />}` + 文案 children。`data-testid="kb-delete-block"` 挂在 **Item 根**（或可稳定 query 节点）。 | 删除单行；testid 仍在 |
| M1-2 | 多选删除语义 | 同上 | **原样抄** `RemoveBlockItem`：`const selected = editor.getSelection()?.blocks`；若 selected 含当前 block 则 `removeBlocks(selected)`，否则 `removeBlocks([block])`。需 `useBlockNoteEditor` + `useExtensionState(SideMenuExtension)` 取 block。 | 多选后删 = 整区消失 |
| M1-3 | 清理 import | 同上 | 若无其它引用，删除 `RemoveBlockItem` import。 | 无死 import |
| M1-4 | 行几何 CSS | `knowledge-blocknote.css` | 覆盖 `.bn-drag-handle-menu`（及其子 dropdown）：`.bn-menu-item` → `display:flex; align-items:center; flex-wrap:nowrap; gap:0.5rem; min-width:12rem; min-height:2rem; white-space:nowrap`。`.mantine-Menu-itemLabel` → `nowrap + ellipsis`。leftSection 槽 `16×16` flex-none 居中。 | 主菜单任意项不换行 |
| M1-5 | danger 态 CSS | 同上 | `.bn-menu-item-danger` 及 section/label：`color: var(--danger)`；hover/focus：`background: color-mix(in srgb, var(--danger) 10%, transparent)`。**删除**对 `.kb-menu-danger-label` / `--status-danger` 的依赖。 | 贴 DeclarativeContextMenu；亮暗色 OK |
| M1-6 | 子 dropdown 继承 | 同上 | 选择器不要只写 `.knowledge-blocknote-editor .bn-menu-…`（菜单常 portal 在编辑器外但 withinPortal=false 仍在侧栏树内——以实际 DOM 为准）。**同时**写 `.bn-drag-handle-menu .bn-menu-item` 与 `.bn-menu-dropdown .bn-menu-item` 全局 bn 皮肤已有段，避免子菜单（Turn-into）漏 nowrap。 | Turn-into 子项也被 nowrap（为 M2 打底） |

### 2.2 测试（M1）

| 类型 | 内容 |
|---|---|
| 单测 | `DocBlockNoteEditor.test.tsx`：`kb-delete-block` 可 query；若有结构断言则改为危险 class / 不再依赖 `.kb-menu-danger-label`。可选：mock `removeBlocks`，无 selection 时传入 `[block]`；有 selection 含当前块时传入 selected。 |
| 手工 | 打开 preview §1 AFTER 对照；文档内 hover 块 → ⋮⋮ → 删除单行、红字、淡红 hover；多选两块再删。Cmd/Ctrl+Z 恢复。 |
| 回归 | `yarn test src/components/knowledge/DocBlockNoteEditor`；`yarn test src/domain/knowledge/sideMenuBlocks`（不应被 M1 破坏） |

### 2.3 提交

```
fix(knowledge): block menu delete row single-line + danger geometry (menu M1)
```

### 2.4 退出标准（M1 可单独合）

- [ ] 删除不再换行  
- [ ] 与复制链接等图标列共线  
- [ ] 无确认框；多选语义保留  
- [ ] 相关单测绿  

---

## 3. M2 — 转换成… 子菜单（P1，0.35–0.5 人日）

**目标**：Turn-into 与主菜单同一行几何；子项走 `icon` 槽；当前块类型右侧 ✓；父行 leading icon。对照 preview §2 AFTER。

### 3.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| M2-1 | 当前类型判定 | `sideMenuBlocks.ts` | 新增 `isCurrentSideMenuType(block, id): boolean`：对照 `block.type` + heading `level` + 与 `blockPartialForSideMenu` **成对**（paragraph↔text，heading level 1–3，checkListItem↔task，…）。导出并单测每条 id。 | 12 id 映射全覆盖；未知 type → false |
| M2-2 | 子项改 `icon` prop | `DocBlockNoteEditor.tsx` `TurnIntoItem` | 去掉 children 内 `<span className="kb-add-menu-icon">`。改为 `icon={<span className="kb-menu-glyph" aria-hidden>{item.icon}</span>}`（或纯字符串若 Menu 接受 ReactNode）。`checked={isCurrentSideMenuType(block, item.id)}`。 | 子项单行；当前 ✓ |
| M2-3 | 父行 leading icon | 同上 | `subTrigger` 的 `Menu.Item` 加 `icon={<Type size={14} strokeWidth={1.75} />}`（或 `Shuffle`；与 preview ⇄ 同意图即可，**一种即可**）。保留 `data-testid="kb-turn-into"`。 | 父行与 Link/Copy 图标列共线 |
| M2-4 | glyph CSS | `knowledge-blocknote.css` | `.kb-menu-glyph`：16×16 槽内居中，`font-size: 11–12px`，`font-weight: 600`，`color: var(--text-secondary)`，`line-height: 1`，`flex: none`。可与 `.kb-add-menu-icon` 对齐但**不要**再依赖 children 流布局。 | glyph 不撑破行高 |
| M2-5 | （可选本切片）分组分隔 | `TurnIntoItem` | **默认不做**。若 preview 舞台「分组」验证强需求，可按 text/list/block 插 `Menu.Divider`——**仅当产品点头**；否则留 M4 之后或永不做。 | 默认 12 项一级列表 |

### 3.2 测试（M2）

| 类型 | 内容 |
|---|---|
| 单测 | `sideMenuBlocks.test.ts`：`isCurrentSideMenuType` 表驱动（paragraph/h1/h2/h3/list/task/code/quote/divider/toggle/callout）。`TurnIntoItem`：若有渲染测，断言子项 testid `kb-turn-into-${id}` 仍在。 |
| 手工 | 正文块打开 → 正文带 ✓；转为 H1 → 再开菜单 H1 带 ✓；对照 preview §2。 |
| 回归 | + 插入菜单未改行为；Turn-into 点击仍 `updateBlock`。 |

### 3.3 提交

```
fix(knowledge): turn-into submenu icon slot + current-type check (menu M2)
```

（若与 M3 同 commit，见 §5 合入说明。）

---

## 4. M3 — 颜色父行 + 列表皮肤（P1，0.15–0.25 人日）

**目标**：颜色父行与主菜单共线；ColorPicker 列表继承行契约 + Label 次级色。**不**改 20 行结构。对照 preview §3 左卡。

### 4.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| M3-1 | 父行 leading icon | `DocBlockNoteEditor.tsx` | `BlockColorsItem` **不接受** icon。策略二选一（推荐 A）：<br>**A.** 薄封装 `KnowledgeBlockColorsItem`：抄 `BlockColorsItem` 的 block 能力探测 + ColorPicker 接线，父 `Menu.Item subTrigger` 加 `icon={<Palette size={14} strokeWidth={1.75} />}`。<br>**B.** 若不想 fork：接受颜色父行暂无 icon，只做 M3-2 皮肤——**降级可接受**，PR 注明。 | 推荐 A：父行有 ◐/Palette |
| M3-2 | dropdown 皮肤 | `knowledge-blocknote.css` | `.bn-color-picker-dropdown`：`padding: 4px; min-width: 12rem`。`.bn-color-picker-dropdown .mantine-Menu-label`：`color: var(--text-tertiary); font-size: 11px; font-weight: 600; padding: 6px 10px 4px`。行几何吃 M1 的 nowrap。 | Label 次级色；行高一致 |
| M3-3 | i18n | 仅当 fork 后 Label 仍走 BlockNote dict | **不**新造色名键；继续 BlockNote `useDictionary().color_picker`。确认 app 已注入对应 locale（既有）。 | 中文色名若已有则保持 |

### 4.2 测试（M3）

| 类型 | 内容 |
|---|---|
| 单测 | 若引入 `KnowledgeBlockColorsItem`：无 textColor/backgroundColor 的块类型不渲染该项（与上游一致）。 |
| 手工 | 段落打开颜色 → 文字/背景列表可选；当前色 ✓；暗色主题 Label 可读。 |
| 回归 | 代码块等无颜色 props 的类型：菜单中不出现「颜色」（BlockNote 原逻辑）。 |

### 4.3 提交

```
style(knowledge): block color submenu parent icon + list skin (menu M3)
```

---

## 5. M4 — 颜色 Swatch 色板（P2，可选，0.75–1 人日）

**目标**：用空间色板替换 20 行列表。对照 preview §3 中卡 / §5 舞台「P2 Swatch」。

> **触发条件**：M1–M3 已合入且 dogfood 仍痛感「颜色菜单太长」；或设计评审明确要 Notion 级色板。  
> **否则跳过**，列表皮肤足够。

### 5.1 任务

| # | 任务 | 文件 | 做法要点 | 验收 |
|---|---|---|---|---|
| M4-1 | `KnowledgeBlockColorPanel` | 新文件 `src/components/knowledge/KnowledgeBlockColorPanel.tsx` | props：`text?: {color,setColor}` / `background?: {…}`（对齐 ColorPicker）。两段 label + 5×2 swatch。色枚举仍为 BlockNote 的 `default/gray/brown/red/orange/yellow/green/blue/purple/pink`。 | 与 preview swatch 同构 |
| M4-2 | 样式 | `knowledge-blocknote.css` 或模块 CSS | 文字=圆点；背景=圆角方点；默认=空心/斜线；当前=外环 2px；hover scale 禁止位移弹跳（DESIGN：可极轻或仅 ring）。 | 亮暗色 token |
| M4-3 | a11y | 同上 | swatch：`role="menuitemradio"` + `aria-checked`；方向键在网格内移动（至少左右；上下跨行加分）。 | 键盘可达 |
| M4-4 | 接线 | `KnowledgeBlockColorsItem` dropdown children | 替换 `<ColorPicker …/>` 为 `<KnowledgeBlockColorPanel …/>`。**点击后菜单保持打开**（试色）；Esc/外点关。 | 连选文字色+背景色无需重开 |
| M4-5 | 单测 | `KnowledgeBlockColorPanel.test.tsx` | 点击 swatch 调用 setColor；当前色 aria-checked。 | 绿 |

### 5.2 提交

```
feat(knowledge): block color swatch panel (menu M4)
```

---

## 6. 合入与提交策略

| Commit | 切片 | 说明 |
|---|---|---|
| **A** | M1 | 可单独上线；用户可见「删除不换行」 |
| **B** | M2+M3 | 同文件域一次改完，减少冲突；若 M3 选降级 B（无父 icon）可拆 |
| **C** | M4 | 可选独立 PR |

**同 PR 描述模板（A/B）**

```
## Summary
- 六点块菜单删除行单行化，统一 icon/leftSection 行几何
- [B] Turn-into 子项 icon 槽 + 当前类型 ✓；颜色父行/列表皮肤

## Preview
open docs/design/doc-block-menu-delete-row/doc-block-menu-delete-row-preview.html

## Test
yarn test src/components/knowledge/DocBlockNoteEditor
yarn test src/domain/knowledge/sideMenuBlocks
```

---

## 7. 跨切片验收（对照 spec §7 + preview）

### 7.1 视觉

| # | 项 | 切片 |
|---|---|---|
| V1 | 删除单行；图标与主菜单共线 | M1 |
| V2 | danger 字色 + 10% 红底 hover；底部分隔最后一项 | M1 |
| V3 | 主菜单六项（含转换成/颜色父）图标左缘共线 | M2+M3 |
| V4 | Turn-into 子项 glyph 在 leftSection；当前 ✓ | M2 |
| V5 | 颜色 Label 次级色；行高一致 | M3 |
| V6 | （可选）swatch 网格 + 当前环 | M4 |
| V7 | 亮 / 暗主题 | 全 |

### 7.2 交互

| # | 项 | 切片 |
|---|---|---|
| I1 | 删块立即生效、无确认；多选删选区；Undo 恢复 | M1 |
| I2 | Turn-into 点击 → updateBlock → 菜单关 | M2 |
| I3 | 子菜单右展；贴右 flip；Esc 分层关 | M2（Mantine 既有，回归） |
| I4 | 颜色选色生效；无颜色 props 的块不显示项 | M3 |
| I5 | （可选）swatch 连选保持菜单开 | M4 |

### 7.3 工程

| # | 项 |
|---|---|
| E1 | `kb-delete-block` / `kb-turn-into` / `kb-turn-into-*` testid 保留 |
| E2 | 不再依赖 `.kb-menu-danger-label` |
| E3 | `yarn test` 相关文件绿；无新 TS 错误 |

---

## 8. 风险与缓解

| 风险 | 级 | 缓解 | 切片 |
|---|---|---|---|
| 自定义删除漏多选分支 | 中 | 逐行抄 `RemoveBlockItem`；单测 mock selection | M1 |
| Mantine leftSection 选择器版本漂移 | 低 | danger 上色打在 item 根 class，不唯依赖 section | M1 |
| `isCurrentSideMenuType` 漏 heading level | 中 | 与 `blockPartialForSideMenu` 成对表驱动测试 | M2 |
| Fork `BlockColorsItem` 丢能力探测 | 中 | 原样复制探测条件；或 M3 降级不 fork | M3 |
| 子菜单 nowrap 导致长文案溢出 | 低 | ellipsis + min-width 12rem | M1 |
| M4 swatch 色与 BN token 不一致 | 中 | 只写 BN 色名枚举，不自造色 | M4 |
| 与 sidemenu-fix 后续改动冲突 | 低 | 文件域重叠但职责不同；M 系列只动菜单项装配 | 全 |

---

## 9. 回退

| 层级 | 动作 |
|---|---|
| Commit A | `git revert`；删除恢复换行但功能仍在 |
| Commit B | revert；Turn-into 回到 children icon，无 ✓ |
| Commit C | revert；回到 ColorPicker 列表 |
| 热修底线（不推荐上主仓） | 仅 CSS：`.kb-menu-danger-label{display:inline-flex;nowrap}`——止换行、不对齐 |

---

## 10. 手工对照清单（dogfood）

```bash
# 预览金样
open docs/design/doc-block-menu-delete-row/doc-block-menu-delete-row-preview.html

# 单测
yarn test src/components/knowledge/DocBlockNoteEditor
yarn test src/domain/knowledge/sideMenuBlocks
```

应用内路径：

1. 打开文档管理 → 任意 Live 文档  
2. Hover 段落 → 点击 `⋮⋮`  
3. **删除**：单行？红字？淡红 hover？点下去块消失？Undo？  
4. **转换成…**：悬停展开 → 当前类型 ✓ → 改 H2 → 再开仍 ✓  
5. **颜色**：父行 icon（若 M3-A）→ 改文字色/背景色  
6. 多选两块 → 删除 → 两块都走  
7. 暗色主题重复 3–5  
8. （M4）颜色是否为色板、可否连选  

---

## 11. 状态板（实施时勾选）

| 切片 | 状态 | PR / commit | 备注 |
|---|---|---|---|
| M1 删除 + 行契约 | ✅ | | `DeleteBlockItem` 走 icon 槽 + danger CSS；多选语义抄 RemoveBlockItem |
| M2 转换成… | ✅ | | `isCurrentSideMenuType` + glyph leftSection + 父 Type icon |
| M3 颜色皮肤 | ✅ | | `KnowledgeBlockColorsItem`（Palette 父 icon + 列表）；非 M4 swatch |
| M4 颜色 swatch | ⬜ 可选 | | 未做；列表皮肤足够，痛感再开 |

---

## 12. 与既有文档关系

| 文档 | 关系 |
|---|---|
| `doc-editor-sidemenu-fix-spec/plan` | **前置已完成**；本计划是其后的菜单行质量补丁，不重做 gutter |
| `doc-notion-polish-spec/plan` | 文档域子语言一致；本计划不扩大到浏览列表/标题 ⋯ |
| `doc-block-menu-delete-row-spec` v1.1 | **唯一需求真源**；plan 与之冲突时以 spec 为准 |
| `doc-block-menu-delete-row-preview.html` | **视觉金样**；合入前对照 §1–§3、§5 |

---

## 13. 一句话执行序

> **先 M1 止血删除换行 → 再 M2/M3 收口子菜单与图标列 → M4 色板仅在仍痛时做。**
