# 全局命令面板可靠性 Spec（缺陷修复）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-11 |
| 状态 | **Draft — 待评审** |
| 范围 | ⌘K `GlobalCommandPalette` + 共享 `domain/commands` 路径；slash 与 palette 对齐处一并修 |
| 前置 | P0–P2 命令面板能力已合入；`/compact` 完整修复已合入（`ee0ae8a`） |
| 现状代码 | `src/components/command-palette/*`、`src/domain/commands/*`、`src/routes/AppLayout.tsx`、`src/components/chat/InputBar.tsx` |
| 关联 | [`2026-07-11-command-palette-improvements-spec.md`](./2026-07-11-command-palette-improvements-spec.md)（能力建设）；本 spec 专治**功能错误 / 静默失败 / 反馈缺失** |
| 对照 | hermes / Zed / VS Code：命令执行有结果反馈；快捷键编号与可见列表一致；技能 handoff 失败时明示 |

---

## 1. Overview

### 1.1 问题

能力面（导航、设置深链、收藏、前缀、skills）已上线，但审计发现多处**行为与用户预期不一致**：

1. **⌘1–⌘9 序号错位** — UI 只给非嵌套项编号，键盘按含 `to` 的全量列表取下标，会执行错误命令。
2. **Skills 静默变轨** — 无 composer（New Conversation / History / Settings）时插入失败，fallback 打开 Skills 设置，看起来像“点了技能却进了设置”。
3. **Init 静默** — `git init` 无 toast、不导航；失败（`no_workspace` 等）仅写 diffStore，用户不可见。
4. **禁用技能仍可选用** — palette / slash 未过滤 `enabled === false`。
5. **Context 会话作用域过窄** — History / Settings 下 `sessionId` 恒 null，相关命令整组消失。
6. **Memory 开关无反馈** — 后端路径可用，无确认 toast；Incognito 只能开不能关。
7. **Memory-on 语义不完整** — 只开 `useMemories`，不碰 `generateMemories`，易误解。
8. **Diff 二次请求静默丢弃** — 已 loading 时直接 return。
9. **快捷键帮助不完整** — 只列 ⌘K 与 `/`，漏 ⌘1–9、前缀、收藏。

### 1.2 目标

| ID | 目标 |
|----|------|
| R1 | **快捷键诚实** — 可见 `⌘n` 与实际触发项 1:1 |
| R2 | **Handoff 诚实** — Skills 失败时明示，不静默改道 |
| R3 | **副作用可感知** — Init / Diff / Memory 有成功、失败或进行中反馈 |
| R4 | **列表诚实** — 禁用 skill 不出现在可执行列表（或明确标 disabled 且不可 run） |
| R5 | **Context 可用** — 在 History/Settings 仍能对“最近活动会话”做 compact/diff/memory 等 |
| R6 | **帮助完整** — Shortcuts 对话框覆盖 palette 实际能力 |
| R7 | **与 slash 一致** — 同一 domain handler；反馈策略两边对齐 |

### 1.3 非目标

| ID | 非目标 |
|----|--------|
| NG1 | 新增大类命令（插件市场、字段级设置搜索等） |
| NG2 | 重写 cmdk / 换 palette 库 |
| NG3 | 用户自定义快捷键编辑器 |
| NG4 | Compact 再改（已单独修；仅确保本批不回归） |
| NG5 | 云同步收藏 / usage |

### 1.4 原则

1. **Fail loud, succeed visible** — 失败 toast/status；成功至少 toast 或导航到可验证 UI。
2. **Index what you show** — 快捷键下标算法与渲染 `hotkeyIndex` 同源。
3. **No silent redirects** — fallback 必须让用户知道“发生了什么 / 为什么”。
4. **Simplicity** — 最小 diff；优先 domain 层统一，避免 palette 与 slash 分叉。
5. **Surgical** — 不顺手重构 rank / favorites 存储格式。

---

## 2. 缺陷清单与验收

### 2.1 P0 — 必须修（错误命令 / 静默错误路径）

#### P0-1 · ⌘1–⌘9 与可见序号对齐

