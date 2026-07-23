# Global Command Palette 优化 — Spec

**Status:** implemented (Phases A–E)  
**Date:** 2026-07-24  
**Scope:** `src/components/command-palette/*`、`src/domain/commands/*`、composer slash 与全局面板对齐  
**Reference:** grok-build TUI (`xai-grok-pager`: `CommandPalette` / `ArgPicker` / `ActionRegistry` / `SendSlashCommandPreservingDraft`)

Related:

- Runtime README: `src/components/command-palette/README.md`
- Execution plan: [command-palette-execution-plan.md](./command-palette-execution-plan.md)

---

## 0. 现状（已有能力）

| 能力 | 实现 |
|------|------|
| 全局入口 | `⌘K` / `Ctrl+K`，titlebar 按钮，`useCommandPaletteStore` |
| 分组 + 前缀 | `>` 命令 / `#` 会话 / `@` skills（`queryPrefix.ts`） |
| 排序 | 子串 + fuzzy（`fuzzyScore`）+ usage boost（`usageStore`） |
| 收藏 | star + Favorites 组（`favoritesStore`） |
| 快捷执行 | 打开时 `⌘1–⌘9`（`hotkeyItems`） |
| 嵌套页 | theme 子页（`page: string \| null` + Esc/Back） |
| 扩展点 | `registerCommandProvider` |
| 长尾 | skills、knowledge docs、sessions（搜索时） |
| Domain 共享 | compact / diff / init / memory\* 经 `domain/commands` |
| Composer slash | 独立 `SlashCommandPalette` + `SLASH_BUILTIN_COMMANDS` |
| Skills handoff | `replaceComposerText('/{name} ')`；无 composer 时 toast，不静默开 Settings |

---

## 1. 缺陷清单

### P0 — 产品语义

| ID | 缺陷 | 对照 grok-build |
|----|------|-----------------|
| D1 | **双轨割裂**：⌘K 与 `/` slash 两套 catalog（`buildGlobalCommands` vs `SLASH_BUILTIN_COMMANDS`） | 一盘承载 shortcuts + slash + skills |
| D2 | **Skill 默认 `replace` 整段草稿**，破坏进行中的 prompt | `SendSlashCommandPreservingDraft` |
| D3 | **无带参二级选择**：仅 theme 嵌套；无 model / resume session 的 sub-picker 栈 | `ArgPicker` + `previous_palette` Esc 恢复 |
| D4 | **Session 高频动作不全**：`plan` / `plan-off` 已有 domain handler 但未进面板；切换模型只能进 Settings | 面板直达 + 专用 picker |
| D5 | **快捷键帮助过弱**：`ShortcutsHelpDialog` 写死 8 条，与真实 binding 不同源 | 由 action/keybind 表生成 |

### P1 — 架构与正确性

| ID | 缺陷 | 说明 |
|----|------|------|
| D6 | **`contextBoost` 死字段** | `types` / `buildGlobalCommands` 赋值，`rankGlobalCommands` 从不读取 |
| D7 | **`when.surfaces` 死字段** | `matchesWhen` 不检查；diff/init 等 code-only 规则无法生效 |
| D8 | **空打开 IA 偏导航/设置**，无 Recent commands（usage 只在有 needle 时 boost） | 缺 MRU / Session 入口 |
| D9 | **可见性与 slash `availableIn` 不对齐** | builtins 有 chat\|code；全局面板 context 未对齐 |
| D10 | **`registerCommandProvider` 生产几乎未用** | 扩展点闲置 |

### P2 — UX 打磨

| ID | 缺陷 |
|----|------|
| D11 | 查询模式不足：无 `/` slash-only 模式；knowledge 无专用前缀 |
| D12 | 行信息密度：description 易藏；slash 名未稳定展示 |
| D13 | 嵌套只有一层 `page: string`，无 `PaletteSnapshot`（search/selected 恢复） |
| D14 | 空结果引导弱（尤其 prefix 模式下） |

---

## 2. 目标

