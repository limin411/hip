# Knowledge Phase A 可执行任务清单（含代码落点）

> **状态**: ✅ 全部完成（2026-08-07 实施，commit 待提交）
> **来源**: `docs/design/knowledge-rectification-plan.md` §4 Phase A
> **纪律**: 每项含验收标准；新块/载体的 parse↔serialize 必须成对 golden 测试；`yarn tsc` + `yarn vitest run` 保持全绿。

## 关键技术结论（先读，否则会做错方向）

Probe 实证（BN 0.52.1，`blocksToMarkdownLossy`）：

1. **BN 的 Markdown 导出会剥掉所有 style（含自定义样式）和 inline HTML 标签**，只保留文本。
   → highlight `==x==` 目前经 Live 编辑后是**静默丢失**（fidelity 测试只在 bridge 层通过，没经过 BN）——A2 顺带修复。
2. **inline content spec 的 `toExternalHTML` 文本内容会原样进入 Markdown 导出**。
   → wiki/math 的 `toExternalHTML` 直接输出字面方言（`[[title]]`、`$src$`），即可无损 L3 往返。
3. **Markdown 导出接受字面 HTML 文本**（`<span data-hip-color="red">…</span>` 原样通过）。
   → 导出前对文档 JSON 克隆 + 给带样式文本包 carrier，再导出，即可把 textColor/backgroundColor 写入磁盘。

## A1 行内公式 `$…$`（KaTeX inline mark）— ✅ 完成

| 落点 | 改动 |
|------|------|
| `src/domain/knowledge/blocks/mathInline.tsx`（新） | inline content spec：props `{src}`；`toExternalHTML` 输出字面 `$src$`；`parse` 读 `<span data-hip-inline="math">`；render = KaTeX 内联 chip（error 回退红字）；双击经 host context 还原为文本 |
| `src/domain/knowledge/blocks/schema.ts` | 注册 `mathInline` 到 inlineContentSpecs |
| `src/domain/knowledge/blocks/carriers.ts` | `inlineMathMdToHtml`（启发式正则，须在 display-math/fence 替换之后）+ `htmlInlineMathToMd`；接入 `dialectToHtmlCarriers` / `htmlCarriersToDialect` |
| `src/domain/knowledge/blocks/fidelity.ts` | 新增 `inline-math` L3 条目 + golden |
| `src/domain/knowledge/slashMenu.ts` / `blockNoteSlash.ts` | `mathInline` 项（插入 `$` 触发自动转换） |
| `src/components/knowledge/DocBlockNoteEditor.tsx` | keyup 自动转换 `$…$` → mathInline 节点（IME 防护、块内已有 math 节点时跳过）；`KnowledgeEditorHost` 增 `onInlineMathEdit` |
| `src/domain/knowledge/blocks/knowledgeEditorHostContext.tsx` | 扩展 host 接口 |

**验收**：✅ `$e^{i\pi}$` 键入即渲染（keyup 自动转换）；Live↔Source 往返保 `$…$`；golden 测试；`$5 and $10`、`\$` 转义不误伤（`mathInlineConvert.test.ts` 8 例）。

## A2 文字色（textColor/backgroundColor）+ 高亮修复 + 清除格式 — ✅ 完成

## A2 文字色（textColor/backgroundColor）+ 高亮修复 + 清除格式

| 落点 | 改动 |
|------|------|
| `src/domain/knowledge/blocks/styleCarriers.ts`（新） | `wrapStyledInlineForExport(blocks)`：克隆文档，带 style 的文本包 carrier（highlight→`==x==`，textColor→`<span data-hip-color>`，bg→`<span data-hip-bg-color>`）；纯函数 + 单测 |
| `src/domain/knowledge/blocks/carriers.ts` | 预解析：`<span data-hip-color>` → BN 可识别的 `data-text-color` span（沿用 BN 默认 textColor 样式）；`<span data-hip-bg-color>` → `data-background-color`；反向归一化 |
| `src/domain/knowledge/blocks/fidelity.ts` | 新增 `textColor` / `backgroundColor` L2 条目 + probes + goldens |
| `src/components/knowledge/DocBlockNoteEditor.tsx` | `emitDraft` 用 `wrapStyledInlineForExport(editor.document)` 导出（修 highlight 静默丢失）；工具条加 BN `ColorStyleButton` + 自定义「清除格式」（`removeStyles` + 高亮 off） |

**验收**：✅ 红字 Live 编辑 → Source 见 `<span data-hip-color="red">`；回 Live 颜色还在；**修复了 highlight 经 Live 编辑静默丢失的存量 bug**（BN 导出剥 style，现经 `wrapStyledInlineForExport` 克隆+carrier 保全）；清除格式一键还原；golden 全绿。Reader 侧按仓库无 rehypeRaw 策略 strip 标签保内容。

## A5 Source 状态栏（行列 / 字数 / FM）— ✅ 完成

| 落点 | 改动 |
|------|------|
| `src/components/knowledge/DocEditor.tsx` | `cursorTracker` updateListener（selection/docChanged → line/col）；页脚：`行:col · N 字 · FM on/off` |
| `src/i18n/{en,zh-CN,ja,ko,zh-TW}.ts` | `knowledge.doc.statusBar.*` 文案 |

