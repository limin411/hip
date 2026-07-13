# 知识库文档编辑体验 Spec

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-13 |
| 状态 | **Implemented**（P0 UX + e2e KE1–KE8 绿） |
| 范围 | 知识库工作区内 **文档阅读/编辑** 的布局、交互模型、输入性能与视觉；不改存储协议 / 搜索 / 空间树 CRUD |
| 前置 | 知识库 P0+P1 已落地（含 CodeMirror 6）；见 [`2026-07-13-knowledge-base-spec.md`](./2026-07-13-knowledge-base-spec.md)、[`2026-07-13-knowledge-base-design.md`](./2026-07-13-knowledge-base-design.md) |
| 关联 plan | [`../plans/2026-07-13-knowledge-editor-ux.md`](../plans/2026-07-13-knowledge-editor-ux.md) |
| E2E 体系 | WebdriverIO + `@wdio/tauri-service`（`e2e/`）；见 [`e2e/README.md`](../../../e2e/README.md)；当前 **无** knowledge 真机用例 |
| 现状代码 | `DocEditor.tsx`、`DocReader.tsx`、`KnowledgeWorkspace.tsx`、`knowledgeStore`（`draftBody` / `editing` / `setDraftBody` / `flushSave`） |
| 参考 | 原型 `docs/prototypes/knowledge-base/index.html`（全高单滚动文档面）；飞书/语雀/Obsidian 源码模式（文档画布，非 IDE 小窗） |

---

## 1. Overview

### 1.1 问题

知识库 Markdown 读写与自动保存已可用，但 **文本编辑体验不友好**。根因不是「缺 CodeMirror 能力」，而是呈现层把笔记做成了 **受控代码挂件 + 默认只读双态**。

| 用户感知 | 现状机制 |
|----------|----------|
| 可写区域矮、像表单框 | `height="min(60vh, 480px)"` + 圆角边框 + `max-w-3xl` |
| 滚动割裂 | 外层 `main overflow-y-auto` + 编辑器内部 scroller **双滚动** |
| 写中文像写代码 | 等宽字体 + 行号 + fold gutter + GitHub code theme |
| 打开文档不能直接写 | `openDoc` → `editing: false` → 必须点「编辑」；无 autoFocus |
| 打字偶发卡顿 / 整页抖 | 每键 `setDraftBody` → Workspace 订阅 `draftBody` **整树重渲** |
| 无标题感 | 标题只能在树节点 Rename；编辑面只有正文源码 |

### 1.2 产品定位（锁定）

**文档编辑面 = 全高、单滚动、文档气质的 Markdown 源码编辑器；保存语义与现网一致（debounce + flush）。**

- 仍是 **Markdown 源码**（不引入 TipTap / WYSIWYG / 块编辑器）
- 仍复用 **CodeMirror 6** + `@codemirror/lang-markdown`
- 仍复用 **MarkdownBody** 作预览渲染
- 仍走 `knowledgeStore` → `knowledge_write_doc`；**不改** on-disk 布局与 IPC 契约

### 1.3 目标

| ID | 目标 |
|----|------|
| E1 | **全高文档画布** — 编辑区占满右侧主栏可用高度；视觉上是「打开文档」而非「嵌入代码框」 |
| E2 | **单滚动** — 编辑态只保留一层纵向滚动（编辑器 scroller）；禁止页面 + 编辑器双滚动条 |
| E3 | **文档气质排版** — 正文字体比例字体、行高适合中文长文；默认不显示行号/fold gutter |
| E4 | **输入流畅** — 打字时左侧树与工具栏不因 `draftBody` 每键重渲；IME 中文输入不被 value 回灌打断 |
| E5 | **进编辑即可写** — 进入编辑态后编辑器 autoFocus；光标可用 |
| E6 | **降低模式摩擦** — 打开文档默认进入编辑（源码）态；工具栏可切到预览 |
| E7 | **保存语义不变** — 仍 debounce（约 500ms）写盘 + blur/离开/切文档 flush；状态文案「保存中/已保存」保留 |
| E8 | **i18n** — 新增/改动文案 en / zh-CN / zh-TW 齐全 |
| E9 | **单元测试** — DocEditor / store / Workspace 相关 Vitest 更新并通过 |
| E10 | **E2E 真机** — WebdriverIO 覆盖打开知识库 → 建空间/文档 → 默认可编 → 输入 → 预览往返 →（可选）落盘；标签 `@knowledge`，核心路径进 gate（`@core` 或与 smoke 组合） |