| | |
|--|--|
| **现状** | `flattenVisibleItems` 含 `item.to`；渲染时 `hotkeyCounter` 跳过 `to`，导致错位 |
| **目标** | 可执行快捷键序列 = 可见带 `⌘n` 的行序列。嵌套入口（`to`）不参与 1–9，也不被 1–9 命中 |
| **算法** | `runnableHotkeyItems(groups) = flatten(groups).filter(i => !i.to)`；渲染与 `keydown` 共用 |
| **验收** | 列表含「更换主题…」时，第一行非 to 显示 `⌘1`，按 ⌘1 执行该行；to 行无数字角标 |

#### P0-2 · Skills handoff 失败明示

| | |
|--|--|
| **现状** | `insertComposerText` 失败 → `goSettingsPage('skill')`，无提示 |
| **目标** | 有 inserter：插入 `/{name} ` 并关闭 palette（保持现状）。无 inserter：toast 说明原因；**默认不**打开设置（避免误认执行成功）。可选次要动作「打开 Skills 设置」仅出现在 toast action（若 sonner 支持）或文案指引 |
| **何时无 inserter** | History / Settings / New Conversation（无 active session）等 `InputBar` 未挂载 |
| **可选增强** | 若 `chatSessionId \|\| codeSessionId` 存在，可先 `selectSession` 切回会话再插入（见 §3.2）；若无会话，仅 toast |
| **验收** | 在 History 打开 palette，选 skill → 出现失败/引导 toast，**不**自动进入 Settings；在活跃 chat 会话 → 输入框出现 `/name ` |

#### P0-3 · Initialize project 可感知

| | |
|--|--|
| **现状** | 只发 `fs:gitInit`；成功/失败无 toast；不切换 Changes |
| **目标** | 与 diff 对齐体验：发起时可选导航到 code + Changes；结果 toast |
| **成功** | toast success；已有链路 `requestDiff` + checkpoints 保留 |
| **失败** | toast error，文案含 `error`（如 `no_workspace` → 可读文案「当前会话没有工作区目录」） |
| **导航** | palette / slash 的 `runInit`：`setActiveView('code')` + `setTab('changes')`（与 `runDiff` 一致） |
| **验收** | 无 cwd 会话执行 init → 错误 toast；有 cwd 成功 → 成功 toast + Changes 可见 |

#### P0-4 · 禁用 Skills 不可执行

| | |
|--|--|
| **现状** | palette / slash 使用完整 `skills[]`，忽略 `enabled` |
| **目标** | 仅列出 `enabled[id] !== false`（默认 true 若 map 无键，与设置页语义一致则统一） |
| **数据** | `useSkillsStore`：`skills` + `enabled`；palette ctx 需同时传两者，或 provider 内读 store |
| **验收** | 关闭某 skill 后，`@` / 搜索 / slash 均不再出现该项 |

---

### 2.2 P1 — 应修（上下文与反馈缺口）

#### P1-1 · Context session 在 History / Settings 仍可用

| | |
|--|--|
| **现状** | `sessionId = activeView === 'code' ? codeSessionId : activeView === 'chat' ? chatSessionId : null` |
| **目标** | 解析顺序： |
| | 1. 当前 view 为 chat/code → 对应 surface id |
| | 2. 否则 `chatSessionId ?? codeSessionId`（最近记住的活动会话） |
| | 3. 皆无 → null（隐藏 requiresSession 命令） |
| **when.views** | context 命令：`diff`/`init` 仍限 `code` **或** 在非 code 执行时由 handler 切到 code（与现 runDiff 一致）。compact/memory 允许任意 view，只要有 sessionId |
| **验收** | 在 Settings 打开 ⌘K，若仍有 chat/code session 记忆，可见 Compact / Memory status 等 |

#### P1-2 · Memory 开关反馈 + Exit incognito

| | |
|--|--|
| **现状** | on/off/incognito 无 toast；无 exit |
| **目标** | 每次 set flags 后 toast 短确认（i18n）。新增 `memory-incognito-off` / palette `ctx-memory-incognito-off`（或 toggle 文案随状态变化） |
| **状态感知（推荐）** | 空查询下列出与**当前状态相反**的动作：已 on 则显示 Off；已 incognito 则显示 Exit；避免同时堆四个无差别项 |
| **验收** | 开/关 memory 有 toast；incognito 后可再选 Exit 恢复 |

#### P1-3 · Memory-on 与 generate 语义

