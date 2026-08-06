# Spec: 知识库文档编辑体验（已有能力优先）

| Field | Value |
|-------|-------|
| Status | Draft |
| Date | 2026-08-06 |
| Scope | Knowledge Live/Source 编辑路径的 UX 完成度与一致性 |
| 对比参考 | 飞书文档、Notion（手感与基线，非功能对标清单） |
| 取代 | `2026-08-06-knowledge-editor-ux-remediation.md`（本文为正式 spec） |

---

## 0. 一句话

> **不增加新功能。** 把用户已经拥有的写作能力（块编辑、slash、表格、标题、wiki、附件、保存、大纲、Live/Source）做到「打开就能顺畅写完一篇」，默认路径是 Live，Source 是高级逃生舱。

---

## 1. 问题定义

### 1.1 用户痛点（按出现频率）

1. **Live 与 Source 像两个产品**：同一文档，视觉编辑缺 hip 已有入口（slash 方言、wiki），只能躲进源码。
2. **排版未产品化**：Live 近乎 BlockNote 默认皮；Source 已有 14px/1.7/中文字体 —— 切换即「换皮肤」。
3. **表格能插不好用**：有表，但边框/表头/行列操作/宽表滚动未打磨。
4. **半接线能力**：wiki、附件等 props 已传到 Live 未使用；用户以为「没有」。
5. **稳定性质疑**：切文档偶发异常、Live e2e flaky —— 不敢把 Live 当唯一路径。

### 1.2 根因（工程）

| 层 | 现状 |
|----|------|
| Live | BlockNote 0.52 薄封装；`knowledge-blocknote.css` 几乎只透明背景 |
| Source | CodeMirror + 自研 toolbar/slash/wiki，能力更完整 |
| 存储 | Markdown；`blocksToMarkdownLossy` 产品已接受，但方言往返可感知丢 |
| 产品壳 | 模式埋 ⋯ 菜单；openDoc 总偏 Live |

### 1.3 成功标准（可验收）

用户在 **Live 默认** 下完成「日常 15 分钟写作」清单（§7）全部项，且：

- Live / Source **正文字号、行高、字体、页宽、选区色**一致；
- 已有能力在 Live **可发现、可完成、不静默丢内容**；
- 连续切 10 篇文档无串稿、无 uncaught。

---

## 2. 范围

### 2.1 In scope（只做体验）

| 类别 | 说明 |
|------|------|
| 排版与纸张 | 字号、行高、标题阶梯、字体栈、页宽、段距、文末留白、选区色 |
| 表格 | 皮肤、表头、单元格、横滚、行列 handles、与 slash 骨架一致 |
| 块与格式 | 手柄热区、气泡精简、快捷键与 Source 对齐、占位符 i18n |
| 已有入口接通 | slash 目录统一、wiki 补全/跳转、附件错误文案、模式切换可见 |
| 方言保全 | 不新增语法；保证已有 callout/mermaid/math/svg/embed **保存不丢** |
| 稳定与反馈 | 切文档/卸载、IME、保存状态、大文档降级文案 |
| 大纲 | 已有 TOC 跳转在 Live 准确 |
| 工程卫生 | 死 props、孤儿组件、Milkdown 注释、关键 e2e |

### 2.2 Out of scope（明确不做）

- 实时协作、评论、权限
- 新块类型 / 新 Markdown 方言 / 数据库 / 多列布局
- 换编辑器引擎或存储改 JSON
- AI 写作条、新导出格式
- 知识树 / 图谱 / 模板的产品重做（除非挡编辑路径的入口文案）
- 恢复第三种「预览写作态」

### 2.3 原则

1. **能力只接通与打磨，不发明。** 目录以 `slashMenu.ts` 为准。
2. **一条主路径。** 80% 预算在 Live；Source 不回退。
3. **损失可预期。** lossy 可接受，禁止静默吃掉用户刚插入的已有方言。
4. **外科手术。** 不顺手重构 store/tree。
5. **先测后改。** P0/P1 必须有自动化断言。

---

## 3. 体验基线（飞书 / Notion → Hip）

| 维度 | 学谁 | Hip 落点 |
|------|------|----------|
| 默认单一画布、chrome 克制 | Notion | Live 默认；工具条短 |
| 中文 IME、`/` 中文检索 | 飞书 | slash keywordsZh；composition 不误触 |
| 块手柄 + `/` + 快捷键三入口一致 | 两者 | 同一 `slashMenu` 能力三处可达 |
| 页宽适中、正文易读 | Notion | max-width + 统一 type scale |
| 表格日常够用 | 飞书偏强 | 打开 handles + 皮肤，不做数据表 |
| 保存无感、失败可恢复 | 两者 | 沿用 debounce；强化 Error 态 |

