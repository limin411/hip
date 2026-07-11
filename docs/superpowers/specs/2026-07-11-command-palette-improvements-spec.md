# 全局命令面板（⌘K）完整改进 Spec

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **Draft — 待评审** |
| 范围 | 全局 `GlobalCommandPalette` + 与 slash 面板的边界；不含重写 composer 输入框本体 |
| 前置 | Phase 2 已合入：⌘K shell、导航/主题/新建会话、最近会话、D18 与 slash 互斥 |
| 现状代码 | `src/components/command-palette/*`、`src/store/commandPaletteStore.ts`、`src/components/chat/SlashCommandPalette.tsx` |
| 主要对照 | hermes-agent `apps/desktop/src/app/command-palette/`、deer-flow command-palette、Zed / VS Code / Raycast 最佳实践 |

---

## 1. Overview

### 1.1 问题

当前全局命令面板可用但完成度低：

1. **命令面过窄** — 仅 4 导航 + 1 动作 + 3 主题 + ≤10 会话；AI 工作台核心能力（Settings 分段、Memory、Skills/MCP、code 专属动作）进不了 ⌘K。
2. **结果行信息过瘦** — 无图标、无快捷键、无描述/当前态。
3. **架构半成品** — store 已有 `page` / `openPage`，UI 未接线；嵌套页与 `keepOpen` 预览缺失。
4. **搜索偏弱** — 子串 + keywords AND，非字符级 fuzzy；无使用频率/最近使用加权。
5. **无上下文** — Chat / Code / History / Settings 下列表相同。
6. **双入口分裂** — slash `/` 与 ⌘K 内容/过滤/键盘模型不一致。
7. **可发现性弱** — 无可见触发、无快捷键帮助、空态无引导。

### 1.2 目标

把 ⌘K 升级为 **键盘优先的万能入口（universal launcher）**：

| ID | 目标 |
|----|------|
| G1 | **动作覆盖**：菜单/设置/会话/工作台动作均可搜索并执行 |
| G2 | **可扫可读**：图标 + 标签 + 可选描述 + 快捷键/chevron |
| G3 | **可导航**：嵌套页（theme 等）+ Back/Esc 层级回退 |
| G4 | **可搜索**：高质量 rank（fuzzy 友好）+ keywords + 使用信号 |
| G5 | **有情境**：按 `activeView` / session 提升相关命令 |
| G6 | **边界清晰**：slash 专注 composer 补全；全局动作归 ⌘K |
| G7 | **可扩展**：Command registry，skill/未来插件可注册 |
| G8 | **可发现**：可见触发 + 快捷键帮助 + 空态引导 |

### 1.3 非目标

| ID | 非目标 |
|----|--------|
| NG1 | 系统级 Raycast/Spotlight 替代（跨应用） |
| NG2 | 完整设置表单嵌进 palette（仅导航/选型/深链） |
| NG3 | 重写 slash 为 cmdk（P2 可共享 rank 算法，UI 可保持 listbox） |
| NG4 | 云同步命令使用统计 |
| NG5 | 用户自定义快捷键编辑器（可在 P2 预留 `action` 字段对接；本 spec 只展示现有绑定） |
| NG6 | AI 自然语言意图解析进 palette（后续可选） |
| NG7 | 移动端触控专用布局（桌面 Tauri 为主；窄窗适配保留） |

### 1.4 原则

1. **Simplicity first** — 分波交付；每波可独立验收合入。  
2. **Handoff 清晰** — palette 结束处与传统 UI 开始处有明确边界（导航 vs 填表）。  
3. **空查询克制、有查询展开** — curated 短列表 vs 长尾（会话/字段/skills）。  
4. **与 hermes 对齐交互语义，不照搬产品面** — 复用已验证的 rank/`page`/keepOpen/按需搜索模式，命令内容贴合 hip。  
5. **不破坏 D18** — ⌘K 打开时仍 dismiss slash，禁止双面板叠层。

---

## 2. 现状与目标态对照