| | |
|--|--|
| **现状** | `setUseMemories(true)` 只改 use |
| **目标（产品锁定）** | **A（推荐）**：`memory-on` 仅保证 inject（use=true），文案写清「启用记忆注入」；另增 `memory-generate-on/off` 或在 status 中暴露 generate。 **B**：`memory-on` 同时 `use=true, generate=true`（一键全开） |
| **本 spec 默认** | **方案 A** + status 已含 generate；可选 P1 增加 generate on/off 两条命令 |
| **验收** | 文案与行为一致；status 可验证 |

#### P1-4 · Diff 已在 loading 的反馈

| | |
|--|--|
| **现状** | `requestDiff` loading 时 return |
| **目标** | 去重保留；若被跳过则 toast.info「变更正在加载…」或仍导航到 Changes（runDiff 已导航则足够：确保 `runDiff` 总是切 tab，即使 dedupe） |
| **验收** | loading 中再触发 diff → 仍打开 Changes；可选 toast 一次 |

#### P1-5 · Shortcuts 帮助补全

| | |
|--|--|
| **现状** | 仅 palette + slash |
| **目标** | 增加：⌘1–⌘9、前缀 `>` `#` `@`、收藏星标（简述）、Esc 回退子页 |
| **验收** | 帮助 Dialog 条目 ≥ 6；i18n 三语齐 |

---

### 2.3 P2 — 增强（体验 polish）

#### P2-1 · Skills 增强 handoff（可选实现 P0-2 增强）

有 remembered session 时：`selectSession` → 等 InputBar 注册 inserter（短时 retry / microtask 队列）→ 插入。无 session 仍 toast。

#### P2-2 · Diff / Init 结果更丰富

成功 init 可带「已初始化仓库」；diff 空变更 toast「工作区无变更」（需读 result state，可选）。

#### P2-3 · Context 组空态说明

无 session 时，context 组不隐藏而显示一条 disabled 提示「先打开或选择会话」（可选；避免空组困惑）。

#### P2-4 · 测试与文档

README / e2e 覆盖 P0 场景；unit 锁 hotkey 列表算法。

---

## 3. 设计细节

### 3.1 快捷键列表（伪代码）

```ts
/** Items that may receive ⌘1–9 and are executable via that path. */
export function flattenHotkeyItems(groups: PaletteGroup[]): GlobalCommand[] {
  const out: GlobalCommand[] = []
  for (const g of groups) {
    for (const item of g.items) {
      if (item.to) continue
      out.push(item)
    }
  }
  return out
}

// Render: hotkeyIndex = index in flattenHotkeyItems (1-based, cap 9)
// Keydown: item = flattenHotkeyItems(visible)[n - 1]
```

`handleSelect` 对 `to` 仍走子页，不受 1–9 影响。

### 3.2 Skills handoff 状态机

```
select skill
  → insertComposerText(text)?
       yes → close palette; done
       no  → has remembered session?
              yes (P2-1) → selectSession; queueInsert(text); close
              no  → toast(i18n skills.needComposer); close (no settings)
```

**禁止**默认 `goSettingsPage('skill')` 作为唯一失败路径（可从 toast 文案指引用户去设置安装技能）。

### 3.3 Init / Diff 反馈

| 动作 | 导航 | 进行中 | 成功 | 失败 |
|------|------|--------|------|------|
| diff | code + changes | 已有 loading store | 面板展示文件列表 | 面板 error / 可选 toast |
| init | code + changes | `initPending` | toast + 刷新 diff | toast error |

在 `serverMessageEffects` 的 `fs:gitInit:result` 增加 toast（domain 层统一，slash 与 palette 同享）。

### 3.4 Session 解析

```ts
export function resolvePaletteSessionId(
  activeView: ActiveView,
  chatSessionId: string | null,
  codeSessionId: string | null,
): string | null {
  if (activeView === 'chat') return chatSessionId
  if (activeView === 'code') return codeSessionId
  return chatSessionId ?? codeSessionId
}
```

### 3.5 Memory 命令面（方案 A）