### 1.4 非目标

| ID | 非目标 | 说明 |
|----|--------|------|
| NG1 | WYSIWYG / TipTap / Milkdown / Notion 块 | 复杂度与 MD 真源冲突；本期不做 |
| NG2 | 实时分栏预览（左源码右渲染） | P2 可选；本期保留 **整页切换** 预览即可 |
| NG3 | Markdown 工具条（B/列表/标题按钮） | P2 可选 |
| NG4 | 编辑面内联改标题 | P1 可选（见 §4.3）；P0 可不做 |
| NG5 | 改搜索 / 空间 CRUD / 树 DnD / 导出导入 | 正交 |
| NG6 | 改 Rust `knowledge_*` IPC 或落盘格式 | 不动 |
| NG7 | AI 润色 / 会话注入 | 知识库总非目标延续 |
| NG8 | 自定义知识库根路径 | 与本期无关 |
| NG9 | 知识库全文搜索 / 空间删除 / DnD 的完整 e2e | 正交；本期 e2e 聚焦 **编辑体验主路径** |
| NG10 | 第二套 E2E 框架（Playwright 浏览器 mock 替代 Tauri） | 沿用现有 WDIO + Tauri |

### 1.5 原则

1. **Simplicity first** — 先布局 + 状态边界 + 默认编辑；不做新编辑器栈。
2. **Surgical** — 触碰 `DocEditor` / `KnowledgeWorkspace` / store 中与 `editing`·`draftBody` 相关的最小面；不「顺手」重构整库。
3. **保存可靠优先于炫技** — 本地 draft 可以缓冲 UI，但 **文档切换 / 关知识库 / 点预览** 必须 await 或等价 flush。
4. **与原型对齐方向** — 全高 `editor-pane` + 单 `editor-scroll` 心智；不要求像素级复刻原型假数据 UI。

---

## 2. 用户体验

### 2.1 打开文档（默认编辑）

1. 用户在树中点击某 **doc**，或从最近打开进入文档。
2. 右侧主栏显示：面包屑工具栏 + **源码编辑器（editing=true）**。
3. 焦点进入编辑器；用户可立即键入。
4. 空文档显示 placeholder（见 §3.4），不再在预览态只显示「—」才给内容感。

### 2.2 预览

1. 工具栏提供「预览」切换（或保留现「完成」语义并改文案为「预览」——见 §3.3）。
2. 切换到预览前 **await `flushSave`**，再 `editing=false`，渲染 `DocReader` / `MarkdownBody`。
3. 预览态工具栏提供「编辑」回到源码；进入时 autoFocus。

### 2.3 保存

| 触发 | 行为 |
|------|------|
| 编辑中持续输入 | debounce ~500ms → `knowledge_write_doc` |
| blur（失焦） | 立即 `flushSave` |
| 切到预览 / 切文档 / 回首页 / 关知识库 chip | flush（现有 Tier A/B 语义保留） |
| 成功 | 短暂「已保存」；失败 toast（现有） |

用户 **不需要** 显式 Cmd+S（可后续加；本期不强制）。

### 2.4 不做的交互（本期）

- 不强制点击正文才从预览进入编辑（因默认已是编辑）。
- 不做 Esc 退出编辑的特殊绑定（避免与全局快捷键纠缠；预览用按钮即可）。
- 不做协同光标、版本历史 UI。

---

## 3. 功能需求

### 3.1 布局（E1 / E2）

**编辑态结构：**

```text
KnowledgeWorkspace
├─ aside (tree) — 不变
└─ main
   ├─ toolbar (h-11, shrink-0)
   └─ content shell (flex-1 min-h-0 flex flex-col)
      └─ DocEditor host (flex-1 min-h-0, 可 max-w 居中)
         └─ CodeMirror height=100% / 唯一纵向 scroller
```

**规则：**