| 维度 | 现状 | 目标态 |
|------|------|--------|
| 触发 | 仅 ⌘K | ⌘K + 可见按钮/菜单项 |
| 根列表（空查询） | 导航+动作+主题+10 会话 | curated：导航、高频动作、情境命令；主题入口进子页 |
| 有查询 | 同上过滤 | + 会话 / settings 页 / skills / 长尾动作 |
| 结果行 | label | icon + label + meta + shortcut/chevron |
| 嵌套 | store 死字段 | theme（必做）、shortcuts 帮助、可选 memory 开关页 |
| 搜索 | 子串 AND | 分词 + 字符级 fuzzy + keywords；可选 recency boost |
| 上下文 | 仅 newConversation surface | activeView / session 条件命令 |
| 扩展 | 硬编码 `buildGlobalCommands` | registry + providers |
| slash | 独立过滤与内容 | 职责收缩；共享类型/rank 可选 |

---

## 3. 信息架构

### 3.1 打开形态

```
┌─────────────────────────────────────────────┐
│  [← Back / Title]          （仅子页显示）     │
│  Search input…                              │
├─────────────────────────────────────────────┤
│  Group heading                              │
│  ◎ Icon  Label                    ⌘⇧N  ›    │
│  ◎ Icon  Label · description      ⌘,        │
│  …                                          │
├─────────────────────────────────────────────┤
│  ↑↓ 导航  ↵ 执行  esc 关闭     （footer 可选）│
└─────────────────────────────────────────────┘
```

- Overlay：保持现有 Dialog（可微调 dim 透明度；不强制透明如 hermes）。  
- 位置：居中偏上（现状 `top-[min(20vh,8rem)]` 可保留）。  
- 宽度：`min(32–34rem, 100vw-2rem)`。

### 3.2 根页分组（空查询 curated）

| 顺序 | Group id | 内容 | 说明 |
|------|----------|------|------|
| 1 | `context` | 当前视图相关动作（0–N） | 无匹配情境时可隐藏整组 |
| 2 | `navigation` | Chat / Code / History / Settings | 现有 |
| 3 | `actions` | New conversation、Keyboard shortcuts… | 扩展 |
| 4 | `workspace` | Settings 子页入口（General/Model/…）、Memory、Skills、MCP、Plugins、Agents | 空查询只放「入口级」项，非每个配置字段 |
| 5 | `appearance` | Change theme ›、Color mode ›（或直接三项 keepOpen） | 推荐子页 |
| 6 | `sessions` | **空查询默认不展示** 或仅 top 3 | 长尾见 §3.3 |

### 3.3 搜索时追加的长尾组（query 非空）

| Group id | 内容 | 数据源 |
|----------|------|--------|
| `sessions` | 最近 N 会话（默认 50，展示 cap 与 rank 截断） | `useSessions` / session list |
| `session-jump` | 若 query 像 session id →「Go to session …」 | id 正则 / 精确匹配 |
| `skills` | 已安装 skills（执行 = 插入 `/skillname ` 或导航 Skills 设置） | skills store / sessionService |
| `settings-pages` | SettingsPageId 列表 + keywords | 静态 + i18n |
| `commands-extra` | code 专属、memory 开关等未进 curated 的项 | registry |

**规则：** 长尾组仅在 `search.trim().length > 0` 时并入 `unrankedGroups`（对齐 hermes `searchGroups`）。

### 3.4 嵌套页（`page`）

| page id | 标题 | 行为 |
|---------|------|------|
| `theme` | Theme | 列出 light/dark/system；`keepOpen`；标记当前 | 
| `color-mode` | （若与 theme 拆分） | 同 theme；hip 可合并为单一 `theme` 页含 mode 三项 |
| `shortcuts` | Keyboard shortcuts | 只读快捷键表；无搜索命中也可展示静态列表 |
| （可选 P2）`pets` 等 | — | 无产品需求则不实现；store 字符串保持开放 |

**导航语义：**

- 根项 `to: 'theme'` → `setPage('theme')` + `setSearch('')`，**不** close。  
- 子页：Esc 或空输入 Backspace → 回父页（`PAGE_PARENTS`）；根页 Esc → close。  
- UI 顶栏：`← Back / {title}`。  
- `openPage(id)`：外部 deep-link（如 slash `/memory` 可改为 open settings page；未来 `/theme`）。

`PAGE_PARENTS` 初始：`{}`（一级子页直接回 root）。若增加 `install-theme` 类二级再填。

---

## 4. 数据模型

### 4.1 Command 定义（registry 单元）

