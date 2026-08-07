# 知识库文档功能整改方案（对标 Notion · 飞书文档 · 语雀 · Typora）

> **状态**: Phase A 已实施完成（2026-08-07，见 `knowledge-phase-a-tasks.md`）
> **基线**: `knowledge-editor-experience-spec.md`（Phase 0–3 已于 2026-08-07 实现，commit `2fd38ec8`）
> **范围**: hip Knowledge（`~/.hip/knowledge/`，本地优先 Markdown + YAML 真源）
> **方法**: 以代码事实为基线，逐维度对比四款标杆产品，差距分级后按「高频日用 → 差异化 → 结构深化」三阶段整改
> **非目标**: 多人实时协同、服务端评论/权限、Notion Database 完整产品线、移动端（与现有 spec §14 一致）

---

## 1. 现状基线（代码事实，2026-08-07 commit `2fd38ec8`）

已实现且通过测试（`src/domain/knowledge/blocks`、`src/components/knowledge/`、e2e `@knowledge`）：

| 能力 | 实现 |
|------|------|
| 双模式 | Live = BlockNote（自定义 schema）；Source = CodeMirror + Typora 就地预览 |
| 自定义块 | callout / math / mermaid / svg / embed / toggle + wiki chip（inline）+ highlight 样式 |
| Slash 2.0 | 分组菜单、callout 子类型、AI 分组（续写/总结/转任务/解释/改写）、subdoc、copyPageLink |
| 块手感 | blockKeymap（复制/移动/删除块）、Tab/Shift+Tab 缩进、IME 防护 |
| 页面头 | Cover（含 coverY 微调）/ Icon / Properties chips（tags/status/date/priority/aliases） |
| 查找替换 | Live `Mod+F` 面板（高亮 + 上一个/下一个 + 替换单个/全部） |
| 版本 | daily + manual、cap 30、时间线 UI + diff 预览、恢复前 snapshot |
| 双链网络 | `[[title]]` 补全、别名、断链确认创建、改名回写、`![[doc]]` embed、图谱（出链/反链 + snippet）、`hip://knowledge/...` 页面链接 |
| 生命周期 | 模板（save-as + picker）、回收站（`~/.hip/trash/`）、导出 md/html/zip、全库 MiniSearch |
| 保存信任 | 节流 draft、autosave、切页/切模式 flush 矩阵、关窗 dirty 拦截、512k 强制 Source |
| i18n | en / ja / ko / zh-CN / zh-TW |

**已有但偏薄 / 明确缺口**（对照 spec §4.3 路线图与 §14）：分栏 columns、meta.json、大纲拖拽、外部文件 watch、虚拟化、bookmark / file / PDF 附件卡、行内公式、块多选、文字色、版本命名与 cap 设置、Source 状态栏、Live↔Source 往返降级提示。

---

## 2. 与四款标杆产品的差异矩阵

图例：✅ 已有且达标 ｜ ◐ 已有但偏薄/体验不达标 ｜ ❌ 缺失 ｜ ➖ 明确不做（架构或定位原因）

### 2.1 编辑器与块模型

| 能力 | Notion | 飞书文档 | 语雀 | Typora | hip 现状 | 差距 |
|------|:--:|:--:|:--:|:--:|------|------|
| 块化编辑（拖拽手柄/多选） | ✅ | ✅ | ✅ | ➖（纯 MD） | ◐ 单块手柄，无多选 | ❌ 多选块、批量 transform |
| Slash 菜单 | ✅ | ✅ | ✅ | ❌ | ✅ 分组+子类型+AI 分组 | — |
| 行内格式密度（粗斜/删线/高亮/文字色/行内代码） | ✅ | ✅ | ✅ | ✅ | ◐ 有高亮，无文字色 | ❌ 文字色、清除格式 |
| 行内公式 `$…$` | ✅ | ✅ | ✅ | ✅ | ❌ 仅块级 `$$` | ❌ 行内公式 |
| 表格（行列操控/合并单元格/TSV 粘贴） | ✅ | ✅ | ✅ | ◐ | ◐ BN 原生，行列操控有，无合并 | ◐ 合并单元格、TSV 粘贴扩表 |
| 分栏/双栏 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ columns（L1–L2 保真） |
| Toggle / 折叠 | ✅ | ✅ | ✅ | ❌ | ✅ 自定义 toggle 块 | — |
| 附件卡 / 文件 / PDF | ✅ | ✅ | ✅ | ✅（相对路径） | ❌ 仅图片资产 | ❌ file/pdf/bookmark 卡片 |
| 嵌入块（页面/书签） | ✅ | ✅ | ✅ | ❌ | ◐ `![[doc]]` embed 有，无 bookmark | ◐ bookmark 卡片 |
| 画布内 AI 生成图片 | ✅ | ❌ | ❌ | ❌ | ❌ | ➖ 非核心，P3 后再评估 |