| 规则 | 要求 |
|------|------|
| R1 | 编辑态：`main` 内容区 **`overflow-hidden`**（或非 scroll），**禁止** 与 CM 同时 `overflow-y-auto` |
| R2 | CodeMirror 宿主 **填满** content shell 高度（`height: 100%` 或 `flex-1` + CM `height="100%"`）；**删除** `min(60vh, 480px)` 固定高度 |
| R3 | 预览态：`DocReader` 可在 content shell 内 **单独** `overflow-y-auto`（单滚动） |
| R4 | 正文可读宽度可保留 `max-w-3xl`（或 ~720px）**水平居中**；宽度约束不得制造第二套纵向滚动 |
| R5 | 去掉「厚重代码框」感：弱化或去掉整框 focus ring 包边；可用底部分割/无边文档面 |

### 3.2 排版与 chrome（E3）

| 项 | P0 决策 |
|----|---------|
| 字体 | 系统 UI / 中文无衬线栈（与 app 正文一致），**非** monospace 为主 |
| 字号 / 行高 | ~15–16px，`line-height` ≈ 1.65–1.75 |
| 行号 | **默认关闭** |
| fold gutter | **默认关闭** |
| active line | 可保留弱高亮（可选） |
| 语法高亮 | 保留 markdown lang（标题/代码围栏着色） |
| Theme | 优先与 hip CSS 变量一致的轻量 `EditorView.theme`；可弃用或降级 GitHub theme 的强对比代码背景，避免双主题冲突 |
| 代码围栏内 | CodeMirror markdown 默认处理即可；不要求嵌套语言花活变更 |

### 3.3 编辑/预览模式（E5 / E6）

| 决策 | 值 |
|------|-----|
| 打开文档默认 | **`editing: true`**（源码） |
| 新建文档后 | **编辑态** + autoFocus |
| 工具栏主按钮 | 编辑态显示「预览」；预览态显示「编辑」 |
| 旧文案 | `knowledge.doc.done` / `edit` 可复用或改 key；三语同步 |
| `setEditing(false)` | 先 `await flushSave()` 再关编辑（现有） |
| `setEditing(true)` | `draftBody = docBody`，挂载编辑器，**autoFocus** |
| `openDoc` | 成功加载后 **`editing: true`**（相对现网 `false` 的行为变更，需测） |

**兼容：** 若用户正在预览，再点同一文档，保持预览或刷新为编辑——**锁定：重新 open 同一 doc 时进入编辑态**（简单、可预期）。

### 3.4 Placeholder（E6 附属）

- 编辑器 `placeholder`：空文档时显示简短提示（i18n），例如「开始写作…」/ “Start writing…”。
- 预览空内容：可继续「—」或改为同一 placeholder 文案（择一，三语一致）。

### 3.5 输入性能与状态边界（E4）

**问题：** 强受控 `value={draftBody}` + 父组件每键订阅 `draftBody` → 全 Workspace 重渲。

**锁定方案：**

1. **`DocEditor` 自治 draft（推荐）**
   - Props：`docId`、`initialValue`（打开/切换文档时的正文）、`onDraftChange(text)`、`onBlurSave`。
   - 内部：CodeMirror 以 `initialValue` / `key={docId}` 初始化；`onChange` **先**更新编辑器自身（CM 已持有 doc），再调用 `onDraftChange`。
   - 父级 **`onDraftChange` 写入 store 的 `draftBody`**（供 flush/save 使用），但 **Workspace 不得** 因 `draftBody` 把 `value` 回灌给编辑器（避免 controlled echo）。
   - 切换 `docId`：用 `key={docId}` remount，或 `initialValue` 变化时 reset（仅当 doc 切换，非每键）。

2. **订阅隔离**
   - `KnowledgeWorkspace` **不要** `useKnowledgeStore(s => s.draftBody)` 仅用于喂编辑器。
   - 可选：`DocEditor` 容器组件自己 `setDraftBody`；工具栏只订 `editing` / `saveState` / `activeDocId`。
   - `saveState` 更新不应导致 CodeMirror `reconfigure`（extensions 依赖稳定：`onBlur` 用 ref）。

3. **IME**
   - 禁止在 composition 期间用外部 `value` 整篇 `dispatch` 替换（通过「不回灌 value」自然满足）。
   - 不在 `onChange` 里做昂贵工作（index 重建仅在 save 成功后，现有逻辑保持）。

4. **保存**
   - `setDraftBody` 仍 `scheduleSave(500)`。
   - `flushSave` 读 **store 中最新 `draftBody`**；因此 `onDraftChange` 必须在键入路径上同步更新 store（可每键 set，只要 UI 不回灌；或 debounce set 但 **flush 前必须把 CM 当前 doc 推入 store**——若用 debounce set，则 `flushSave` / blur 需从 editor ref 取最新文本）。