```ts
/** Stable id; used for selection value, analytics, tests. */
export type CommandId = string

export type CommandGroupId =
  | 'context'
  | 'navigation'
  | 'actions'
  | 'workspace'
  | 'appearance'
  | 'sessions'
  | 'skills'
  | 'settings-pages'
  | 'commands-extra'
  | string

export interface PaletteCommand {
  id: CommandId
  /** i18n-resolved label shown in the row */
  label: string
  /** Optional secondary line / muted text */
  description?: string
  /** Search aliases (en/zh etc.) */
  keywords?: string[]
  group: CommandGroupId
  /** Lucide icon name or component ref resolved at render */
  icon?: string
  /**
   * Keybind action id for live shortcut hint.
   * Until hip has a keybind store, may be a static combo string instead.
   */
  shortcut?: string
  /** Nested page id */
  to?: string
  /** Keep palette open after run (live preview) */
  keepOpen?: boolean
  /** When false, hide unless predicates pass */
  when?: CommandWhen
  /** Score boost when empty query / context match (0–1 extra) */
  contextBoost?: number
  run?: () => void | Promise<void>
}

export interface CommandWhen {
  /** activeView must be one of */
  views?: Array<'chat' | 'code' | 'history' | 'settings'>
  /** require non-null session on current surface */
  requiresSession?: boolean
  /** surface of current session if any */
  surfaces?: Array<'chat' | 'code'>
  /** custom predicate evaluated at build time */
  enabled?: boolean
}

export interface PaletteGroup {
  id: CommandGroupId
  heading?: string
  items: PaletteCommand[]
}
```

### 4.2 Store（演进现有 `commandPaletteStore`）

```ts
interface CommandPaletteState {
  open: boolean
  page: string | null
  setOpen: (open: boolean) => void
  toggle: () => void
  openPage: (page: string) => void
  setPage: (page: string | null) => void  // NEW: in-palette navigation
  close: () => void
}
```

- 关闭时：`open=false`, `page=null`（已有）。  
- `openPage`：打开并设 page（已有；UI 必须读取）。  
- UI 本地 `search` 仍用 component state；关闭清空。

### 4.3 Usage signals（P1）

```ts
// localStorage key: hip.commandPalette.usage.v1
interface CommandUsageStore {
  /** commandId → { count, lastUsedAtMs } */
  byId: Record<string, { count: number; lastUsedAtMs: number }>
}
```

- 仅在成功 `run` 且非 `to` 导航时记录。  
- 不上传；可随 clear data 清除。  
- Rank：`final = baseScore + min(0.15, log1p(count)*0.03) + recencyBoost`。

### 4.4 Registry API（P0 末 / P1 初）

```ts
type CommandProvider = (ctx: CommandBuildContext) => PaletteGroup[] | PaletteCommand[]

interface CommandBuildContext {
  activeView: ActiveView
  theme: Theme
  sessions: SessionVM[]
  sessionId: string | null
  surface: 'chat' | 'code' | null
  labels: GlobalCommandLabels // expanded
  skills?: SkillMeta[]
  // action callbacks injected by shell
  actions: CommandActions
}

// registerCommandProvider('core-nav', provider)
// buildAllGroups(ctx) → PaletteGroup[]
```

**P0 允许** 仍集中在 `buildGlobalCommands.ts`，但类型迁到 `types.ts`，并为 P1 registry 留出 `providers: CommandProvider[]` 扩展点（空数组或单 core provider）。

---

## 5. 命令目录（产品清单）

> 实现时每条必须有稳定 `id`、i18n label、keywords（中英）、icon、run/to。  
> `when` 未列 = 全局可见。

### 5.1 Navigation

| id | label（en 示意） | run | shortcut 展示 |
|----|------------------|-----|---------------|
| `nav-chat` | Work / Chat | `setActiveView('chat')` | — |
| `nav-code` | Coding | `setActiveView('code')` | — |
| `nav-history` | History | `setActiveView('history')` | — |
| `nav-settings` | Settings | `setActiveView('settings')` | ⌘,（若绑定） |

### 5.2 Actions

| id | label | run | 备注 |
|----|-------|-----|------|
| `action-new-conversation` | New conversation | `newConversation(surface)` | surface 随 activeView |
| `action-keyboard-shortcuts` | Keyboard shortcuts | `to: 'shortcuts'` 或打开帮助 Dialog | P0 |
| `action-toggle-command-palette` | — | 不出现在列表（仅热键） | — |

### 5.3 Workspace / Settings 入口