---

## 4. 已有能力矩阵（改前 → 目标）

| 已有能力 | Live 改前 | Source 改前 | 目标 |
|----------|-----------|-------------|------|
| 段落/标题/列表/任务/引用/代码 | 原生可用，皮未调 | MD + 工具条 | 两侧排版一致；Live 皮产品化 |
| 表格 | 能插，体验毛 | MD 骨架 | Live 表可用好看；骨架一致 |
| Slash | 库存 BlockNote | hip 全目录 | **同一目录** |
| 行内格式 + 快捷键 | 默认 | 完整 keymap | **键位对齐** |
| 块拖拽 / 侧栏 | 默认 | 无 | 热区与主题 |
| Wiki `[[` | props 空接 | 补全+语法 | Live **接通** |
| 图片/附件 | upload 部分 | 完整 | 入口与错误文案对齐 |
| callout/mermaid/math/svg/embed | 易 round-trip 丢 | 一等 | **保全不丢**（Live 内预览可不增强） |
| 标题（页） | InlineDocTitle | 同 | Enter/Tab 进正文 |
| 保存 / Cmd-S / blur flush | 有 | 有 | 状态可读；不串稿 |
| 大纲 / 反链 | 有，Live 跳转弱 | 行号准 | Live 跳转准 |
| Live ↔ Source | ⋯ 菜单 | 同 | **一级切换** + 合理记忆 |
| 大文档 >512k | 强制 Source | 可写 | 策略保留，文案友好 |

---

## 5. 详细需求（按优先级）

### P0 — 敢用：稳定与读感

> 没有 P0，后面 polish 无意义。

#### P0.1 排版 token 统一（文字大小等）

**现状**：Source `fontSize: 14px`、`lineHeight: 1.7`、中文 sans 栈；Live 继承 BlockNote/Inter，CSS 几乎未覆盖。

**要求**（Live 与 Source 共用一组 CSS 变量，建议挂在 `.knowledge-doc-paper` 或编辑根上）：

| Token | 建议值 | 备注 |
|-------|--------|------|
| `--kb-font-body` | 15px | 介于飞书与 Notion；可配置但不做设置页 |
| `--kb-line-body` | 1.7 | 与 Source 现状对齐 |
| `--kb-font-family` | 系统 UI + PingFang SC / YaHei … | Live **停止强依赖 Inter 正文** |
| `--kb-font-mono` | ui-monospace 栈 | 代码块/行内代码 |
| `--kb-h1/h2/h3-size` | 1.75em / 1.375em / 1.15em | 相对 body；字重 600–650 |
| `--kb-block-gap` | 0.15–0.25rem | 块间距呼吸 |
| `--kb-para-gap` | 0.35em | 段间 |
| `--kb-measure` | min(100%, 46rem) | 正文栏宽，居中 |
| `--kb-pad-bottom` | max(8rem, 30vh) | 文末留白 |
| `--kb-selection` | accent 约 22% mix | 与 Source 选区一致 |

**标题（页级）**：保持 `InlineDocTitle` 的 `text-page`；与正文 H1 视觉区分（页标题更大/更重，正文少用重复巨标题）。

**验收**：同一文档 Live↔Source 切换，正文字号/行高/字体无明显跳动；截图对比暗色/亮色。

#### P0.2 切文档与卸载稳定

- 收敛 `hardenTiptapViewTeardown`：能去掉则去，不能则最小包装 + 注释版本原因。
- 快速连点树节点：无串稿、draft `docId` 门闩有效。
- DEV 连续开 20 篇无 uncaught。

#### P0.3 IME

- 中文拼音组合期：不误开 slash、不吞字、Enter 确认符合系统习惯。
- Live / Source 行为一致。

#### P0.4 保存反馈

- Saving / Saved / Error 在现有状态位可读。
- Error 可重试；不静默失败。

#### P0.5 大文档降级文案

- >512k 进 Source：说明是性能策略，不是损坏；仍可完整编辑。

---

### P1 — 好用：已有能力在 Live 闭环

#### P1.1 Slash 目录统一

- **唯一数据源**：`src/domain/knowledge/slashMenu.ts`。
- Live 映射：
  - 原生块（标题/列表/任务/表/引用/代码/图…）→ BlockNote API，避免「插 MD 再全量 reparse」导致光标乱跳。
  - hip 方言项 → 见 P1.2。
- 分组、中英 keywords、i18n label 不复制第二份表。
- 占位符：`t('knowledge.doc.placeholder')`，去掉硬编码 `Type '/' for commands`。

#### P1.2 已有方言保全（不新做预览）

对 callout / mermaid / math / svg / embed：