**锁定细节（实现约束）：**

- **A 方案（更简单）：** 每键 `setDraftBody`（store 更新），编辑器 **不受控**（无 `value` 回灌）；Workspace 不订阅 `draftBody`。
- **B 方案：** 本地 state + debounce 写 store；blur/flush 经 ref 强制 sync。

**本期默认 A**：改动小、flush 语义简单。B 仅在 A 实测仍卡时再上。

### 3.6 保存与离开（E7）

保持 design 已有 Tier A/B：

| 场景 | 要求 |
|------|------|
| 预览切换 | await flush |
| 打开另一文档 | await flush（现有 `openDoc`） |
| 回首页 / 删文档 | 现有 flush |
| KnowledgePage unmount | best-effort `void flushSave()` |

`flushSave` 在 `editing === false` 且 draft===doc 时 no-op 逻辑需与「默认 editing true」一起回归。

### 3.7 无障碍与测试 id

| testid | 用途 | E2E |
|--------|------|-----|
| `new-session-kb` | `+` 菜单「知识库」 | 入口 |
| `knowledge-tab` / `knowledge-tab-close` | 标签 chip | 存在/关闭（可选） |
| `knowledge-page` | 知识库根 | 已打开 |
| `knowledge-home` | 首页 | 建空间前 |
| `knowledge-create-space` | 新建空间 | 点击 |
| `knowledge-space-card` | 空间卡片 | 进入空间（多卡时用文本/首卡） |
| `knowledge-workspace` | 工作区 | 进入后 |
| `knowledge-new-doc` | 新建文档 | 点击 |
| `knowledge-tree` / `knowledge-tree-doc-<id>` | 树 | 打开文档：`[data-testid^="knowledge-tree-doc-"]` |
| `knowledge-doc-editor` | 编辑宿主 | **默认打开文档后应存在**（V1/E6） |
| `.cm-content`（CM 内部） | 可编辑区 | 聚焦 + `browser.keys` 输入 |
| `knowledge-edit-toggle` | 预览 ↔ 编辑 | 切换 |
| `knowledge-doc-reader` | 预览 | 预览态可见 |
| `knowledge-doc-empty` | 空预览 | 可选 |

**E2E 稳定性建议（实现期可做，小改动允许）：**

| 建议 | 原因 |
|------|------|
| 创建空间 Modal 确认按钮加 `data-testid="knowledge-create-space-confirm"` | 避免依赖按钮文案 locale |
| 空间卡片稳定属性：已有 `knowledge-space-card`；多空间时用 `.first` 或名称文本 | HIP_DATA_DIR 每 run 干净，通常仅一卡 |
| 勿依赖随机 `docId` 全文；用 `^=` 前缀选择器 | id 为运行时生成 |
| 编辑器勿只靠 mock testid；真机认 `.cm-content` 或 host 内 contenteditable | 单元 mock 与真机分离 |

新增可选：`knowledge-doc-editor-cm` **仅** Vitest mock，**不**作为 e2e 主选择器。

### 3.8 E2E 真机要求（E10）

**Harness（锁定）：** 现有 `yarn test:e2e` — WebdriverIO + `@wdio/tauri-service` + debug `hip` + Vite `:1420`。数据目录 `HIP_DATA_DIR` / `E2E_DATA_DIR` 每 run 隔离（`wdio.conf.ts`），知识库落在该目录下 `knowledge/`，**无需**污染用户 `~/.hip`。

**「真机」定义（与 context-menu e2e plan 一致）：**

| 层级 | 含义 | 命令 |
|------|------|------|
| A. 自动化真机 | Tauri 进程 + 真实 invoke 写盘 | `yarn test:e2e --spec e2e/specs/knowledge-*.spec.ts` |
| B. 手工真机 | `yarn tauri dev`；布局/IME/双滚动 | plan 手工清单 |
| C. 单元 | Vitest | `yarn vitest run src/components/knowledge …` |

**标签：**

| Tag | 用途 |
|-----|------|
| `@knowledge` | 本功能全集；`E2E_GREP=@knowledge` |
| `@core` | 主路径用例（打开 → 写 → 预览）纳入 `yarn test:e2e:gate` |
| `@smoke` | 可选：仅「能打开 knowledge-page」一条，若希望 smoke 更短可不加 |