| id | label | run |
|----|-------|-----|
| `settings-general` | Settings: General | `setActiveView('settings'); setSettingsPage('general')` |
| `settings-model` | Settings: Model | `… 'model'` |
| `settings-agents` | Settings: Agents | `… 'agents'` |
| `settings-mcp` | Settings: MCP / External tools | `… 'mcp'` |
| `settings-skill` | Settings: Skills | `… 'skill'` |
| `settings-plugins` | Settings: Plugins | `… 'plugins'` |
| `settings-memory` | Settings: Memory | `… 'memory'` |

空查询：可全部放在 `workspace` 组，或仅 Model / Memory / Skills 进 curated，其余仅搜索可见（实现选：**全部可搜索；curated 展示 Model、Memory、Skills、MCP**）。

### 5.4 Appearance

| id | label | 行为 |
|----|-------|------|
| `appearance-theme` | Change theme… | `to: 'theme'` |
| `theme-light` / `theme-dark` / `theme-system` | 子页项 | `setTheme` + `keepOpen: true`；当前项 `description: 'Current'` 或 check icon |

搜索「dark」时根级也可直接命中 `theme-dark`（searchGroups 注入，keepOpen）。

### 5.5 Context / Code / Session

| id | when | label | run（handoff） |
|----|------|-------|----------------|
| `ctx-diff` | code | Show workspace changes | 切 code + 打开 Changes tab / 触发与 `/diff` 相同 handoff |
| `ctx-compact` | code + session | Compact conversation | 与 slash compact 同路径 |
| `ctx-init` | code | Initialize project | 与 `/init` 同 |
| `ctx-memory-settings` | any | Open Memory settings | settings-memory |
| `ctx-memory-on` | session | Enable memories | 与 slash 同 |
| `ctx-memory-off` | session | Disable memories | 同 |
| `ctx-memory-incognito` | session | Incognito memory | 同 |
| `ctx-memory-status` | session | Memory status | toast / 同 slash |

**Handoff 原则：** 全局面板 **执行同一 domain API**，不复制业务；slash 与 ⌘K 共享 `runX` 函数（抽到 `domain/` 或 `commands/`）。

### 5.6 Sessions（搜索时）

| id | label | run |
|----|-------|-----|
| `session-{id}` | title / preview / id | `selectSession(id)` |
| `session-goto-{id}` | Go to session {id} | 精确 id 匹配时 |

### 5.7 Skills（搜索时，P0.5 / P1）

| id | label | run |
|----|-------|-----|
| `skill-{id}` | Skill: {name} | **Handoff A（推荐）**：关闭 palette，focus composer，填入 `/{name} `；**或** B：仅打开 Skills 设置 |

默认 **Handoff A**（与 slash 选择一致，便于执行 skill）。无 composer 焦点时 fallback 打开 Skills 设置。

### 5.8 不纳入（本 spec）

- 逐条 hip.toml 配置字段深链（设置字段级搜索 → P2 可选）  
- Plugin 动态命令（G7 预留 registry；P2 接插件）  
- 模型目录内每个 model id（体积过大；用 Settings: Model 入口）

---

## 6. UX 规格

### 6.1 触发与关闭

| 操作 | 行为 |
|------|------|
| ⌘K / Ctrl+K | toggle；IME `isComposing` 忽略 |
| 可见按钮 | `setOpen(true)`；位置：Titlebar 或侧栏底部（实现选 titlebar 工具区） |
| Esc | 子页 → 回退；根 → close |
| 点击 overlay | close（Radix 默认） |
| 执行无 `keepOpen` 命令 | run + close |
| 执行 `keepOpen` | run，保持 open 与 focus |
| 选择 `to` | 进子页，不清 open |

### 6.2 结果行

```
[icon 14–16px][ label truncated ][ optional muted description ]
                              [kbd combo | chevron-right]
```

- `data-[selected=true]:bg-accent-subtle` 保持。  
- 当前主题/当前 view：label 旁 check 或 `description: Current`。  
- 无障碍：Dialog.Title sr-only；每项可聚焦；列表 `Command.List`。

### 6.3 空态

| 状态 | 文案 |
|------|------|
| 无匹配 | `No results` + 次行 hint：`Try “theme”, “memory”, or a session name`（i18n） |
| 加载 skills/sessions 中 | 可选 skeleton；P0 可同步数据免 loading |