- **最低线（必须）**：Live 插入或打开含这些结构的文，编辑其它段再保存，结构仍在（允许空白归一）。
- **推荐实现**：无法用原生 block 表达时，用带语言标记的 code/paragraph 承载原始 fence/语法，serialize 回既有 MD。
- **不做**：本阶段不强求 Live 内 mermaid 渲染、callout 彩色卡片（Reader/导出已有）。

金标：每个 `KnowledgeSlashId` 一条 round-trip 测（可放 `mdNormalize` 旁）。

#### P1.3 Wiki 接通（已有 API）

`DocBlockNoteEditor` 已声明 `wikiNodes` / `onWikiNavigate`，Workspace 已传：

- `[[` 补全（过滤逻辑复用 `wikiCmCompletion` 域层）。
- 渲染可点 → `onWikiNavigate`。
- 序列化为既有 `[[…]]` 形态。
- 孤儿 `WikiLinkPicker`：收编共用或删除，禁止第三套。

#### P1.4 表格体验（已有表，不升级成数据库）

| 项 | 要求 |
|----|------|
| 皮肤 | 表头底、单元格 padding、边框用 hip `border`/`surface`；暗色可读 |
| 操作 | 露出 BlockNote table handles：增删行列；热区可点 |
| 导航 | Tab / Shift-Tab 移格（确认默认 keymap） |
| 宽表 | 外层横向滚动，不撑破纸张 |
| 骨架 | 与 Source `TABLE_SKELETON_3X2` 一致 |
| 往返 | 简单表 Live↔MD 不丢行列；复杂/合并若 lossy 不静默（可提示用 Source） |

#### P1.5 附件入口对齐

- Live 响应已有 `onRequestAttach`；失败 reason 与 Source 同一套 toast/文案。

#### P1.6 模式切换产品化

- 文档顶栏或纸角：**Visual | Source** 一级入口（从 ⋯ 提升）。
- 切换前 `flushDraft`。
- 记忆策略（产品默认建议）：**按文档记忆**（session 或 local map）；新文档默认 Live。  
  - 备选：仅会话内记忆。禁止「用户刚切 Source 写着，失焦又被打回 Live」。

---

### P2 — 顺手：手感与视觉

#### P2.1 Block 手柄与气泡

- 侧栏 drag handle hover 明显、热区加大。
- 气泡工具条只保留日常：粗/斜/删除线、链接、标题层级；（若有颜色且默认自带可留）去掉生僻噪音项。

#### P2.2 快捷键表对齐

Live 补齐与 Source 同语义（已有的才对齐，不发明新键）：

| 动作 | 键 |
|------|-----|
| 粗/斜/行内代码 | Mod-b / i / e |
| H1–H3 | Mod-Alt-1/2/3 |
| 无序/有序/引用 | 与 Source 现网一致 |
| 保存 | Mod-s |

全局 shortcut 冲突时：知识页聚焦优先文档键。

#### P2.3 列表 / 任务 / 代码 / 引用 / 图

- 任务 checkbox 尺寸与缩进步进可读。
- 行内代码浅底 + 略小 mono；围栏代码块圆角 + token 底。
- 引用左边线；hr 间距。
- 图片：最大宽度随 measure、圆角；选中态清晰（用 BlockNote 已有能力，不新做图床）。

#### P2.4 大纲跳转

- Live 标题稳定 id（或 blockId 映射）；`KnowledgeOutlinePanel` 按 id 跳。
- `scroll-margin-top` 避免被顶栏遮挡。
- 同名标题不再误跳。

#### P2.5 主题融入 hip

- 系统覆盖 `knowledge-blocknote.css`：菜单/侧栏/气泡阴影与 `border`/`surface`/`ink`/`accent` 一致。
- 优先 CSS 变量，少绑死内部 class，降低 BlockNote 升级成本。
- 去掉「嵌了 Mantine 演示站」感。

#### P2.6 页标题流

- 标题 Enter 或 Tab → 焦点落入正文首块（常见文档习惯）。

---

### P3 — 不回潮：工程

- Milkdown 命名/注释 → Live/BlockNote。
- `slashMenu.ts` 头注释改为 Source+Live 共用。
- DocReader 定位：只读/导出/历史，非第三编辑态。
- 未使用 props → 实现或删除；ESLint 盯紧。
- Live 关键路径 e2e 稳定化，逐步入门禁；flaky quarantine 并修根因。

---

## 6. 非功能

| 项 | 要求 |
|----|------|
| 性能 | 不恶化 openDoc / 首敲；512k 阈值不变除非有数据 |
| 兼容 | 旧 MD 文件可读可存；frontmatter 仍不进 Live 解析体 |
| 无障碍 | 菜单键盘上下/Enter/Esc；对比度达标 |
| i18n | 占位符、slash、模式切换、降级条走现有 i18n |
| 安全 | 不引入远程 HTML 执行；附件限额保持 |

