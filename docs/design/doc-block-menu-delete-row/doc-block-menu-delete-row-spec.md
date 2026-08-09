# 六点手柄菜单 · 行几何与子菜单整改 Spec

> 版本：v1.1（2026-08）— 在 v1.0「删除换行」上扩展：**子菜单（转换成… / 颜色）是否整改**的分析与决策。  
> 范围：Live 文档编辑器中，点击行首 **六点手柄 `⋮⋮`** 弹出的**块操作菜单**及其**级联子菜单**。  
> 配套预览：`docs/design/doc-block-menu-delete-row/doc-block-menu-delete-row-preview.html`  
> 前置：`docs/design/doc-editor-sidemenu-fix-spec.md`（v3，手柄/菜单项序已落地）  
> 涉及代码：
> - `src/components/knowledge/DocBlockNoteEditor.tsx`（`DeleteBlockItem` / `TurnIntoItem` / 菜单装配）
> - `src/components/knowledge/knowledge-blocknote.css`
> - `src/domain/knowledge/sideMenuBlocks.ts`（Turn into 目录）
> - BlockNote 内置：`BlockColorsItem` + `ColorPicker`（`@blocknote/react`）

---

## 0. 问题现象

用户反馈：**文档管理 → 块左侧六点矩阵菜单里，「删除」换行了**。

扩展审视后，同一菜单内还有**两级子菜单**，装配方式与删除高度同源，需要一并判断「是否整改、改到什么程度」。

### 0.1 主菜单 · 删除换行（P0 · 已确认坏）

```
┌─────────────────────────┐
│  转换成…              ▸  │
│  颜色                 ▸  │
│  🔗  复制链接到块        │
│  ⎘  创制副本             │
│  ─────────────────────  │
│  ☑  加入多选             │
│  ─────────────────────  │
│  🗑                      │  ← 图标独占一行
│  删除                    │  ← 文案掉到下一行
└─────────────────────────┘
```

### 0.2 子菜单 · 现状素描

```
主菜单                         转换成… ▸                    颜色 ▸
┌──────────────────┐          ┌─────────────────┐          ┌──────────────────┐
│ 转换成…        ▸ │──┐       │ ¶  正文          │          │ 文字颜色          │ ← Label
│ 颜色           ▸ │  │       │ H1 标题 1        │          │ A  默认        ✓ │
│ 🔗 复制链接…    │  ├──────▶│ H2 标题 2        │          │ A  灰色           │
│ ⎘ 创制副本      │  │       │ …共 12 项        │          │ …×10              │
│ ──              │  │       │ 💡 标注          │          │ 背景颜色          │ ← Label
│ ☑ 加入多选      │  │       └─────────────────┘          │ ■  默认        ✓ │
│ ──              │  │                                     │ …×10              │
│ 🗑 删除（坏）    │  │                                     └──────────────────┘
└──────────────────┘  │                                              ▲
                      └──────────────────────────────────────────────┘
```

---

## 1. 根因与结构对照

### 1.1 三种装配方式并存（混乱源）

| 项 | 装配 | 图标 | 风险 |
|---|---|---|---|
| 复制链接 / 副本 / 多选 | `Menu.Item` + **`icon={svg}`** | `leftSection` | 低 · 正确范式 |
| **删除** | `RemoveBlockItem` children 内 `<span>` + SVG | 文本流 | **高 · 已换行** |
| **转换成…（父）** | `subTrigger` Menu.Item，无 icon | 无 | 中 · 与下方带图标项不对齐 |
| **转换成…（子）** | children 内 `<span class="kb-add-menu-icon">` + emoji/字 | 文本流 | **中 · 与删除同构**；单字图标暂未换行，但左缘与主菜单 `leftSection` 不共线 |
| **颜色（父）** | 同转换成父 | 无 | 中 · 同上 |
| **颜色（子）** | BlockNote `ColorPicker`：`icon={ColorIcon}` + `checked` | `leftSection` | 低布局 / **中体验** · 20 行长列表 |