删除/替换 i18n `emptyHint: 'Commands coming soon'`。

### 6.4 Footer（P1）

可选底栏：`↑↓` Navigate · `↵` Run · `esc` Close；子页加 `⌫` Back。  
窄高度时可隐藏。

### 6.5 快捷键帮助页 `shortcuts`

静态列表（与 deer-flow 类似），至少：

| Combo | Action |
|-------|--------|
| ⌘K | Command palette |
| ⌘N / 现有绑定 | New conversation（若有） |
| `/` in composer | Slash commands |
| … | 从单一 `KEYBIND_HELP` 源生成 |

P0 可用 Dialog 替代嵌套页；P1 统一为 `page: 'shortcuts'`。

### 6.6 与 slash 的边界（锁定）

| 能力 | slash `/` | ⌘K |
|------|-----------|-----|
| 插入 `/cmd` 文本进 composer | ✓ 主路径 | Skills 可选 handoff A |
| 导航、设置、主题、会话 | ✗（`/config` 已删） | ✓ |
| Memory 开关 / status | ✓ 保留（composer 内快） | ✓ 同源 action（P0） |
| diff/compact/init | ✓ | ✓ 同源（P0 context） |
| 过滤算法 | 可暂独立 | rankGlobalCommands → 共享模块 |

**D18 保留：** `open === true` 时 composer dismiss slash query。

**文档/帮助：** slash `help` 文案注明「全局动作见 ⌘K」。

---

## 7. 搜索与排序

### 7.1 P0（改进现有，不换算法内核）

保持 `shouldFilter={false}` + 自研 `scoreItem` / `rankGroups`：

1. 规范化：trim + lower case（现有）。  
2. 多词 AND（现有）。  
3. 分档：exact → prefix → whole word → word prefix → substring → all terms in label → keyword-only（现有）。  
4. **新增：**  
   - `description` 参与 keywords 级匹配（弱分 0.35）。  
   - 空查询：不 rank，按 group 定义顺序；组内可按 `contextBoost` / usage 轻排。  
   - 有查询：组间按 max score；组内按 score；**稳定排序**保并列时源序。

### 7.2 P1 Fuzzy

在 `rankGlobalCommands.ts`（或 `fuzzyScore.ts`）增加字符级 fuzzy：

- 允许非连续字符匹配（`ssmd` 风格），命中记 `fuzzyScore ∈ (0, 0.65]`。  
- 与现有分档 **取 max**，避免破坏 exact/prefix 优先。  
- 可选：返回 match ranges 供 UI 高亮（P1 UI）。  
- 依赖：优先零依赖实现；若引入库需评估包体（桌面可接受 `fuse.js` 级，但优先自研轻量）。

### 7.3 P1 Usage boost

见 §4.3；仅影响 `score > 0` 的项，不把无关项抬进列表。

### 7.4 会话列表策略

| 模式 | 策略 |
|------|------|
| 空查询 | 默认 **不展示** sessions 组（推荐）；或 cap=3 且排在最底 |
| 有查询 | 自全量/最近 50 中 rank，展示 top 15 |
| 精确 id | 置顶 `session-jump` |

锁定：**空查询不展示 sessions**（避免淹没动作）。

---

## 8. 架构与文件规划

```
src/components/command-palette/
  feature.ts                 # 保留 feature flag（稳定后可删）
  index.ts
  GlobalCommandPalette.tsx   # 壳：Dialog + 子页路由 + 列表渲染
  GlobalHotkeysBinder.tsx
  useGlobalHotkeys.ts
  types.ts                   # PaletteCommand, groups, context
  registry.ts                # providers + buildAllGroups
  rankGlobalCommands.ts      # score + rank + (P1 fuzzy)
  usageStore.ts              # P1 localStorage
  buildGlobalCommands.ts     # → core provider 实现（或拆分）
  pages/
    ThemePage.tsx            # 或内联 subPages map
    ShortcutsPage.tsx
  components/
    CommandRow.tsx           # icon/label/kbd/chevron
    PaletteFooter.tsx        # P1
  keys.ts                    # KEYBIND_HELP 静态表
```

**Domain 抽出（避免复制 slash 逻辑）：**

```
src/domain/commands/  或  src/commands/
  memoryActions.ts    # on/off/incognito/status
  codeActions.ts      # diff/compact/init
  navigationActions.ts
```