### 2.2 页面结构

| 能力 | Notion | 飞书文档 | 语雀 | hip 现状 | 差距 |
|------|:--:|:--:|:--:|------|------|
| Cover / Icon / 属性条 | ✅ 完整 | ✅ 完整 | ◐ icon+描述 | ◐ Cover/Icon/Properties 已上线，属性为 chips 无内联编辑 | ◐ 属性内联编辑、预设属性类型 |
| 模板 | ✅ 模板市场 | ✅ 模板中心 | ✅ 知识库模板 | ◐ save-as + picker，无市场/无分类 | ◐ 模板分类与"从模板新建"入口 |
| 子页面 / 子文档 | ✅ subpage 块 | ✅ | ✅ 树节点 | ◐ slash subdoc 创建 + wiki 链接 | ◐ 语义等价，但无子页面块（定位一致，不引入） |
| 演示模式 / 幻灯片 | ✅ 3.x 新增强 | ✅ 幻灯片 | ❌ | ❌ | ➖ 低优先，评估 P3 |

### 2.3 知识组织与导航

| 能力 | Notion | 飞书文档 | 语雀 | Typora | hip 现状 | 差距 |
|------|:--:|:--:|:--:|:--:|------|------|
| 树状知识库 + 拖拽重排 | ◐ 工作区树 | ✅ 知识库树 | ✅ 知识树（最强） | ✅ 文件树 | ◐ 树有，文档内大纲不可拖拽 | ❌ 大纲拖拽重排、树批量移动 |
| 双链 / 反向链接 | ◐ 后补，弱 | ❌ | ◐ 关系图谱 | ❌ | ✅ 补全/别名/断链创建/改名回写/embed/图谱/反链 snippet | —（已超标杆，保持） |
| 大纲（scrollspy） | ✅ | ✅ | ✅ | ✅ | ✅ 右栏 + scrollspy + jump | — |
| 全文搜索 | ✅ | ✅ | ✅ | ✅ | ✅ MiniSearch 增量 | ◐ 无语义搜索、无搜索高亮预览片段 |
| 锚点稳定 id / `doc#slug` | ✅ | ✅ | ✅ | ✅ | ◐ slug 统一算法已审计 | — |
| 收藏 / 最近 / 固定 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ 收藏与最近文档（低成本高感知） |

### 2.4 版本、保存与信任

| 能力 | Notion | 飞书文档 | 语雀 | Typora | hip 现状 | 差距 |
|------|:--:|:--:|:--:|:--:|------|------|
| 版本历史 + 可视化 diff | ✅ 时间线 | ✅ 历史+diff | ✅ Lake 快照+diff | ❌ | ✅ 时间线 + line diff | — |
| 命名版本 / cap 可调 | ◐ | ✅ | ✅ | ❌ | ❌ | ❌ 命名版本、保留策略设置 |
| 外部文件变更冲突提示 | ✅ | — | ✅ | ◐ 提示 | ❌ 无 fs watch | ❌ fs watch + reload/keep 提示 |
| 自动保存 / 关窗拦截 | ✅ | ✅ | ✅ | ✅ 恢复 | ✅ flush 矩阵 + dirty 拦截 | — |
| 冲突合并 | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ 单用户本地优先，watch+提示即可 |

### 2.5 阅读与排版（语雀/Typora 的长板）

| 能力 | Notion | 飞书文档 | 语雀 | Typora | hip 现状 | 差距 |
|------|:--:|:--:|:--:|:--:|------|------|
| 阅读排版（measure/层级/代码） | ◐ | ◐ | ✅ 标杆 | ✅ | ✅ prose tokens（`knowledge-doc-typography.css`） | — |
| 主题系统（可切换） | ❌ | ❌ | ◐ | ✅ 自定义 CSS 主题 | ❌ 单一主题 | ❌ 主题切换（文档级/全局） |
| Focus / Typewriter / 专注模式 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ 专注模式（低成本高感知） |
| 字数/行列状态栏 | ◐ | ✅ | ✅ | ✅ | ◐ 页脚字数，Source 无状态栏 | ❌ Source 状态栏 |
| 拼写/术语检查 | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ 低优先 |
| 阅读模式（只读沉浸） | ➖ | ✅ 演示模式 | ✅ | ❌ | ◐ Reader 仅用于 embed/导出预览 | ◐ 独立只读视图可选 |

