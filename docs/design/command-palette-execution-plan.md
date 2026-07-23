# Global Command Palette — 执行计划

**Status:** implemented  
**Date:** 2026-07-24  
**Spec:** [command-palette-spec.md](./command-palette-spec.md)

本文把 Spec 拆成可串行交付的 Phase，每阶段有：目标缺陷、触碰文件、实现步骤、测试与完成定义（DoD）。  
默认 **一个 Phase ≈ 一个可独立合并的 PR**；C 可拆成 C1/C2 若 diff 过大。

---

## 0. 总览

```
Phase A  正确性 + catalog 统一 + plan 入面板     ──► G1, G5, 部分 G4
Phase B  Skill 草稿安全（insert）                 ──► G2
Phase C  Page 栈 + Model / Sessions 子页         ──► G3, 补齐 G4
Phase D  Recent IA + 快捷键文档 + `/` 前缀       ──► G6, G7, 部分 D11
Phase E  （可选）e2e 加固 + provider 挂载试点    ──► 回归 / D10
```

| Phase | 关闭缺陷 | Goals | 风险 |
|-------|----------|-------|------|
| A | D6, D7, D9, 部分 D1, 部分 D4 | G1, G5, G4† | 低 |
| B | D2 | G2 | 中（行为变更） |
| C | D3, D4 剩余, D13 | G3, G4 | 中 |
| D | D5, D8, 部分 D11 | G6, G7 | 低 |
| E | D10, e2e | 验收加固 | 低 |

† Phase A 交付 plan/plan-off；Switch model / Resume 在 C。

**依赖：** A → B → C → D；E 可与 D 并行（在 A–C 合并后）。

**验证命令（每 Phase 末）：**

```bash
yarn vitest run src/components/command-palette/ src/domain/commands/
# 触及 slash 时追加：
yarn vitest run src/components/chat/SlashCommandPalette* src/components/chat/useSlashCommandHandler*
```

---

## Phase A — 正确性 + 统一 catalog + plan

### 目标

- `when.surfaces` / `contextBoost` **真正生效**（D6, D7）。
- Builtin slash 驱动面板 context 行，去掉与 slash 重复的手写子集（D1 核心）。
- 补 `plan` / `plan-off`（D4 部分）。
- Surface 规则与 Spec §9.2 一致（D9）。

### 触碰文件（预期）

| 文件 | 变更 |
|------|------|
| `src/components/command-palette/types.ts` | 确认 `CommandWhen`；`GlobalCommand` 保留 `contextBoost` / `slashName?` |
| `src/components/command-palette/buildGlobalCommands.ts` | 抽出 `matchesWhen` 导出或单测可达；实现 surfaces；context 行从 catalog 投影；加 plan |
| `src/components/command-palette/rankGlobalCommands.ts` | 匹配后加 `contextBoost`（需把 boost 传入 rank，或 score 接收扩展字段） |
| `src/components/command-palette/catalog.ts` **新建（可选）** | `builtinSlashToPaletteItems(ctx)`：从 `SLASH_BUILTIN_COMMANDS` 生成面板项 |
| `src/domain/commands/slashBuiltins.ts` | 如需：补 keywords / paletteGroup 元数据（保持纯数据） |
| `src/domain/commands/index.ts` | 按需 re-export |
| `src/i18n/en.ts`, `zh-CN.ts`（+ 其他 locale 惯例） | `context.plan` / `context.planOff` |
| 对应 `*.test.ts` | surfaces、boost、plan 可见性、catalog 投影 |

### 实现步骤

1. **`matchesWhen` 补全 surfaces**  
   - 解析规则：`activeView === 'code' | 'chat'` 直接映射；history/settings/knowledge 等：用 `sessionId` 对应 session 的 `config.surface`，无 session 则 **不满足** `surfaces` 限制的命令。  
   - 单测覆盖：code view 显示 plan；chat view 隐藏 plan/diff/init。

2. **`contextBoost` 进 rank**  
   - 扩展 `RankableItem` 或 `rankGroups` 选项读取 item 上的 `contextBoost`。  
   - 仅 `base score > 0` 时加分；单测：同分 label 下带 boost 者更前。