Slash 与 palette 均 import 上述 actions。

### 8.1 渲染契约

- `Command`：`shouldFilter={false}`，建议 `loop`。  
- `value`：`${label}\u0001${id}`（现有，防重名）。  
- 自定义 empty：不用依赖 cmdk internal empty 计数。  
- 子页 server-driven：本 spec 无；skills 同步即可。

### 8.2 i18n

扩展 `commandPalette.*`：

- groups：`context`, `workspace`, `appearance`, `skills`, …  
- actions：各新命令  
- `back`, `current`, `searchHint`, `footer.*`  
- 删除/改写 `emptyHint: Commands coming soon`

语言：`en` / `zh-CN` / `zh-TW` 同步。

---

## 9. 分优先级交付（全部改进项）

### Wave P0 — 有用感与骨架闭环

**目标：** 命令够用、行可读、嵌套可用、边界清楚。

| ID | 项 | 说明 | 验收 |
|----|----|------|------|
| P0-1 | **结果行信息密度** | icon + label + shortcut 位 + `to` chevron | 视觉与单测 data-testid |
| P0-2 | **接线 `page`** | Theme 子页；Back/Esc/空 Backspace；`openPage('theme')` | store 单测 + UI 测 |
| P0-3 | **keepOpen 主题** | 子页切换主题不关面板；标记 Current | 手动 + 测 |
| P0-4 | **Settings 深链命令** | 全部 `SettingsPageId` | 点击落到正确 settings 页 |
| P0-5 | **Memory / code 上下文命令** | 与 slash 同源 actions | 有 session 时可见 memory 开关；code 见 diff 等 |
| P0-6 | **Keyboard shortcuts 入口** | 命令 + 简单帮助 UI | 可打开并看到 ⌘K 等 |
| P0-7 | **空查询 IA** | 去掉空查询 sessions；curated 组序 §3.2 | 打开面板不刷 10 会话 |
| P0-8 | **搜索时长尾 sessions** | query 非空才出 sessions | 测 |
| P0-9 | **类型与 build 清理** | `PaletteCommand` 扩字段；去掉 dead 感 | tsc 绿 |
| P0-10 | **i18n / empty 文案** | 三语言；去掉 coming soon | 文案 review |
| P0-11 | **可见触发（最小）** | Titlebar 或菜单一项「命令面板」 | 无键盘用户可打开 |
| P0-12 | **e2e 扩展** | open / filter settings / theme page / select | `command-palette.spec.ts` |

**P0 非必须但鼓励：** Skills 搜索（可放到 P1-0 若工期紧）。

### Wave P1 — 搜索质量、情境、统一 rank

| ID | 项 | 说明 | 验收 |
|----|----|------|------|
| P1-1 | **Fuzzy 匹配** | 字符级；exact 仍优先 | 单测用例集（含中英） |
| P1-2 | **匹配高亮** | label 内 mark ranges | 视觉 |
| P1-3 | **Usage / recency boost** | localStorage | 重复使用后排序变化（单测 mock storage） |
| P1-4 | **Registry** | `registerCommandProvider` + core provider | 新 provider 单测可注入 |
| P1-5 | **Skills 进搜索** | 长尾组 + handoff A | 有 skill 时能搜到并填入 composer |
| P1-6 | **Context 组强化** | `contextBoost`；当前 view 命令置顶 | 在 code 打开时 context 组有 diff 等 |
| P1-7 | **共享 rank 模块** | slash 可选复用 fuzzy | 不强制改 slash UI |
| P1-8 | **Footer 快捷提示** | 底栏 | 可选 feature |
| P1-9 | **description 展示** | 次行 meta | 长 label 不挤压 kbd |
| P1-10 | **根级主题直达** | 搜索 dark 直接 keepOpen 切换 | 与子页一致 |

### Wave P2 — 扩展、统一入口、抛光