删除与 Turn-into **子项**是同一反模式：

```tsx
// TurnIntoItem 子项（现状）—— 与 Delete 同构
<Components.Generic.Menu.Item className="bn-menu-item" onClick={…}>
  <span className="kb-add-menu-icon">{item.icon}</span>
  {label}
</Components.Generic.Menu.Item>
```

### 1.2 删除为何先爆、Turn-into 子项为何「还没爆」

| 因素 | 删除 | 转换成子项 |
|---|---|---|
| 图标类型 | Lucide SVG 14×14（常 `display:block` 倾向） | 单字/emoji 字符串（`¶` `H1` `•`） |
| 容器 | 无 flex 的 span | `.kb-add-menu-icon` 有 `width:1.25rem` 但仍在 children 流内 |
| 触发换行 | **已发生** | 多数视口未发生，但窄宽/缩放/长 locale 下仍可能 |
| 对齐 | 无 leftSection，整列错位 | 看起来「有图标」，实则与主菜单 SVG 列**不是同一套槽** |

结论：**不要等 Turn-into 也换了再修**；它和删除应共享同一行几何契约。

### 1.3 颜色子菜单的问题性质不同

颜色子菜单**布局基本正确**（走了 `icon` prop），问题在**信息架构与视觉密度**：

| # | 问题 | 对照 |
|---|---|---|
| C1 | 文字色 10 + 背景色 10 = **20 行 + 2 个 Label**，纵向过长 | Notion：两行色板 swatch，一屏内扫完 |
| C2 | `ColorIcon` 是带字「A」的方块列表项，不是色点网格 | 选择颜色是**空间扫描**任务，列表强迫线性阅读 |
| C3 | Section Label 用 Mantine 默认，未贴 hip token | 与主菜单气质脱节 |
| C4 | 当前色靠右侧小勾，可接受 | 保留 |
| C5 | 父行无预览色点 | Notion 父行有时带当前色指示（可选） |

→ 这是 **P2 体验升级**，不是 P0 缺陷。可与删除/Turn-into **分 PR**。

---

## 2. 要不要整改子菜单？—— 决策

| 区域 | 整改？ | 优先级 | 理由 |
|---|---|---|---|
| 主菜单 · 删除行 | **必须** | **P0** | 已换行，可见缺陷 |
| 主菜单 · 行几何契约（全项 nowrap + icon 槽） | **必须** | **P0** | 删除修复的承载体；顺带让父级「转换成/颜色」可加 leading icon |
| 子菜单 · 转换成… 子项装配 | **必须（轻量）** | **P1** | 与删除同构反模式；改法几乎零成本（`icon={…}`）；顺带当前类型 ✓ |
| 子菜单 · 转换成… 信息架构（分组） | 建议 | P2 | 12 项可一级列出；分组（文字/列表/块）锦上添花，不阻塞 |
| 子菜单 · 颜色 · 保持 BlockNote 列表 | 可维持 | — | 功能正确，无换行 |
| 子菜单 · 颜色 · 改为 swatch 色板 | **建议但不阻塞** | **P2** | 体验明显更好；工作量大于 P0/P1，独立 PR |
| 级联交互（hover 打开 / 右展 / Esc） | **维持** | — | Mantine Sub 已具备；只补 CSS，不重造级联 |

### 2.1 一句话决策

> **P0+P1 一起做**：主菜单行契约 + 删除 + Turn-into 子项改走 `icon` 槽（与主菜单同一几何）。  
> **颜色色板网格放到 P2**：先在预览里给出目标态，实施可另开。  
> **不要**为子菜单再发明第二套组件体系。

---

## 3. UX 目标与原则

> **一句话**：主菜单与所有级联子菜单共享**同一行几何**；子菜单只多「当前态指示（✓ / 色点）」；危险项与选择项语义分离。