| ID | Goal | Success criteria |
|----|------|------------------|
| G1 | 统一 catalog | 内置 slash 与面板 context/actions 同源；composer `/` 与 ⌘K 不重复手写定义 |
| G2 | 草稿安全 | 面板触发 skill/默认动作 **preserve** composer；replace 仅显式策略 |
| G3 | 可回退二级选择 | theme / model / sessions 走 page 栈；Esc/Back 回 root，search 可恢复 |
| G4 | 补齐 session 动作 | plan / plan-off 可见可跑；Switch model… / Resume session… 可用 |
| G5 | when 与 rank 生效 | `surfaces` 过滤；`contextBoost` 参与排序；有单测 |
| G6 | 空打开更可用 | Favorites + Recent(MRU) + Suggested + Nav/Workspace |
| G7 | 快捷键文档同源 | help 列表与实际 binding 常量同源（不必完整 ActionRegistry） |

## 3. 非目标

- 完整移植 TUI `ActionRegistry` / vim mode / 编译期 `ActionId`
- 可配置全局快捷键 remapping
- 改 auth / keychain 方案
- 在面板内实现完整 Settings 编辑器
- 一次性把所有插件/MCP 业务塞进 palette（provider 协议保留，业务分批挂）

---

## 4. 设计原则

1. **Single source of truth**：内置命令定义一处；全局面板与 composer `/` 共同消费。
2. **Draft-preserving by default**：面板路径默认不 wipe composer；`draftPolicy: 'replace'` 为少数例外。
3. **Execute or drill-down**：直接 `run()`，或进入可 Esc 回退的 sub-picker。
4. **Surgical**：优先接现有 `domain/commands`、`ModelPicker` 数据源、settings 深链；不平行复制业务逻辑。
5. **Desktop 适配，非 TUI 复刻**：吸收同源 catalog、draft preserve、sub-picker 栈、surface when；不照搬终端 chrome。

---

## 5. 信息架构

### 5.1 空打开（`needle` 空且 mode=all）

```
Favorites          （若有 pin）
Recent             （usage MRU，最多 5–8 条；仅 when 满足且 id 可解析）
Suggested          （session 上下文动作；无 session 时 need-session 提示）
Session            （New conversation / Resume session…）
Navigation         （Chat / Code / History / Trash / Knowledge / Terminals…）
Workspace          （精选 Settings 深链；搜索时展开全部设置页）
Appearance         （Change theme… → 子页）
```

### 5.2 查询前缀

| 输入 | Mode | 行为 |
|------|------|------|
| （无） | `all` | 全部 + long-tail（skills / knowledge / sessions） |
| `>` | `commands` | actions / nav / settings / context / appearance（无 session/skill 行） |
| `#` | `sessions` | 仅会话 |
| `@` | `skills` | 仅 skills |
| `/` | `slash`（**新增**） | 仅 slash-catalog（builtin + skill），展示 `/name` |
| 知识前缀 | 可选 Phase 后置 | 仅 knowledge docs（若做，前缀字符另定，避免与 `@` 冲突） |

### 5.3 搜索 long-tail（保持）

- Sessions：搜索或 `#` 时列出（cap 不变：`RECENT_SESSION_LIMIT` / `SESSION_DISPLAY_CAP`）
- Skills：搜索或 `@` / `/`
- Knowledge docs：搜索时（index 未就绪展示 indexing 行）

---

## 6. 统一命令模型

### 6.1 类型（目标形状）

```ts
type CommandSource =
  | 'builtin-slash'
  | 'action'
  | 'skill'
  | 'session'
  | 'knowledge'
  | 'nav'
  | 'settings'

type DraftPolicy = 'preserve' | 'replace' | 'insert'

type PaletteCommandDef = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  group: CommandGroupId
  icon?: PaletteIconName
  shortcut?: string
  /** 对应 /foo 时用于匹配与展示 */
  slashName?: string
  source?: CommandSource
  when?: CommandWhen
  run?: (ctx: GlobalCommandContext) => void | Promise<void>
  to?: PalettePageId
  draftPolicy?: DraftPolicy
  keepOpen?: boolean
  contextBoost?: number
}
```

`CommandWhen`（生效规则）：

| 字段 | 语义 |
|------|------|
| `views?` | 限制 `activeView` |
| `surfaces?` | `chat` \| `code`；由 activeView 或 session surface 解析 |
| `requiresSession?` | 需要可解析 `sessionId` |
| `enabled?` | 显式 false 则隐藏 |