| ID | 项 | 说明 | 验收 |
|----|----|------|------|
| P2-1 | **Plugin/skill provider 稳定 API** | 文档化注册；插件贡献命令 | 契约测 |
| P2-2 | **设置字段级搜索** | 可选；类似 hermes field deep-link | 仅高价值字段 |
| P2-3 | **Favorites** | 用户钉选命令；⌘1–9 可选 | 持久化 |
| P2-4 | **Query 前缀模式** | 可选：`>` 仅命令、`#` 仅会话、`@` skills | 文档化 |
| P2-5 | **slash 与全局进一步统一** | 共享 command 源；slash 仅 filter kind=slashable | 无重复定义 |
| P2-6 | **Keybind store 对接** | 动态 shortcut 展示（若产品做快捷键设置） | 绑定变更面板同步 |
| P2-7 | **无障碍审计** | 键盘闭环、焦点恢复、读屏标签 | 检查清单 |
| P2-8 | **动效 / reduced-motion** | 尊重系统 | 手动 |
| P2-9 | **性能** | 会话 1k+、skills 200+ 时 rank < 16ms 目标 | 基准可选 |
| P2-10 | **移除 feature flag** | `GLOBAL_COMMAND_PALETTE` 常真后删 | — |

---

## 10. 改进项总表（追溯矩阵）

| 原分析缺点 | 覆盖工作项 |
|------------|------------|
| 命令覆盖过窄 | P0-4, P0-5, P0-6, P1-5, P2-1, P2-2 |
| 结果行过瘦 | P0-1, P1-9 |
| page 死状态 / 无嵌套 | P0-2, P0-3 |
| 无 keepOpen 预览 | P0-3, P1-10 |
| 非 fuzzy | P1-1, P1-2 |
| 无频率/最近 | P1-3, P2-3 |
| 无上下文 | P0-5, P1-6 |
| 双面板分裂 | §6.6, P0-5, P1-7, P2-5 |
| 空查询 sessions 淹没 | P0-7, P0-8 |
| 可发现性 | P0-6, P0-10, P0-11, P1-8 |
| 无扩展点 | P1-4, P2-1 |
| 工程半成品 | P0-9, P2-10 |

---

## 11. 交互时序

### 11.1 打开并切换主题

```
User ⌘K
  → setOpen(true), page=null, search=''
  → 渲染 curated 根列表
User 选 "Change theme…"
  → setPage('theme'), search=''
  → 渲染 theme 子页（Current 标记）
User 选 "Dark" (keepOpen)
  → setTheme('dark')，面板仍开
User Esc
  → setPage(null) 回到根
User Esc
  → close()
```

### 11.2 搜索会话

```
User ⌘K → 输入 "foo"
  → baseGroups + searchGroups(sessions, …)
  → rankGroups
User ↵ on session
  → selectSession → close
```

### 11.3 Memory on（同源）

```
User 在 chat 且有 session
  → context/workspace 含 Enable memories
User 选中
  → memoryActions.enable(sessionId)  // slash 同函数
  → close + toast（若现网有）
```

---

## 12. 测试计划

### 12.1 单元 / 组件

| 区域 | 用例 |
|------|------|
| `scoreItem` / fuzzy | 分档、多词 AND、中文 keywords、fuzzy 跳字、description 弱匹配 |
| `rankGroups` | 空查询保序；过滤零分；组重排；usage boost |
| `build` / registry | when 过滤；空查询无 sessions；有查询有 sessions；settings 页命令 |
| Theme page | openPage；keepOpen；Current；Esc back |
| Hotkeys | ⌘K toggle；IME skip |
| usageStore | 读写、上限（可选 LRU cap 500 keys） |

### 12.2 e2e（扩展现有 S5）

| # | 场景 |
|---|------|
| E1 | 打开/关闭/⌘K toggle |
| E2 | 过滤「settings」命中 Settings 与 settings-* |
| E3 | 进入 theme 子页并切换 dark |
| E4 | 有会话时搜索标题并 select |
| E5 | 打开后无默认 sessions 刷屏（空查询断言条数/组） |
| E6 | 可见按钮可打开 |

### 12.3 回归

- D18：⌘K 时 slash 消失  
- slash memory/diff 仍可用  
- 设置页手动导航不受影响  

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 命令过多淹没 | 空查询 curated + 搜索长尾 |
| slash / ⌘K 行为漂移 | 强制同源 `domain/commands` actions |
| fuzzy 误匹配 | exact/prefix 绝对优先；阈值 capped |
| 图标不一致 | 统一 lucide；一张 id→icon map |
| keepOpen 后焦点丢失 | 选后 `Command.Input` 保持 focus |
| 会话列表性能 | cap 50 源 / 展示 top 15；后续虚拟列表 |
| 与未来 keybind 系统耦合 | shortcut 先静态字符串，字段预留 action id |

---

## 14. 里程碑建议