### 3.1 行几何契约（主菜单 = 子菜单）

```
|← pad 8 →|← icon 16 →|← gap 8 →|← label flex →|← trailing →|← pad 8 →|
                          nowrap text         ▸ or ✓
```

| 属性 | 值 |
|---|---|
| 行高 | 32px |
| 图标列 | 固定 16×16；图形 ≤14px 居中 |
| 文案 | `white-space: nowrap`；整行 `flex-wrap: nowrap` |
| 子菜单触发行 trailing | `▸`（Mantine 默认 chevron 可皮肤化） |
| 选择态 trailing | `✓`（Turn-into 当前类型 / 颜色当前色，已有 checked） |
| 子菜单宽度 | Turn-into：`min-width: 12rem`；颜色 P0 维持列表宽，P2 swatch 约 `200–220px` |
| 展开方向 | `position: right`；贴右缘时由 Mantine flip |

### 3.2 主菜单父行（转换成… / 颜色）

| 维度 | 决策 |
|---|---|
| Leading icon | **加**：Turn-into 用 `Type`/`Shuffle`；颜色用 `Palette`（14px 线标）—— 与下方 Link/Copy 对齐 |
| 文案 | 保持「转换成…」「颜色」 |
| 打开方式 | **Hover 意图打开**（Mantine Sub 默认）+ 点击亦可；不改为纯 click-only |
| 当前态 | 父行**不**写死当前类型文案（避免宽度跳动）；靠子菜单 ✓ |

### 3.3 转换成… 子菜单

| 维度 | 决策 |
|---|---|
| 项集合 | 维持 `SIDE_MENU_BLOCKS` 12 项（与 + 菜单同源） |
| 图标 | 继续用目录里的字符串 icon（`¶` `H1` `•`…），但必须进 **`icon` prop / leftSection**，禁止 children 内 span |
| 当前类型 | **显示 ✓**（`checked={block matches}`）—— Notion 有，hip 现状无 |
| 点击 | `updateBlock` 后关闭整棵菜单 |
| 分组 | P1 可不分组；P2 可插 Divider：文字样式 / 列表 / 插入块 |
| 与 + 菜单关系 | 目录同源、交互不同（+ = 插入或空块转换；Turn-into = 原地转换）—— 视觉行高/图标槽对齐，组件可继续两套入口 |

### 3.4 颜色子菜单

#### P1（随主契约，最小改动）

- 保留 BlockNote `ColorPicker` 列表。
- 仅保证：落在统一 `.bn-menu-item` 行几何下；Label 用 hip 次级字色；dropdown padding 与主菜单一致。
- **不**改 ColorIcon、不改 20 行结构。

#### P2（目标态 · 预览已体现 · 另 PR）

```
┌─ 颜色 ──────────────────┐
│ 文字                     │
│  (○)(●)(●)(●)(●)        │  ← 5+5 swatch 圆点，当前环绕 focus ring
│  (●)(●)(●)(●)(●)        │
│ 背景                     │
│  (□)(■)(■)…             │  ← 圆角方点区分「背景」
└──────────────────────────┘
```

| 维度 | 决策 |
|---|---|
| 布局 | 两段 label + **色点网格**（非 20 行 Menu.Item） |
| 文字色 | 圆点实心；默认 = 描边空心 +「A」或斜杠 |
| 背景色 | 圆角方点；默认 = 斜线/无填充 |
| 当前色 | swatch 外环 `2px` accent/ ink |
| 点击 | 即时 `updateBlock`；菜单可保持打开以便连选（Notion 行为）或关闭—— **建议保持打开** 方便试色，点外侧/Esc 关 |
| 实现 | 自研轻量 `KnowledgeBlockColorPanel` 替换 `ColorPicker` 子树；仍挂在 `Menu.Dropdown sub` 下 |
| a11y | 每个 swatch `role="menuitemradio"` / `aria-checked`；方向键在网格内移动 |