### 6.2 Catalog 来源

| 来源 | 产出 |
|------|------|
| `SLASH_BUILTIN_COMMANDS` + i18n | 面板 Suggested / slash 行 + composer `/` 列表 |
| `buildGlobalCommands` 中 nav / settings / appearance | `nav` / `settings` / `action` |
| skills provider | `skill-*`，默认 `draftPolicy: 'insert'` |
| knowledge provider | `knowledge-doc-*` |
| sessions long-tail | `session-*` |
| `registerCommandProvider` | 插件/模块附加 groups |

### 6.3 Domain handlers（禁止在 UI 重复）

继续经 `domain/commands`：

- `runDiff` / `runCompact` / `runInit`
- `runPlanOn` / `runPlanOff`
- memory 系列（settings / on / off / incognito / status）

面板只做：可见性 + label + 调用。

---

## 7. 执行语义

| 类型 | 行为 |
|------|------|
| 纯 UI（nav、settings 深链） | `run` → 关面板 |
| 无参 domain（compact、memory-on…） | 直接 handler；**不碰 composer** |
| 需选一项（theme、model、resume） | 开 sub-picker；Esc 回 root |
| Skill | **默认 `insert`** `/{name} ` 到 caret（或 append）；**preserve 现有草稿** |
| 需要 composer 但未挂载 | toast（现有 `needComposer`）；禁止静默跳 Settings |
| 显式 `draftPolicy: 'replace'` | 仅文档约定的少数命令（当前默认 **不对 skill 启用**） |

### 7.1 Skill 策略变更（相对现状）

| 现状 | 目标 |
|------|------|
| `replaceComposerText('/{name} ')` | 优先 `insertComposerText('/{name} ')` |
| 无 handler 时 selectSession + replace retry | selectSession + **insert** retry |
| — | 若未来需要「整段变成 slash」可加设置或 `replace` 策略，默认关闭 |

---

## 8. 二级选择（Page stack）

### 8.1 Store 形状

```ts
type PalettePage =
  | null
  | { id: 'theme' }
  | { id: 'model' }
  | { id: 'sessions' }

// 实现可选增强：保存回退快照
type PaletteSnapshot = {
  search: string
  page: PalettePage
}
```

最低要求：

- `openPage(page)` / `setPage` / `close` 清 page
- Esc / Back / 子页空输入 Backspace：先退 page，再关面板
- 进入子页时清空**子页搜索**；回 root 时 **恢复** 进入前 root `search`（推荐）

### 8.2 子页行为

| Page | 数据源 | 选中 |
|------|--------|------|
| `theme` | light/dark/system | `setTheme`；`keepOpen` + active check（现有） |
| `model` | 与 `ModelPicker` 同源模型列表 | 切换当前会话（或 draft）模型；关面板 |
| `sessions` | 近期会话（与 `#` 同源排序/cap） | `selectSession`；关面板 |

空打开提供入口：

- `appearance-theme` → `theme`（已有）
- `action-switch-model` → `model`（新增）
- `action-resume-session` → `sessions`（新增）

---

## 9. 排序与可见性

### 9.1 评分

```
score = max(substring/fuzzy base, 0)
if score > 0:
  score += usageBoost(id)
  score += contextBoost ?? 0   // 仅匹配后加分；建议 cap 与 usage 同量级（如 ≤0.15）
```

空 needle：不按 score 重排 groups；但 **Recent** 组单独按 `lastUsedAtMs` 组装。

### 9.2 Surface 规则（锁定）

| 命令 | 默认可见 |
|------|----------|
| diff / init / plan / plan-off | **code** surface（`activeView === 'code'` 或当前 session surface 为 code） |
| compact / memory\* / clear-like | chat + code（有 session 约束的按 `requiresSession`） |
| nav / settings / theme | always（views 另有限制的除外） |

搜索时：code-only 命令在 chat **是否可被关键词命中**——**Phase A 建议：默认隐藏且搜索也不露出**（简单一致）；若 dogfood 需要「chat 也能搜到 init」，再改为「默认隐藏、搜索放宽」。

### 9.3 Recent（空打开）