| 里程碑 | 范围 | 预估粒度 |
|--------|------|----------|
| M1 | P0-1 … P0-12 | 1 个中型 PR 或 2 个 PR（UI 壳 / 命令面） |
| M2 | P1-1 … P1-10 | 1–2 PR（fuzzy+usage / registry+skills） |
| M3 | P2 按需 | 独立小 PR，不阻塞 M1/M2 |

**合入顺序闸门：**

1. M1 合并前：e2e E1–E6 绿、D18 回归。  
2. M2 合并前：fuzzy 单测集 + 无性能明显回退。  
3. M3：可增量，无硬闸门。

---

## 15. 开放问题（评审时拍板）

| # | 问题 | 建议默认 |
|---|------|----------|
| Q1 | Skills 选择：填入 composer vs 打开设置 | **填入 composer（Handoff A）** |
| Q2 | 空查询是否保留 top-3 sessions | **不保留** |
| Q3 | 快捷键帮助：嵌套页 vs Dialog | P0 Dialog，P1 嵌套页 |
| Q4 | 可见触发位置 | Titlebar 右侧工具区 |
| Q5 | Theme 是否拆 color-mode 与 theme 两页 | **单页三项 mode**（hip 无多皮肤时可够用） |
| Q6 | 是否 P0 就引入 registry | **类型先就位；单 core builder 可接受，P1 再多 provider** |
| Q7 | Fuzzy 自研 vs 库 | **自研轻量优先** |

---

## 16. 参考

- 现有实现：`src/components/command-palette/`、`commandPaletteStore`  
- hermes-agent：嵌套页、`keepOpen`、searchGroups、KbdCombo、icon  
- deer-flow：CommandShortcut、快捷键帮助 Dialog  
- Destiner *Designing a Command Palette*：全动作覆盖、hotkeys、fuzzy、favorites、discoverability  
- Sam Solomon：keyboard focus、handoffs、context awareness  
- UX Patterns — Command Palette：分组、空态、a11y、状态生命周期  

---

## 17. 验收总标准（Done 定义）

**P0 Done：**

1. ⌘K 可完成：导航、新建会话、全部设置子页、主题（子页+预览）、memory/code 关键动作、快捷键帮助。  
2. 结果行具备 icon；有 shortcut 则展示；子页有 chevron/Back。  
3. 空查询无「10 条会话刷屏」；搜索会话可用。  
4. `openPage` / `page` 不再是死状态。  
5. 三语言文案无 “coming soon”。  
6. 单测 + e2e 扩展通过；D18 保持。

**P1 Done：**

7. Fuzzy +（可选）高亮；usage 影响排序。  
8. Registry 可注入；skills 可搜。  
9. 情境组在 code/chat 下表现正确。

**P2 Done：**

10. 扩展 API 文档化；前缀模式/收藏/字段搜索等按立项完成；flag 清理；a11y 清单关闭。

---

## 附录 A — 建议 PR 切片

| PR | 内容 |
|----|------|
| PR-A | 类型 + CommandRow + 空查询 IA + settings 深链 + i18n（P0-1,4,7,8,9,10） |
| PR-B | page 接线 + Theme keepOpen + Esc/Back（P0-2,3） |
| PR-C | context/memory/code 同源 actions + shortcuts 帮助 + 可见触发（P0-5,6,11） |
| PR-D | e2e + 回归（P0-12） |
| PR-E | fuzzy + usage + highlight（P1-1,2,3,10） |
| PR-F | registry + skills 长尾（P1-4,5,6,7） |
| PR-G+ | P2 按项 |

## 附录 B — 与 hermes 差异（有意不做）

| hermes | hip |
|--------|-----|
| Pets / marketplace theme | 无对等产品则不做 |
| Gateway restart / update | 可后续 system 组 |
| Worktree branches | code 工作区成熟后再加 |
| 透明 overlay HUD | 保持 dim overlay，贴 hip 视觉 |
| 200 会话 + archived 查询 | 先 50 + 本地 sessions |
| 配置字段全量深链 | P2 可选 |

---

**实现计划：** [`../plans/2026-07-11-command-palette-improvements.md`](../plans/2026-07-11-command-palette-improvements.md)（T1–T14，P0→P1→P2）。

**下一步：** 评审 §15 开放问题（计划已按建议默认锁定）→ 按 plan Task 1 开工。