---

## 7. 验收清单（日常 15 分钟）

以下默认在 **Live** 完成（含高级 fence 的旧文除外）：

1. 新建 → 改标题 → 中文 IME 输入 → 保存态正常。  
2. `/` + 中文关键字插入标题/列表/任务/代码/表；光标位置正确。  
3. 选区气泡与 Mod-b 加粗一致。  
4. 块拖拽调序；列表 Enter/Backspace 不怪异。  
5. 表格：改单元格、Tab 移格、增行或增列、宽表可横滚。  
6. `[[` 补全并跳转；坏链可辨。  
7. 粘贴图片成功或错误文案与 Source 一致。  
8. 大纲点 H2 滚到正确位置。  
9. 连切 10 文档：无白屏、无串稿、无 uncaught。  
10. Visual↔Source 往返不丢字；含 mermaid/callout 的文保存后结构仍在。  
11. Live/Source 正文字号与行高目测一致。

---

## 8. 实施计划

### 阶段 A — P0（约 3–5 人日）

排版 token、稳定、IME、保存反馈、大文档文案。

**主文件**：`knowledge-blocknote.css`、`DocEditor.tsx`（theme 改变量）、`DocBlockNoteEditor.tsx`、`KnowledgeDocCanvas.tsx` / paper class、`knowledgeStore` 竞态、文案 i18n。

### 阶段 B — P1（约 5–8 人日）

Slash 统一、方言保全金标、wiki 接通、表格皮肤+handles、附件、模式切换。

**主文件**：`DocBlockNoteEditor.tsx`、`slashMenu.ts`、`KnowledgeSlashMenu.tsx`、`KnowledgeWorkspace.tsx`、wiki 域与 UI、表格相关 CSS/schema 配置。

### 阶段 C — P2（约 3–5 人日）

手柄/气泡、快捷键、列表代码引用图、大纲 id、主题、标题流。

### 阶段 D — P3（约 2–3 人日）

卫生、e2e 门禁。

### 里程碑

| 里程碑 | 退出条件 |
|--------|----------|
| M1 | §7 之 1、9、11 + 无 uncaught |
| M2 | §7 之 2–7、10（wiki/表/slash/方言） |
| M3 | §7 全过 + P2 观感签字 |
| M4 | 关键 e2e 稳定、注释/死代码清理完 |

每阶段：`yarn test` 相关单测 + knowledge e2e 子集 + 人工 §7。

---

## 9. 风险与默认决策

| 风险 | 缓解 |
|------|------|
| BlockNote 0.52 API 与自定义 slash/table 细节 | 适配层只放 `DocBlockNoteEditor`；先查版本文档 |
| 方言在 Live 仅「代码块形态」 | 文案不宣称 Live 预览；Reader/导出仍渲染 |
| CSS 绑死内部 class 升级痛 | 变量优先 |
| contenteditable e2e 不稳 | 优先 editor API + testid |
| 过度打磨拖垮排期 | 严格 P0→P1→P2；P2 可裁 |

**产品默认（可改，需显式否决）**：

1. 含高级块文档：**留 Live + 保全**，不强制 Source。  
2. Source 偏好：**按文档记忆**。  
3. 正文字号：**15px**（非设置项）。

---

## 10. 代码地图

| 区域 | 路径 |
|------|------|
| Live | `src/components/knowledge/DocBlockNoteEditor.tsx` |
| Live 样式 | `src/components/knowledge/knowledge-blocknote.css` |
| Source | `src/components/knowledge/DocEditor.tsx` |
| Slash | `src/domain/knowledge/slashMenu.ts`、`KnowledgeSlashMenu.tsx` |
| 壳 | `KnowledgeWorkspace.tsx`、`KnowledgeDocCanvas.tsx`、`InlineDocTitle.tsx` |
| 模式 | `src/domain/knowledge/editorMode.ts` |
| Wiki | `wikiLink.ts`、`wikiCmCompletion.ts` |
| 保存 | `src/store/knowledgeStore.ts` |
| 大纲 | `KnowledgeOutlinePanel.tsx`、`DocOutline.tsx` |
| E2E | `e2e/specs/knowledge-live*.ts`、`knowledge-editor.spec.ts` |

---

## 11. 附录：与旧稿关系

- 旧文 `knowledge-editor-ux-remediation.md` 中的对比与痛点诊断并入本文 §1–§3。  
- 本文 **重排优先级**：排版/表格/已有入口体验 **先于** 大而全「功能对齐叙事」。  
- 实施以本文 §5–§8 为准。