**P0 自动化用例（必做）：**

| ID | 场景 | 断言要点 |
|----|------|----------|
| KE1 | 从 `+` → `new-session-kb` 打开知识库 | `knowledge-page` 可见；`knowledge-home` 或已有 workspace |
| KE2 | 创建空间并进入 | `knowledge-workspace` 可见 |
| KE3 | 新建文档后 **默认编辑态** | **无需**再点 edit-toggle；`knowledge-doc-editor` 存在；`.cm-content` 可聚焦 |
| KE4 | 键入 Markdown 文本 | 编辑器文本包含唯一标记串（如 `e2e-kb-marker-…`） |
| KE5 | 点 toggle → 预览 | `knowledge-doc-reader` 可见且包含该标记（或渲染后文本）；`knowledge-doc-editor` 不存在 |
| KE6 | 再点 toggle → 编辑 | `knowledge-doc-editor` 恢复；文本仍在 |

**P0 自动化用例（强烈建议，同 PR 或紧随）：**

| ID | 场景 | 断言要点 |
|----|------|----------|
| KE7 | debounce/flush 后重进文档 | 预览或再次打开后内容仍在（证明写盘，不只内存） |
| KE8 | 知识库 chip | `knowledge-tab` 存在；可选 close 回非 knowledge 表面且不崩溃 |

**不纳入 P0 e2e（手工或 P1）：**

| ID | 原因 |
|----|------|
| 单滚动 / 全高布局像素 | 自动化脆；M2/M3 手工 |
| CJK IME composition | WDIO 难稳定模拟；M4 手工 |
| 行号关闭 / 字体 | 视觉；单测或手工 |
| 搜索 / 删空间 / 多文件夹 | 正交 |

**隔离与清理：**

- 依赖 run 级 `HIP_DATA_DIR` 空知识库；用例自建 space/doc，不假设种子数据。
- `before`：`waitForAppReady` + `skipLoginIfPresent` + `waitForMainApp`。
- 若前序 spec 停在 settings/knowledge：先关 chip 或回主壳（可复用 settings `leave` 模式 / `knowledge-tab-close`）。
- **禁止** `@live` / 真 LLM；**禁止**破坏宿主真实 `~/.hip`（只用 e2e data dir）。

**可选 DEV bridge：** 若菜单不稳定，可增 `window.__hipE2E.openKnowledgeForE2e`（对齐 settings 模式）；**优先**走真实 `new-session-kb` UI。Bridge 非 P0 门禁。

---

## 4. 分阶段

### 4.1 P0（本 spec 必做）

- 全高 + 单滚动布局（§3.1）
- 文档气质字体 / 关行号 fold（§3.2）
- 默认打开即编辑 + autoFocus + 预览切换（§3.3）
- 编辑器不受控回灌 + Workspace 去 `draftBody` 订阅（§3.5-A）
- placeholder + i18n（§3.4 / E8）
- 单元测试更新（E9）
- **E2E：KE1–KE6（+ 建议 KE7/KE8）**（E10 / §3.8）

### 4.2 P1（本 spec 记录，可不在同一次提交）

- 编辑面 **内联标题**（失焦/Enter → `renameNode`）
- 预览空状态文案与 placeholder 统一
- e2e：搜索命中打开文档、删空间确认、chip close 恢复 session 表面

### 4.3 P2（明确后置）

- 分栏 live preview
- Markdown 工具条 / 快捷键帮助条
- 完全自定义 CM theme 包

---

## 5. 与旧 spec/design 的关系

| 主题 | 旧 design | 本 spec |
|------|-----------|---------|
| 编辑器 | P0 textarea → 已升 CodeMirror | **保留 CM，改 UX 壳与状态** |
| 默认模式 | 读优先（editing false） | **写优先（editing true）** |
| 布局 | 未强制高度 | **全高单滚动** |
| 受控 textarea | draftBody 直绑 | **store 仍存 draft，UI 不回灌** |

冲突时：**编辑体验以本文为准**；存储 / 入口 / 树 / 搜索仍以 knowledge-base design 为准。

---

## 6. 验收标准