### 3.5 危险项（删除）—— 继承 v1.0

- 主菜单底部 + 分隔；`--danger` 字/图标；hover `danger 10%` 底；无确认；多选删选区。
- 结构：自定义 `Menu.Item` + `icon={Trash2}` + `bn-menu-item-danger`（不用 `RemoveBlockItem` children 塞图标）。

### 3.6 明确不做

| 项 | 原因 |
|---|---|
| 子菜单 portal 到 body | 破坏 SideMenu hover 维持（既有结论） |
| 把 Turn-into 做成大缩略图块选择器 | 过重；12 项列表足够 |
| 颜色与文字样式（粗斜）塞进同一子菜单 | 职责分离；行内样式在 bubble toolbar |
| 删除确认框 | 高频 + Undo |
| 为子菜单单独搞一套字号/行高 | 破坏扫描一致性 |

---

## 4. 解决方案（实施分层）

### 4.1 P0 — 删除 + 主菜单行契约

```tsx
// DeleteBlockItem：与 Duplicate 同构 + 多选语义
<Components.Generic.Menu.Item
  className="bn-menu-item bn-menu-item-danger"
  data-testid="kb-delete-block"
  icon={<Trash2 size={14} strokeWidth={1.75} />}
  onClick={() => { /* removeBlocks(selection| [block]) */ }}
>
  {t('knowledge.doc.blockMenuDelete')}
</Components.Generic.Menu.Item>
```

CSS：主/子菜单统一 `flex-wrap: nowrap`、label nowrap、danger hover（见 v1.0 §3.2，选择器覆盖 `.bn-drag-handle-menu` 与其子 dropdown）。

### 4.2 P1 — 转换成… 子项 + 父行 icon + 当前 ✓

```tsx
// 父
<Menu.Item subTrigger icon={<Type size={14} strokeWidth={1.75} />} …>
  {t('…TurnInto')}
</Menu.Item>

// 子
<Menu.Item
  icon={<span className="kb-menu-glyph">{item.icon}</span>}
  checked={isCurrentType(block, item.id)}
  onClick={() => turnIntoSideMenuBlock(…)}
>
  {label}
</Menu.Item>
```

- `kb-menu-glyph`：16×16 槽内居中，字号 11–12px，`color: var(--text-secondary)`。  
- `isCurrentType`：对照 `block.type` + heading level 等（与 `blockPartialForSideMenu` 逆映射）。  
- 颜色父行同步加 `Palette` icon（仍用内置 `BlockColorsItem` 时，可包一层或 fork 薄封装以传 icon——若 BlockColorsItem 不接受 icon，则 **自研薄封装** 抄其 props 逻辑，成本低）。

### 4.3 P1 — 颜色最小皮肤

```css
.bn-color-picker-dropdown {
  padding: 4px;
  min-width: 12rem;
}
.bn-color-picker-dropdown .mantine-Menu-label {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  padding: 6px 10px 4px;
}
/* 行几何继承 .bn-menu-item nowrap 契约 */
```

### 4.4 P2 — 颜色 swatch 面板（另 PR）

- 新组件 `KnowledgeBlockColorPanel`；`BlockColorsItem` 的 dropdown children 替换为该面板。  
- 预览 §5 为视觉金样。

---

## 5. i18n 与宽度

| 表面 | 最长文案锚点 | min-width |
|---|---|---|
| 主菜单 | 「复制链接到块」 | 12rem |
| 转换成子菜单 | 「无序列表」/「Check list」等 | 12rem |
| 颜色列表（P1） | 词典色名 | 12rem |
| 颜色 swatch（P2） | 两行 label | ~200–220px 固定 |

---

## 6. 无障碍

- 主/子菜单保持 `menuitem` / `menu` 树。  
- 子菜单触发器：`aria-haspopup`（Mantine 自带）。  
- Turn-into 当前项：`aria-checked` via `checked` prop。  
- 颜色 P2 swatch：`menuitemradio` + 方向键。  
- Esc：先关最深子菜单，再关主菜单（Mantine 默认）。

