# 文档存储规范（doc-storage-spec）

> 版本：v1.0（2026-08 · doc-manager-v2 V2-E0 编辑模型收口）
> 依据：`docs/2026-08-08-02-doc-manager-vs-notion/spec.md` §3 E0-4
> 地位：**存储层硬约束** —— Markdown 仅是存储格式，不是编辑界面；live 编辑器与磁盘之间的
> **round-trip 无损**由测试清单守护（见 §4），已知 lossy 项逐条登记（见 §5）。

---

## 1. 存储格式总览

| 层 | 载体 | 说明 |
|---|---|---|
| 目录树 | `tree.json`（space 根目录） | `version: 1` + `nodes[]`（folder/doc/board，`order` 排序） |
| 文档正文 | `<space>/<folder…>/<doc>.md` | Markdown（GFM + hip 方言块） |
| 文档元数据 | YAML frontmatter（正文顶部） | 仅作存储层内部字段，**不提供任何元数据 UI**（v2.1 决策） |
| 搜索索引 | MiniSearch 内存索引（`kbIndex`） | 由 `search.ts` 从正文构建，非持久格式 |

**不可让渡的底线**：Markdown 可读、离线可用、数据归用户。

## 2. frontmatter 结构（`frontmatter.ts` / `frontmatterWrite.ts`）

```yaml
---
title: 文档标题          # 与 tree.json 节点标题一致（树为权威）
icon: 🚀                # 可选
tags: [a, b]            # 短列表内联；长列表换行块
status: draft           # 可选（不提供 UI）
aliases: [旧标题]        # wiki 解析用
date: 2026-08-08
priority: P1
starred: true
props:                  # 自定义属性（类型化标量）
  key: value
---
```

- 写入规则：`formatFrontmatterFence` 统一序列化；meta 为空 → 无 frontmatter；替换时正文前保留单个空行。
- 读取规则：`parseFrontmatter` 容错（缺 fence / 坏 YAML 不崩）。

## 3. 块类型 ↔ Markdown 语法映射