1. 读 `usageStore`，按 `lastUsedAtMs` 降序。
2. 在当前 `buildAllGroups` 解析 id → 命令（跳过 `to` 纯入口可保留）。
3. 再过 `matchesWhen`；最多 N=8 条。
4. 组 id：`recent`；heading i18n。

---

## 10. 第一期应上的面板项

| id | 标签（en 示意） | when | 执行 |
|----|-----------------|------|------|
| `ctx-plan` | Force plan mode | code + session/draft | `runPlanOn` |
| `ctx-plan-off` | Exit plan mode | code | `runPlanOff` |
| `action-switch-model` | Switch model… | session（或 draft） | page `model` |
| `action-resume-session` | Resume session… | always | page `sessions` |
| 现有 memory / diff / compact / init | 保持 | 修好 surface/session | domain |
| slash 镜像 | 与 composer 一致 | 同源 catalog | 同 handler |

第二期（本 spec 记录，不阻塞 G1–G7）：permission mode、worktree、export debug、agent management 快捷入口、插件真实 provider 挂载。

---

## 11. 组件边界

```
src/components/command-palette/
  GlobalCommandPalette.tsx     Dialog + cmdk + page 栈
  buildGlobalCommands.ts       从 catalog + ctx 生成 groups（逐步变薄）
  catalog.ts                   （新增或 domain 扩展）统一 builtin 投影
  registry.ts                  providers + skills/knowledge
  rankGlobalCommands.ts        score + usage + contextBoost
  queryPrefix.ts               前缀 + `/` mode
  composerBridge.ts            insert / replace；策略文档化
  types.ts                     CommandWhen 生效字段
  store (commandPaletteStore)  page 对象化
  ShortcutsHelpDialog.tsx      读 keybind 表
  components/CommandRow.tsx    行展示

src/domain/commands/
  slashBuiltins.ts             唯一 builtin 列表
  planActions / codeActions / memoryActions  执行体
```

---

## 12. i18n

新增/调整 key 前缀 `commandPalette.*`（en + zh-CN 至少同步；其他 locale 按仓库惯例）：

- `groups.recent`
- `actions.switchModel` / `actions.resumeSession`
- `context.plan` / `context.planOff`
- `searchPlaceholder`（若加入 `/` 提示）
- `skills` toast 文案（insert 语义）
- shortcuts 条目扩展

---

## 13. 测试策略

| 层 | 范围 |
|----|------|
| unit | `matchesWhen` surfaces、`contextBoost` 排序、`parsePaletteQuery` `/`、Recent 组装、plan 项、skill insert 不 replace |
| component | GlobalCommandPalette：model/sessions 页、Esc 栈、surface 过滤 |
| e2e | 现有 `command-palette.spec.ts` 回归；增补 plan 可见性 / model 子页（可用 e2e hooks） |
| 回归 | `yarn vitest run src/components/command-palette/ src/domain/commands/ src/components/chat/SlashCommandPalette*` |

---

## 14. 风险与取舍

| 风险 | 缓解 |
|------|------|
| skill replace→insert 改变习惯 | 文档 + toast；dogfood 收集反馈；必要时后续加设置 |
| Model 列表体量 | 复用 ModelPicker filter/cap；子页搜索本地过滤 |
| Catalog 合并 PR 过大 | 执行计划分 Phase；A 先镜像 builtin，nav 可暂手写 |
| 过度对标 TUI | 原则 §4.5：只吸收四件套 |

---

## 15. 验收总表（产品级）

1. code session：⌘K 可见 compact / plan / diff / init；chat session：**默认不可见** diff / init / plan。
2. composer 有未发送文本时，面板选 skill：**前文保留**。
3. Switch model… → 二级列表 → 选中后当前会话/draft 模型变更。
4. Esc 从 model / theme / sessions 回到 root；推荐恢复 root search。
5. `contextBoost` / `surfaces` 有单测证明生效。
6. Favorites、⌘1–9、`>` `#` `@` 回归通过。
7. `yarn vitest run src/components/command-palette/ src/domain/commands/` 全绿。

---

## 16. 修订记录

| Date | Change |
|------|--------|
| 2026-07-24 | 初稿：对照 grok-build 差距 + Spec（D1–D14 / G1–G7）；链接执行计划 |