| # | 验收 |
|---|------|
| V1 | 打开已有文档：无需再点「编辑」即可键入；焦点在编辑器内 |
| V2 | 编辑区高度 ≈ 主栏扣除工具栏后的剩余高度；窗口缩放时编辑器跟随变高 |
| V3 | 编辑态只有 **一条** 纵向滚动条（开发者工具/肉眼）；长文在 CM 内滚动 |
| V4 | 默认无行号栏；字体非等宽主导；中文长文行距舒适 |
| V5 | 连续输入 50+ 字：左侧树不闪明显重挂；中文 IME 组字正常 |
| V6 | 输入后约 500ms 内触发保存；点「预览」后磁盘内容为最新；预览渲染正确 |
| V7 | 预览 → 编辑：内容一致、可继续编辑 |
| V8 | 切换文档 / 回首页：无静默丢字（flush 路径） |
| V9 | `yarn test` 中 knowledge 相关用例绿；`data-testid` 不回归破坏 |
| V10 | en / zh-CN / zh-TW 无缺失 key |
| V11 | `yarn test:e2e --spec e2e/specs/knowledge-editor.spec.ts`（或等价路径）**KE1–KE6 绿**；核心用例带 `@core` 可被 `test:e2e:gate` 命中 |
| V12 | e2e 仅使用隔离 `HIP_DATA_DIR`；无 paid LLM；失败截图可落在现有 `E2E_SCREENSHOT_DIR` |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 默认编辑导致「误改」焦虑 | 仍有 debounce 保存；无破坏性自动格式化；用户可立刻预览对照 |
| 不受控编辑器与 store draft 不同步 | blur/flush/切文档前保证 store 已是最新（方案 A 每键写 store） |
| `key={docId}` remount 丢滚动 | 仅 doc 切换 remount；同文档编辑不 remount |
| 主题与 dark mode | 继续听 `html.dark`；theme extension 用 CSS 变量 |
| 性能仍差 | 升级方案 B（本地 state + ref flush） |
| CodeMirror 自动化输入不稳定 | 先 click `.cm-content` 再 `browser.keys`；必要时 `browser.execute` 聚焦；短 `pause` 仅用于 Radix 动画 |
| `+` 菜单 flaky | 复用 `surface.ts` `openNewSessionMenu` 重试模式；失败再考虑 `__hipE2E` bridge |
| 预览断言被 Markdown 渲染改写 | 使用 plain 文本 marker（无特殊 MD 语法）或断言 reader 文本 content |

---

## 8. 开放决策（已锁定默认）

| Q | 决策 |
|---|------|
| 默认读还是写？ | **写（editing true）** |
| 受控策略 | **A：每键写 store，编辑器不 value 回灌** |
| 行号 | **关** |
| 分栏预览 | **不做（P2）** |
| 内联标题 | **P1，非 P0 门禁** |
| E2E harness | **WDIO + Tauri（现有）**；标签 `@knowledge` + 主路径 `@core` |
| E2E 最小集 | **KE1–KE6 门禁**；KE7/KE8 强烈建议 |

---

## 9. 文件影响（预期）

### 修改

```
src/components/knowledge/DocEditor.tsx
src/components/knowledge/DocEditor.test.tsx
src/components/knowledge/KnowledgeWorkspace.tsx
src/components/knowledge/DocReader.tsx          # 可选空态
src/store/knowledgeStore.ts                    # openDoc editing 默认 true；必要时 setEditing 文案无关
src/store/knowledgeStore.test.ts               # openDoc 默认 editing
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
```

### 新增（E2E）

```
e2e/helpers/knowledge.ts                       # openKnowledge / createSpace / createDoc / typeInEditor
e2e/specs/knowledge-editor.spec.ts             # KE1–KE6（+ KE7/KE8）
```

### 可能微调

```
src/components/knowledge/KnowledgeHome.tsx      # create-space confirm testid
e2e/helpers/surface.ts                         # 可选 export openNewSessionMenu 复用
e2e/README.md                                  # 登记 @knowledge 标签与命令
src/components/knowledge/KnowledgeWorkspace 相关 test（若有）
docs/superpowers/specs/2026-07-13-knowledge-base-spec.md  # 状态行交叉引用（可选）
```

### 不修改

```
src-tauri/src/knowledge.rs
src/ipc/knowledge.ts
src/domain/knowledge/search.ts
```