3. **Catalog 投影**  
   - 从 `SLASH_BUILTIN_COMMANDS` 映射 id：  
     `diff→ctx-diff`, `compact→ctx-compact`, `init→ctx-init`, memory\*→现有 ctx-memory-\*,  
     `plan→ctx-plan`, `plan-off→ctx-plan-off`。  
   - `run` 绑定现有 domain handlers（与 `useSlashCommandHandler` 同路径语义，无参版本）。  
   - `when.surfaces` 来自 `availableIn`。  
   - **help / clear**：clear ≈ new conversation（可映射 `action-new-conversation` 或单独 ctx）；help 可选「打开 shortcuts」或 toast 列表——**A 期建议 help 不进 Suggested 空列表，仅搜索/slash 模式出现**，避免噪音。

4. **删除/收敛** `buildGlobalCommands` 中与 catalog 重复的手写 context 块（保留 need-session 提示行）。

5. **i18n** plan 文案。

### 测试 / DoD

- [ ] `matchesWhen` + surfaces 单测  
- [ ] `contextBoost` 排序单测  
- [ ] plan / plan-off 在 code 出现、chat 不出现  
- [ ] 现有 buildGlobalCommands / GlobalCommandPalette / registry 测试全绿  
- [ ] 不改变 skill replace 行为（留给 B）  
- [ ] README 一句：context 行来自 slashBuiltins  

### 非本 Phase

- skill insert、page 对象化、model picker、Recent 组、`/` 前缀  

---

## Phase B — Skill 草稿安全

### 目标

- 关闭 D2 / G2：面板选 skill **默认 insert，不 wipe 草稿**。

### 触碰文件

| 文件 | 变更 |
|------|------|
| `src/components/command-palette/registry.ts` | `runSkillHandoff`：`insertComposerText` / `insertComposerTextWhenReady` |
| `src/components/command-palette/README.md` | Skills handoff 段落改写 |
| `src/components/command-palette/registry.test.ts` | mock bridge：有草稿语义时走 insert |
| `src/components/command-palette/composerBridge.test.ts` | 若需覆盖 insert vs replace |
| i18n | `skills.needComposer` 措辞微调（「插入」而非暗示替换） |

### 实现步骤

1. `runSkillHandoff`：  
   - `insertComposerText(\`/${skillName} \`)` 成功 → return  
   - 否则 `selectSession` + `insertComposerTextWhenReady`  
   - 失败 → 现有 toast  
2. **不**默认调用 `replaceComposerText`。  
3. 更新 README「Skills handoff」三条路径。  
4. 单元测试：inserters 被调用、replace **不被**调用。

### 测试 / DoD

- [ ] registry 单测锁定 insert  
- [ ] 手动或 e2e（E 期）：composer 预填文本 → 面板 skill → 前文仍在  
- [ ] command-palette vitest 全绿  

### 风险

- 用户依赖「面板 skill 清空再输入」的极少；dogfood 观察。若需恢复 replace，加 `draftPolicy` 或设置项到后续。

---

## Phase C — Page 栈 + Model / Sessions 子页

### 目标

- D3, D13, G3；补齐 D4 的 Switch model / Resume session。

### 建议拆分

- **C1**：store page 类型 + Esc 栈 + theme 迁入（无行为变化）  
- **C2**：`model` / `sessions` 子页 + 入口命令  

若单 PR 可控可合并为 C。

### 触碰文件

| 文件 | 变更 |
|------|------|
| `src/store/commandPaletteStore.ts` | `page: PalettePage`；`openPage`；可选 `previousSearch` |
| `src/store/commandPaletteStore.test.ts` | 栈/关闭清理 |
| `src/components/command-palette/types.ts` 或 `pages.ts` | `PalettePage` 类型 |
| `src/components/command-palette/GlobalCommandPalette.tsx` | 按 page 渲染子列表；进入子页保存/恢复 search |
| `src/components/command-palette/buildGlobalCommands.ts` | `action-switch-model`、`action-resume-session`；theme 入口保持 |
| `src/components/command-palette/modelPage.ts` **新建** | 纯函数：从 providers/models 构建可选行（对齐 ModelPicker 过滤） |
| `src/components/chat/ModelPicker.logic.ts` 等 | **只读复用**逻辑，禁止复制定价/过滤算法 |
| i18n | switchModel / resumeSession / 子页 title |
| tests | store、model 页选择、Esc 从 model 回 root |