---

## 7. 验收

### 7.1 P0 删除 + 行契约

- [ ] 「删除」单行；图标与 Link/Copy/Multi 左缘共线  
- [ ] danger 色 + 10% hover 底；底部分隔；无确认  
- [ ] 多选删选区；`kb-delete-block` 可 query  
- [ ] 主菜单任意项不换行（含中英日韩）

### 7.2 P1 转换成… + 父 icon

- [ ] 父行有 leading icon + ▸，与主菜单其它行共线  
- [ ] 子项图标在 leftSection；12 项均单行  
- [ ] 当前块类型右侧 ✓  
- [ ] 点击转换后块类型变化、菜单关闭  
- [ ] 子菜单右展；贴右 flip；Esc 分层关闭

### 7.3 P1 颜色皮肤

- [ ] Label 次级色；行高/padding 与主菜单一致  
- [ ] 选色仍生效；当前色有 ✓  

### 7.4 P2 颜色 swatch（可选本迭代）

- [ ] 文字/背景两段网格；当前环；键盘可达  
- [ ] 亮暗色 token 正确  

---

## 8. 实施清单

| # | 优先级 | 文件 | 改动 |
|---|---|---|---|
| 1 | P0 | `DocBlockNoteEditor.tsx` | 重写 `DeleteBlockItem` |
| 2 | P0 | `knowledge-blocknote.css` | 行 nowrap 契约 + danger；覆盖 drag-handle 子 dropdown |
| 3 | P1 | `DocBlockNoteEditor.tsx` | `TurnIntoItem`：父 icon、子 `icon` prop、`checked` |
| 4 | P1 | `sideMenuBlocks.ts` 或 editor 内 | `isCurrentSideMenuType(block, id)` |
| 5 | P1 | `DocBlockNoteEditor.tsx` | 颜色父行 icon：薄封装或 wrap `BlockColorsItem` |
| 6 | P1 | `knowledge-blocknote.css` | `.bn-color-picker-dropdown` label 皮肤 |
| 7 | P0/P1 | `DocBlockNoteEditor.test.tsx` | 删除 / turn-into checked / testid |
| 8 | P2 | 新组件 + CSS | swatch 色板替换 ColorPicker |

预估：P0+P1 **< 120 行**；P2 另计 ~150–200 行。

---

## 9. 风险

| 风险 | 级 | 缓解 |
|---|---|---|
| 自定义删除漏多选分支 | 中 | 抄 `RemoveBlockItem` + 单测 |
| Turn-into `checked` 映射漏 heading level | 中 | 与 `blockPartialForSideMenu` 成对单测 |
| 替换 BlockColorsItem 丢 background/text 能力探测 | 中 | P1 尽量不 fork 逻辑；只加父 icon 时包一层 children |
| 子菜单 nowrap 导致长德文/英文溢出 | 低 | ellipsis + min-width 12rem |
| P2 swatch 与 BlockNote 色名 token 不一致 | 中 | 仍写 `props.textColor` 的 default/gray/… 枚举 |

---

## 10. 回退

- P0/P1 单 PR 可整体 revert。  
- P2 独立 PR。  
- 热修底线：仅 CSS `.kb-menu-danger-label { display:inline-flex; nowrap }` —— 不对齐，只止出血。

---

## 11. 设计决策摘要（给评审）

| 问题 | 决定 |
|---|---|
| 删除换行为何？ | 图标没走 `leftSection` |
| 子菜单要不要动？ | **要**。Turn-into P1 必做（同构反模式）；颜色 P1 只皮肤，P2 再做 swatch |
| 主/子是否两套视觉？ | **否**，同一行几何契约 |
| 颜色是否本迭代改网格？ | **不强制**；预览给目标态，实施可拆 |
| 确认框？ | 删除不要；选色不要 |