| 块类型 | Markdown | 往返等级 | 说明 |
|---|---|---|---|
| 段落 / 标题 | ATX `#`–`######` | L3 | |
| 列表 / 待办 | `-` / `- [ ]` | L3 | |
| 引用 / 提示 | `>` / `> [!note|tip|info|warning|danger|caution|important]` | L3 | callout 经 HTML carrier 往返 |
| 代码 | ```` ```lang ```` | L3 | 语言 + 正文保真 |
| 数学 | `$$...$$` / `$...$` | L3 | carrier 守卫换行 |
| Mermaid | ```` ```mermaid ```` | L3 | 源码换行必须保留（`bnLiveRoundTrip`） |
| SVG | ```` ```svg ```` | L3 | |
| wiki 双链 | `[[title]]` / `[[t\|alias]]` | L3 | `linkIndex` 重映射 |
| 嵌入 | `![[title#frag]]` | L2 | 结构保真，UI 状态可丢 |
| 折叠块 | `<details><summary>` | L2 | |
| 高亮 | `==text==` | L2 | |
| 文字颜色 | `<span data-hip-color>` carrier | L2 | `carriers.ts` |
| 图片 | `![alt](assets/x.png "题注")` | L2 | 题注可丢（登记 §5） |
| 附件卡 | `![name](assets/file.pdf)` | L2 | |
| 表格 | GFM `\|...\|` | L2 | 列宽不保（登记 §5） |
| 分栏 | `<!-- hip-columns:N -->…<!-- /hip-columns -->` 注释守卫 | L2 | 每列一段 md；列宽不保（登记 §5） |

## 4. Round-trip 无损测试清单（硬门禁）

> 全局门禁：`yarn tsc --noEmit` + `yarn vitest run <文件>` 全绿。以下为每个门禁项的
> **最小用例编号**（文件:用例名），与代码一一对应，防止回归悄悄放宽。

| # | 场景 | 用例锚点 | 文件 |
|---|---|---|---|
| 1 | 每个方言 id 有 catalog 条目 + preserve probe | `every dialect id has a catalog entry and preserve probe` | `domain/knowledge/dialectRoundTrip.test.ts` |
| 2 | mermaid 语言标识在 normalize 后存活 | `mermaid language survives normalizeMd` | 同上 |
| 3 | callout `[!note]` 标签存活 | `callout note tag survives normalizeMd` | 同上 |
| 4 | 真实 BlockNote：mermaid 换行 + fence 保真 | `preserves mermaid source newlines and fence` | `blocks/bnLiveRoundTrip.test.ts` |
| 5 | 真实 BlockNote：数学 display fence | `preserves math display fence` | 同上 |
| 6 | 真实 BlockNote：callout 正文换行 | `preserves callout body newlines` | 同上 |
| 7 | 真实 BlockNote：代码块语言 + 正文 | `preserves code block language + body` | 同上 |
| 8 | 混合长文（标题+mermaid+代码+段落）无损 | `mixed document: …` | 同上 |
| 9 | 文字颜色经 HTML 导出路径存活 | `text color survives Live HTML export path` | 同上 |
| 10 | L2/L3 fidelity 矩阵条目带 probe | `documents L2/L3 entries with probes` | `blocks/blockRoundTrip.test.ts` |
| 11 | 方言 preserve probes 覆盖核心 marker | `dialect preserve probes cover core hip markers` | 同上 |
| 12 | callout 类型往返 | `callout round-trips types` | 同上 |
| 13 | math / mermaid / svg 往返 | `math / mermaid / svg round-trip` | 同上 |
| 14 | wiki / embed / toggle / 图片题注 | `wiki / embed / toggle / image caption` | 同上 |
| 15 | L3 goldens 经 carrier bridge 存活 | `golden ${g.id} survives carrier bridge` | 同上 |
| 16 | preParse 生成 data-hip carrier | `preParse emits data-hip carriers for callout` | 同上 |
| 17 | postSerialize 从 HTML carrier 还原 | `postSerialize restores callout from HTML carrier` | 同上 |
| 18 | HTML carrier → 方言还原 | `htmlCarriersToDialect restores wiki span` | 同上 |
| 19 | frontmatter 空 meta 不写 fence | `returns empty string when meta has no properties` | `domain/knowledge/frontmatterWrite.test.ts` |
| 20 | tags 短列表内联 / 长列表块 | `writes short tag lists inline and long lists as blocks` | 同上 |
| 21 | 含空格/特殊 YAML 字符的值加引号 | `quotes values with spaces or special YAML chars` | 同上 |
| 22 | 自定义 props 类型化标量排序 | `writes sorted custom props with typed scalars` | 同上 |
| 23 | meta 空 → 剥离 frontmatter | `strips frontmatter when meta is empty` | 同上 |
| 24 | 替换 frontmatter 保留单个空行 | `replaces existing frontmatter and keeps body with a single blank line` | 同上 |
| 25 | body-only 文档补 frontmatter | `adds frontmatter to a body-only document` | 同上 |
| 26 | wiki 标题重命名重写 `[[旧标题]]` | `rewriteWikiTitles`（2 用例） | `domain/knowledge/rewriteWikiTitles.test.ts` |
| 27 | 链接清洗（非法目标降级） | `linkSanitize`（3 用例） | `domain/knowledge/linkSanitize.test.ts` |

> 运行：`yarn vitest run dialectRoundTrip bnLiveRoundTrip blockRoundTrip frontmatterWrite rewriteWikiTitles linkSanitize`。

## 5. 已知 lossy 项登记表

> 处置：**修** = 已由 carrier/守卫修复并有回归锚点；**记录** = 保持现状、登记在案，产品接受。

| # | 现象 | 触发条件 | 现状处置 | 回归锚点 |
|---|---|---|---|---|
| L-1 | 表格列宽丢失（内容保留） | live 编辑含 GFM 表格 | 记录（L2 允许） | 矩阵 `table` probe：`/\|.+\|/`（blockRoundTrip #10） |
| L-2 | 图片题注（title）丢失 | 图片带 `"题注"` | 记录（L2 允许） | 矩阵 `image` probe（blockRoundTrip #10） |
| L-3 | 嵌入块 UI 状态（如折叠）丢失 | `![[doc#frag]]` 嵌入 | 记录（L2 允许） | 矩阵 `embed` probe |
| L-4 | 折叠块展开态丢失 | `<details>` toggle | 记录（L2 允许） | 矩阵 `toggle` probe |
| L-5 | 高亮 / 颜色 carrier 依赖 `data-hip-*` HTML | `==x==`、文字颜色 | 已修（carriers 往返） | bnLiveRoundTrip #9、blockRoundTrip #16-18 |
| L-6 | callout 图标/折叠 UI 态丢失（标签保留） | callout 块 | 已修（标签 carrier） | bnLiveRoundTrip #6、blockRoundTrip #12 |
| L-7 | 手工编辑破坏 carrier 守卫 → 降级为普通内容 | 用户在外部编辑器改坏 `data-hip-*` / 方言 fence | 记录（容错解析，不崩溃） | 矩阵 probe 缺失即失败（#10/#11） |
| L-8 | 分栏列宽（V2-E1） | columns 块宽度属性（拖拽） | **记录**：宽度仅会话级，不进入 Markdown（`data-columns` JSON 内只存列 md）；往返后恢复默认 | `columns.test.ts` + `bnLiveRoundTrip` 列用例 |
| L-9 | 同步块解除后内容冻结（V2-E1 新增，规划中） | sync block → 引用链接 fallback | **规划**：fallback 后不再跟随；合入时登记 | E1 合入后补用例 |

## 6. carrier 守卫约定（`blocks/carriers.ts` 手法）

1. **方言 fence 优先**：mermaid / svg / math 用代码围栏承载源码（换行保真）。
2. **HTML carrier 兜底**：callout、颜色、内联数学、附件等用 `data-hip-*` span/div，
   live 序列化后由 `htmlCarriersToDialect` 还原为方言。
3. **新增块（分栏/同步块）**：必须提供往返守卫 + 容错降级（守卫被破坏 → 普通段落/引用），
   并扩展 §4 清单。
4. 所有 guard 必须以「可探测 marker」登记进 `FIDELITY_MATRIX`，否则矩阵测试失败。

## 7. 编辑模型（V2-E0 摘要）

- live = 唯一编辑表面；`source` 仅内部兜底（大文档 >`KNOWLEDGE_LARGE_DOC_CHARS` / live 渲染失败），
  无 UI / 快捷键 / 命令面板入口，顶部非侵入「兼容视图」提示可关闭（24h/文档免打扰）。
- `preview` 写入模式退役：读取时归一为 `live`；历史 localStorage 键值一律忽略。
- 存储层保障 = 本文档 §4 清单全绿。