### 2.6 导入 / 导出

| 能力 | Notion | 飞书文档 | 语雀 | Typora | hip 现状 | 差距 |
|------|:--:|:--:|:--:|:--:|------|------|
| 导出 | MD/HTML/PDF/CSV | Word/PDF | PDF/MD/图片 | PDF/Word(pandoc)/EPUB/LaTeX/图片 | md/html/zip | ❌ PDF（排版级）；Word/EPUB 可选 |
| 导入 | 全平台迁移 | Word/本地文档 | MD/Word/Notion 迁移 | MD/纯文本 | 无 | ❌ Markdown 目录导入、Obsidian/语雀/Notion 导出包导入 |
| 资产管理 | ✅ | ✅ | ✅ | ✅ 相对路径策略 | ◐ `assets/` 相对路径 + 粘贴拖入 | ◐ 资产去重/重命名跟随 |

### 2.7 AI（hip 差异化主战场）

| 能力 | Notion | 飞书文档 | 语雀 | hip 现状 | 差距 |
|------|:--:|:--:|:--:|------|------|
| 文档内 AI（续写/总结/改写/翻译/解释） | ✅ Notion AI | ✅ 智能创作 | ✅ 总结/润色 | ◐ 5 种动作，**跳转 chat 会话**，非编辑器内流式 | ❌ 编辑器内流式插入 + 替换选区 + Esc 取消 |
| 选区气泡 AI | ✅ | ✅ | ✅ | ❌ | ❌ 气泡条 AI 项 |
| 块级 AI（对块操作） | ✅ | ✅ | ◐ | ❌ | ❌ 块菜单「用 Agent 改写」 |
| 知识库问答（RAG，对库内文档） | ✅ | ✅ 最强 | ✅ + **MCP Server 19 工具** | ❌ | ❌ 库内问答（MiniSearch 已可做检索底座） |
| Agent 生成文档 / 沉淀会话 | ✅ Agents + Workers | ✅ 自定义 Agent | ◐ | ◐ 已有「会话 → 知识库」方向未产品化 | ◐ 文档生成入口产品化 |
| AI 块（结果可折叠固化） | ✅ AI block | ✅ | ❌ | ❌ | ❌ 可折叠 AI 结果块 |
| 外部工具接入 | ✅ MCP/CLI/API | ❌ | ✅ MCP Server | ❌ | ◐ hip 本身是 Agent workbench，知识库可反向暴露 | ❌ 知识库 MCP/CLI 暴露 |

### 2.8 协作与平台（明确不做，仅记录）

| 能力 | Notion | 飞书文档 | 语雀 | hip 立场 |
|------|:--:|:--:|:--:|------|
| 多人实时协同 / 光标 | ✅ | ✅ | ✅ | ➖ 本地优先架构（spec §14） |
| 评论 / @提及 / 表情回应 | ✅ | ✅ | ✅ | ➖ 无账号体系；本地注释另开 spec |
| 权限 / 分享链接 / 公开页 | ✅ | ✅ | ✅ | ➖ 本地文件即权限边界 |
| 移动端编辑 | ✅ | ✅ | ✅ | ➖ Tauri 桌面（spec §14） |
| Database / 多维表格 | ✅ | ✅ | ➖ | ➖ 与 MD 真源冲突（spec §14） |

---

## 3. 差距分级（整改优先级依据）

| 级别 | 含义 | 差距项 |
|------|------|--------|
| **A 必改**（对标日用高频，直接拉低"像文档产品"观感） | 用户每天都会碰到 | 行内公式、文字色与清除格式、块多选、附件/PDF/书签卡、Source 状态栏、往返降级提示、收藏/最近 |
| **B 应改**（对标中期体验与差异化） | 显著提升留存与独特性 | AI 编辑器内流式（+替换选区/气泡/块菜单）、库内 RAG 问答、AI 结果块、大纲拖拽、fs watch 冲突提示、命名版本、Markdown 目录导入、PDF 导出、主题/专注模式、模板分类 |
| **C 可选深化**（Phase 4 原计划 + 探索） | 锦上添花或需决策 | 分栏 columns、meta.json、虚拟化、表格合并单元格、演示模式、知识库 MCP/CLI 暴露、收藏夹进侧栏 |
| **➖ 不做** | 定位/架构冲突 | 多人协同、评论/权限/分享、Database 产品线、移动端 |