### 实现步骤

1. **Store**  
   - `type PalettePage = null | { id: 'theme' } | { id: 'model' } | { id: 'sessions' }`  
   - `close` / `setOpen(false)` 重置 page + 可选 previousSearch  
   - 兼容：旧测试 `openPage('theme')` → 适配为 `openPage({ id: 'theme' })` 或 overload  

2. **GlobalCommandPalette**  
   - `page?.id === 'theme'` → 现有 `buildThemePageGroups`  
   - `model` → model groups（搜索过滤）  
   - `sessions` → 与 long-tail sessions 同源 builder，允许空打开进入  
   - Esc：有 page → back（恢复 search）；无 page → 关  

3. **Model 选中**  
   - 有 `sessionId`：走现有 session 改 model API（与 ModelPicker 一致）  
   - 仅 draft：更新 `draftStore.modelKey`（对齐 NewConversation 行为）  
   - 成功后 `close()`  

4. **入口命令**  
   - `action-switch-model`：`to` 不适合字符串时用 `run: () => openPage({ id: 'model' })` 或扩展 `to` 为 page id  
   - `action-resume-session`：同理  

### 测试 / DoD

- [ ] store：open model → Esc → page null；close 清理  
- [ ] theme 回归（keepOpen、active check）  
- [ ] model 页至少能列出 fixture 模型并调用 set model（mock）  
- [ ] sessions 页选中触发 `selectSession`  
- [ ] e2e smoke 仍可通过 openCommandPaletteForE2e  

### 非本 Phase

- Arg 任意 slash 参数 picker、DocPicker 级 howto  

---

## Phase D — Recent + 快捷键文档 + `/` 前缀

### 目标

- D5, D8, G6, G7；D11 部分（`/` mode）。

### 触碰文件

| 文件 | 变更 |
|------|------|
| `src/components/command-palette/favorites.ts` 或 `recent.ts` **新建** | `buildRecentGroup(groups, usage, limit)` |
| `src/components/command-palette/GlobalCommandPalette.tsx` | 空打开插入 Recent（Favorites 下） |
| `src/components/command-palette/queryPrefix.ts` | `mode: 'slash'`；`/` 前缀解析 |
| `src/components/command-palette/registry.ts` / `filterGroupsByMode` | slash mode：builtin-slash + skills  
| `src/components/command-palette/keys.ts` | 扩展 keybind 表（与 `useGlobalHotkeys` 共用常量更好） |
| `src/components/command-palette/ShortcutsHelpDialog.tsx` | 渲染扩展表；可分组 |
| i18n | `groups.recent`、prefixSlash、shortcuts 新条目、placeholder |
| tests | recent 组装、parse `/`、help 条目数 |

### 实现步骤

1. **Recent**：Spec §9.3；空 needle + mode all + root page 时展示。  
2. **`/` 前缀**：`parsePaletteQuery` 识别 leading `/` → mode slash，needle 为去掉 `/` 后文本；列表项 label 可显示 `/{slashName}`。  
3. **Keybind 表**：至少覆盖 palette、slash、⌘1–9、前缀、favorite、Esc、**titlebar 相关若有**；ShortcutsHelp 只读该表。  
4. Placeholder 更新：`> # @ /`。

### 测试 / DoD

- [ ] Recent：usage 中的 id 出现；失效 id 跳过  
- [ ] `/comp` 命中 compact（slash mode）  
- [ ] Shortcuts 条目与 keys 表一致单测  
- [ ] vitest 全绿  

---

## Phase E — e2e 加固 + provider 试点（可选）

### 目标

- 验收自动化；D10 示范。

### 建议项

1. **e2e**（`e2e/specs/command-palette.spec.ts` 或新文件）：  
   - 打开面板 → 搜 plan（code surface 前置）  
   - 或 e2e hook 设置 surface 后断言 `global-cmd-ctx-plan`  
   - skill insert 不丢草稿（若 e2e 可写 composer）  