**验收**：✅ 光标移动行列实时更新；字数与 Live 页脚一致；FM 存在显示标记。

## A7 收藏（FM starred）+ 最近入口 — ✅ 完成

| 落点 | 改动 |
|------|------|
| `src/domain/knowledge/frontmatter.ts` | `starred: boolean`（parse/clone/EMPTY_DOC_META/KNOWN_FM_KEYS） |
| `src/domain/knowledge/frontmatterWrite.ts` | `starred: true` 写回 |
| `src/domain/knowledge/search.ts` | `KnowledgeDocMetaEntry.starred`；`upsertSearchDoc` 透传；`listDocsByMeta` 增 `starred` 过滤 |
| `src/store/knowledgeStore.ts` | `starredDocs` state + 刷新点（loadSpaces 索引完成、flushSave、indexCurrentDoc 调用处）；`updateActiveDocMeta` 支持 `starred` |
| `src/components/knowledge/SpaceTree.tsx` | 「⭐ 收藏」分区（starredDocs）+ 空态提示 |
| `src/components/knowledge/page/PageProperties.tsx` | star 切换 chip |

**验收**：✅ 星标 → FM 落盘 `starred: true` → 树收藏区出现（当前 space 内）；取消后消失；重载持久。跨 space 星标在树中不显示（openDoc 是 space 作用域，v1 已知限制，命令面板入口可后续）。

## A4 附件卡（PDF/file 卡）— ✅ 完成

| 落点 | 改动 |
|------|------|
| `src/domain/knowledge/assetUrl.ts` | 非图片资产 `assetMarkdown` → 图片语法 `![name](assets/x.pdf)`（与图片区分：ext 非图片集合） |
| `src/domain/knowledge/blocks/attachmentBlock.tsx`（新） | block spec：props `{name,path}`；carrier `![name](path)`；render 卡片（ext 图标 + 名称 + 路径 + 定位按钮） |
| `src/domain/knowledge/blocks/schema.ts` | 注册 `attachment` |
| `src/domain/knowledge/blocks/carriers.ts` | 预解析：非图片 ext 的 `![…](rel)` → attach div carrier；反向 |
| `src/domain/knowledge/blocks/fidelity.ts` | `attachment` L2 条目 + golden |
| `src/domain/knowledge/slashMenu.ts` | `file` 项（走既有 attach picker） |

**验收**：✅ 拖入 PDF → Live 显示附件卡（`knowledge-attachment`）；Source 为 `![doc.pdf](assets/…)`；往返无损；卡片可定位（`knowledge_reveal_path`）。bookmark 卡暂缓（carrier 与普通链接歧义，需 D 决策）。

## A6 往返降级提示（toast 已有 → 常驻 banner）— ✅ 完成

| 落点 | 改动 |
|------|------|
| `src/components/knowledge/DocBlockNoteEditor.tsx` | 把 once-only toast 改为：toast 一次 + **常驻 loss banner**（列出丢失方言 id + 提示切 Source）；loss 消除后消失 |
| `src/domain/knowledge/blocks/dialectBridge.ts` | `detectDialectLoss` 不变；补测试：banner 状态来自新 `useDialectLoss` 逻辑（若抽函数） |

**验收**：✅ toast 一次 + 常驻 loss banner（`knowledge-doc-loss-banner`，列丢失方言 id + 切 Source 提示）；loss 消除后消失（`lossKeyRef` 去抖）。块级 badge 缓（丢失定位需块级 carrier 映射，Phase C 评估）。

## A3 块多选（Shift+手柄 → 批量操作）— ✅ 完成

| 落点 | 改动 |
|------|------|
| `src/components/knowledge/DocBlockNoteEditor.tsx` | `sideMenu={false}` + `SideMenuController` 自定义菜单：Shift+点击手柄切换多选（selected ids state）；非 Shift 点击单选；选中态 CSS |
| `src/components/knowledge/MultiSelectMenu.tsx`（新） | 批量操作浮层：删除 / 转 paragraph / 转 heading / 转 quote（`editor.removeBlocks` / `updateBlocks`） |
| `src/domain/knowledge/blocks/blockKeymap.ts` | Esc 清空多选；Delete/Backspace 批量删（选中时） |

**验收**：✅ Shift+点击手柄切换多选（`kb-multiselect-handle`）→ 批量操作条（转段落/标题/引用/删除，`kb-multiselect-bar`）；Esc / Backspace / Delete 键控；点外部清除；选中态 accent outline。e2e：`e2e/specs/knowledge-multiselect.spec.ts`（需 app build 后跑 wdio）。

## 里程碑（✅ 已完成）

- `yarn tsc` 0 error
- `yarn test`：仅剩 7 个**存量**失败文件（sidecar session/terminal，stash 验证与本次改动无关）；i18n parity 测试顺带修好（Phase 0–3 遗留：ja/ko 缺 14 个 slash key）
- 文档：本清单 + `knowledge-rectification-plan.md` Phase A 状态已更新

## 修订记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初稿：基于 BN 0.52.1 三个实证 probe 拆解 A1–A7 落点 |
| 2026-08-07 | 全部实施完成：A1 行内公式 / A2 颜色+高亮修复 / A5 状态栏 / A7 收藏 / A4 附件卡 / A6 loss banner / A3 块多选 |