---

## 4. 整改方案（三阶段，每阶段 1–2 迭代）

> 原则：每阶段结束必须可独立发布；验收以「可测的 e2e/单元测试 + dogfood 清单」为准，不做无验收的排期。
> 代码纪律沿用 spec §4.4/§17：新块入 `src/domain/knowledge/blocks/`，parse/serialize 成对 golden 测试，`DocBlockNoteEditor` 继续做 host 不再堆业务。

### Phase A — 补齐高频日用差距（对标 Notion/飞书/语雀的"肌肉记忆"）✅ 已实施

> 2026-08-07 全部落地（含代码落点与验收见 `knowledge-phase-a-tasks.md`）：行内公式、文字色+高亮修复+清除格式、Source 状态栏、收藏+树分区、PDF 附件卡、loss 常驻 banner、块多选。附带修复：highlight 经 Live 编辑静默丢失的存量 bug；ja/ko 缺 14 个 slash i18n key 的存量 parity 失败。

目标：**新用户首次日用不被小细节劝退**；Live 默认会话占比维持 >90%。

| # | 任务 | 验收标准 |
|---|------|----------|
| A1 | 行内公式：`$…$` mark + KaTeX（复用块级 math 渲染器，D4 拍板定分隔符） | `$e^{i\pi}$` 在 Live 渲染、Source 往返无损；golden 测试 |
| A2 | 文字色（design token 6 色）+ 一键清除格式 | 气泡工具条新增色板与清除；MD carrier 定一种（`<span data-hip-color>` 或保持仅 meta.json，D1 扩展） |
| A3 | 块多选：Shift+点击手柄 → 批量删除/transform/包装 quote | e2e：多选 3 块批量删除后内容正确；键盘可退出 |
| A4 | 附件卡：file/PDF 卡 + bookmark 手填卡（`[name](assets/…)` + FM tip，spec §4.3） | 拖入 PDF 显示卡片、点击系统打开；断链资源有占位 |
| A5 | Source 状态栏：行列/字数/FM on-off（spec §12） | 状态栏数值与 CM 光标同步；i18n 5 语言 |
| A6 | Live↔Source 往返降级提示：L1 降级发生 toast + 块级 badge（spec P4） | dialectRoundTrip 全绿；降级场景 e2e 断言 toast 出现 |
| A7 | 收藏与最近：FM `starred` 或独立索引 + 侧栏/命令面板入口 | 收藏文档置顶展示；命令面板可跳转 |

**成功标准**：`yarn test` + e2e `@knowledge` 全绿；dogfood 清单（spec §15.2）8/8 通过；新用户 10 分钟「带公式+色块+附件+双链」文档无卡点。

### Phase B — AI 一等公民 + 导入导出闭环（hip 差异化）

目标：**形成"愿意把结论写进 hip 知识库"的理由**（对标 Notion AI / 飞书智能创作 / 语雀 MCP，但更深——与主 Agent 同栈）。

| # | 任务 | 验收标准 |
|---|------|----------|
| B1 | 编辑器内 AI 流式：slash `/ai` 续写/总结等 → 在光标下方新块流式渲染，Esc 取消，结果可「替换选区」或「保留为 AI 折叠块」 | AI mock e2e：流式分片插入、Esc 中断不残留半块；大文档只送 outline+局部窗口 |
| B2 | 选区气泡 AI 项 + 块菜单「用 Agent 改写」（spec §9.1 入口 2/3） | 三个入口共用 `knowledgeAiActions`，选中文本上下文打包正确 |
| B3 | 库内问答（RAG-lite）：MiniSearch 召回 top N → 打包进主 Agent 会话并附来源文档链接 | 提问「XX 文档里关于 YY 的结论」返回引用 2–3 篇；来源可点击跳转 |
| B4 | 会话 → 文档沉淀入口产品化：主会话「保存为知识库文档」一键（模板可选中） | 生成文档含 frontmatter（tags/date/aliases），插入 wiki 链接回原会话 |
| B5 | 导入：Markdown 目录/zip 批量导入（frontmatter 保留）+ 语雀/Obsidian 导出包映射表 | 100 篇 fixture 目录导入后树结构与双链完整；往返抽样无正文丢失 |
| B6 | 导出 PDF（排版级，复用 htmlExport + 打印管线） | 中文排版、代码块、mermaid 截图可见；A4 分页不截断代码 |
| B7 | 模板分类与「从模板新建」向导 | 模板按类别分组；新建向导 3 步内完成 |