| id | 行为 | when |
|----|------|------|
| ctx-memory-on | useMemories=true + toast | session && !already on（或始终可点） |
| ctx-memory-off | useMemories=false + toast | session |
| ctx-memory-incognito | incognito=true + toast | session |
| ctx-memory-incognito-off | **新增** incognito=false + toast | session |
| ctx-memory-status | toast flags | session |
| （可选）ctx-memory-generate-on/off | generateMemories | session |

Slash 同步：`memory-incognito-off` 进 `slashBuiltins`。

### 3.6 i18n 键（建议）

```
commandPalette.hotkeys.*          // 帮助条目
commandPalette.skills.needComposer
commandPalette.skills.openedSettings  // 若保留可选 action
chat.compact.*                    // 已有
chat.init.success | .failed | .noWorkspace
chat.diff.loading
chat.memory.enabled | .disabled | .incognitoOn | .incognitoOff
```

三语：`en` / `zh-CN` / `zh-TW`。

### 3.7 与 slash 对齐

| 能力 | slash | palette |
|------|-------|---------|
| init 导航 + toast | 同 `runInit` | 同 |
| skills 过滤 enabled | `buildCommandList` | `skillsCommandProvider` |
| memory-incognito-off | 新 builtin | 新 context cmd |
| compact | 已对齐 | 已对齐 |

---

## 4. 测试计划

### 4.1 Unit

| 区域 | 用例 |
|------|------|
| `flattenHotkeyItems` | 含 `to` 时序号与过滤一致 |
| `resolvePaletteSessionId` | chat/code/history/settings 四种 |
| skills provider | enabled false 排除；无 inserter 不调 goSettings（mock） |
| runInit | 调用 gitInit + setView/setTab |
| memory toast | 可选 spy sonner |
| gitInit result effect | ok/fail toast |

### 4.2 Component

| | |
|--|--|
| GlobalCommandPalette | 渲染 ⌘1 与 keydown 同一 item（mock） |
| Skills 选择无 bridge | toast 被调用 |

### 4.3 E2E（可选抽 1–2）

- 活跃会话下 skill 插入 composer  
- init 无 cwd 出现错误反馈（若 e2e 可构造）

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| History 下 session 操作改错会话 | 优先 surface 记忆 id；toast 可带 session 标题短前缀（可选） |
| selectSession 后 inserter 未就绪 | P2-1 短队列；P0 仅 toast 更稳 |
| toast 过多打扰 | memory/init 用短 message；diff loading 最多 1 次/触发 |
| enabled 默认值不一致 | 与 SkillConfig：缺省 true |

---

## 6. 优先级汇总

| 优先级 | ID | 一句话 |
|--------|-----|--------|
| P0 | P0-1 | ⌘1–9 与列表对齐 |
| P0 | P0-2 | Skills 失败明示，禁止静默进设置 |
| P0 | P0-3 | Init 导航 + 结果 toast |
| P0 | P0-4 | 过滤 disabled skills |
| P1 | P1-1 | History/Settings 解析 session |
| P1 | P1-2 | Memory toast + exit incognito |
| P1 | P1-3 | Memory-on 文案/语义（方案 A） |
| P1 | P1-4 | Diff loading 仍导航 / 轻提示 |
| P1 | P1-5 | Shortcuts 帮助补全 |
| P2 | P2-1–4 | 增强 handoff、空态、结果文案、测文档 |

---

## 7. 开放问题（可默认执行）

| # | 问题 | 默认 |
|---|------|------|
| Q1 | Skills 无 composer 是否提供「打开设置」toast action？ | 文案指引即可，不强制 action API |
| Q2 | Memory-on 是否连带 generate？ | 否（方案 A） |
| Q3 | History 下 context 用 chat 优先还是最近 updated？ | `chatSessionId ?? codeSessionId` 简单记忆序 |
| Q4 | Init 是否必须切 Changes？ | 是，对齐 diff |

---

## 8. 成功标准（整包）

1. 无已知「点 A 执行 B」类快捷键错位。  
2. 无 Skills / Init 静默失败路径。  
3. Disabled skill 不可从 palette/slash 执行。  
4. History/Settings 下仍可对记忆中的会话做 memory/compact（有 session 时）。  
5. 相关单测绿；不回归 compact 与 P0–P2 能力面。  

实现计划见：[`../plans/2026-07-11-command-palette-reliability.md`](../plans/2026-07-11-command-palette-reliability.md)。