2. **Provider 试点**：terminals / knowledge 若仍散落在 `GlobalCommandPalette` ctx，可迁一个小 provider 注册，证明 `registerCommandProvider` 生产路径。  
3. 更新 `src/components/command-palette/README.md` 架构表 + 链到 design docs。

### DoD

- [ ] e2e smoke 绿  
- [ ] README 链接 `docs/design/command-palette-spec.md`  

---

## 1. PR 顺序与合并策略

| 顺序 | PR 标题（建议） | 基于 |
|------|-----------------|------|
| 1 | `fix(palette): surfaces, contextBoost, slash catalog, plan` | `dev` |
| 2 | `fix(palette): skill handoff inserts without wiping draft` | PR1 |
| 3 | `feat(palette): page stack, model and sessions subpickers` | PR2 |
| 4 | `feat(palette): recent group, slash prefix mode, shortcuts table` | PR3 |
| 5 | `test(palette): e2e coverage and provider smoke` | PR4 |

Stack 时用同一主题分支前缀：`palette/`。

每 PR：

- 只含本 Phase 文件  
- 更新相关单测  
- 描述里链 Spec 章节 + 关闭的 D/G id  

---

## 2. 文件责任矩阵（全期）

| 区域 | A | B | C | D | E |
|------|---|---|---|---|---|
| `buildGlobalCommands.ts` | ● | | ● | | |
| `rankGlobalCommands.ts` | ● | | | | |
| `catalog.ts`（新） | ● | | | | |
| `registry.ts` | ○ | ● | | ○ | ○ |
| `composerBridge.ts` | | ○ | | | |
| `commandPaletteStore.ts` | | | ● | | |
| `GlobalCommandPalette.tsx` | ○ | | ● | ● | |
| `queryPrefix.ts` | | | | ● | |
| `keys` / ShortcutsHelp | | | | ● | |
| `recent.ts` | | | | ● | |
| i18n | ● | ○ | ● | ● | |
| e2e | | | | | ● |
| README | ○ | ● | | | ● |

● 主改 ○ 小改/文案

---

## 3. 回滚策略

| Phase | 回滚 |
|-------|------|
| A | 恢复 surfaces 恒 true、去掉 boost、手写 context 块；plan 项可 feature-flag 删除 |
| B | `runSkillHandoff` 改回 replace 一行 |
| C | store page 退回 `string \| null`；隐藏 model/sessions 入口 |
| D | 去掉 Recent 与 `/` mode 分支 |

不引入长期 feature flag，除非 dogfood 要求 skill 策略开关。

---

## 4. 里程碑验收（对照 Spec §15）

| # | 标准 | 满足 Phase |
|---|------|------------|
| 1 | code 可见 plan/diff/init；chat 默认不可见 | A |
| 2 | skill 保留 composer 前文 | B |
| 3 | Switch model 二级选择生效 | C |
| 4 | Esc 子页回 root（search 恢复） | C |
| 5 | contextBoost / surfaces 单测 | A |
| 6 | Favorites / ⌘1–9 / 前缀回归 | A–D 不破坏 |
| 7 | vitest 目标路径全绿 | 每 Phase |

---

## 5. 开工检查清单（Phase A day-0）

1. 读 Spec §6–9 与本计划 Phase A。  
2. 跑一遍基线：  
   `yarn vitest run src/components/command-palette/ src/domain/commands/`  
3. 确认 `runPlanOn` / `runPlanOff` API（`planActions.ts`）与 session/draft 行为。  
4. 列出当前 context 项 id，与 `SLASH_BUILTIN_COMMANDS` 做对照表（实现前写在 PR 描述）。  
5. 开始 `matchesWhen` + 测试（最小可合并切片也可先于 catalog 投影单独提交，但仍算 Phase A）。

---

## 6. 修订记录

| Date | Change |
|------|--------|
| 2026-07-24 | 初稿：Phase A–E、PR 序、文件矩阵、DoD |
| 2026-07-24 | Phases A–E 实现完成；单测 + tsc 通过 |