**成功标准**：AI 动作周活可测（埋点或 dogfood 计数）；导入导出 e2e 覆盖；「从空库到回答一个库内问题」< 60s。

### Phase C — 结构深化与可选探索（对标语雀知识树的"中间道路"）

目标：结构化能力接近语雀树/Notion Database-lite 的日用子集，仍保持 MD 真源。

| # | 任务 | 验收标准 |
|---|------|----------|
| C1 | 大纲拖拽重排（spec §7.1 P2） | 拖拽后块顺序与 Source 一致；golden 测试 |
| C2 | fs watch：外部改文件 → 提示 reload/keep（spec §8.1 P2） | 外部修改后 3s 内提示；reload 不覆盖本地未保存草稿 |
| C3 | 命名版本 + cap 设置（spec §8.2 P2） | 版本列表显示标签；设置页可调 cap |
| C4 | 分栏 columns（spec §4.3 L1–L2，D7 纵向降级） | 无 meta 时纵向降级 + Source 提示；e2e 双向 |
| C5 | meta.json 旁路（spec Phase B，D3）：仅存 MD 表达不了的 UI 态（折叠态/列宽/cover crop） | meta 损坏时静默忽略，正文零丢失 |
| C6 | 表格合并单元格 + TSV 粘贴扩表（spec §5.6 P1） | e2e：TSV 三行粘贴生成 3×N 表；合并单元格往返保内容 |
| C7 | 主题切换（浅/深跟随现有 + 可选文档级宽窄）与专注模式 | 主题切换不破坏 callout/代码对比度（AA）；专注模式可键入 |
| C8 | 虚拟化调研：block count > N 时 BN 可行性，否则维持 Source 降级（spec §10 P2） | 输出结论 + 性能预算测试 |

**成功标准**：所有新增块 `dialectRoundTrip` L3 全过；512k 性能预算不回归；每项有 e2e 或单测锚点。

---

## 5. 关键决策点（需产品拍板）

| ID | 问题 | 选项 | 建议 |
|----|------|------|------|
| D1 | 文字色 carrier | 仅 meta.json（Source 看不到）vs `<span data-hip-color>` | `<span data-hip-color>`（Source 可读可逆） |
| D2 | 收藏语义 | FM `starred: true` vs 独立 `favorites.json` | FM（文件即真源，跨设备同步天然一致） |
| D3 | 库内问答范围 | 仅当前 space vs 全库 | 全库，返回结果标注 space |
| D4 | AI 流式插入位置 | 光标下方 vs 文档末尾 | 光标下方（Notion/飞书同款） |
| D5 | PDF 导出管线 | 系统打印（零依赖）vs wkhtmltopdf/playwright | 系统打印首发；playwright 排版级 P3 评估 |
| D6 | 知识库 MCP/CLI 暴露 | 首期不做 vs Phase C 原型 | Phase C 原型（呼应 2026 语雀 MCP / Notion CLI 趋势，hip 作为 AI workbench 应反向暴露） |

---

## 6. 度量指标（整改后）

| 指标 | 基线 | 目标 |
|------|------|------|
| Live 默认会话占比 | 已 default on | >90% 文档打开落在 Live |
| Live→Source 被动降级率 | 大文档/解析失败 | 解析失败 <1% 抽样 |
| 方言块 L3 往返测试 | 已全绿 | 新增块（inline math/color/附件卡/columns）100% 达标 |
| AI 动作周活 | 跳转会话（弱） | 编辑器内流式动作占 AI 动作 >60% |
| 导入成功率 | 无导入 | 100 篇 fixture 目录导入无正文丢失 |
| Dogfood 日用主观分 | — | ≥ 飞书文档日用 4/5（内部） |

---

## 7. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初稿：以 spec Phase 0–3 实现为基线，对照 Notion（含 3.2–3.5 Agentic 更新）/飞书/语雀（含 MCP）/Typora 输出差距矩阵与三阶段整改方案 |
