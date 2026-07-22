# Composer 会话 Token 计量 — Design Spec

| Field | Value |
| --- | --- |
| **Title** | Composer 发送键左侧：当前会话 Token 计量 |
| **Date** | 2026-07-22 |
| **Status** | Implemented (2026-07-22) |
| **Product** | hip — Tauri desktop AI workbench |
| **Surfaces** | `code` / `chat` 已有会话（`InputBar` 路径）；不含 `NewConversation` 草稿 |
| **Depends on** | 已有：`useTokenUsage` / `useActiveUsageTotal` / `tokenPercentage` / `usageCost` / i18n `chat.usage.*` / 消息级 usage |
| **Constraints** | 不改 shell IA；不改 `tokens.css` 品牌色；最小机制；外科手术改动 |

---

## 1. 问题陈述

用户需要在**已产生会话记录**的对话输入框内，于**发送键左侧**看到当前会话的 token 计量，以便：

1. 判断上下文是否逼近窗口上限（何时该压缩 / 新开会话）
2. 感知本会话累计消耗（输入 / 输出 / 总量，可选费用）
3. 与单条助手消息上的 per-turn usage 形成「全局 vs 本轮」互补

### 现状

| 层 | 状态 |
| --- | --- |
| 协议 | `TurnUsage { inputTokens, outputTokens, totalTokens }` 挂在 assistant `Message.usage` |
| 聚合 | `selectUsageTotal` / `useActiveUsageTotal` 对 active session 消息求和 |
| 窗口比 | `useTokenUsage` + `computePercentage` + `zoneForPercent`（&lt;50 success / &lt;80 warning / ≥80 danger） |
| 费用 | `usageCost.computeCost` / `formatUsd`（纯函数就绪，**UI 未接线**） |
| 消息级 UI | `MessageBubble` 展示 `N tokens` + tooltip `in · out` |
| 会话级 UI | **已移除**：原 `ChatTitleBar` 右侧 `session-usage` chip（布局重构删掉标题栏后未迁移） |
| 测试残留 | `TokenUsageChip.test.tsx` 仅测 zone→class 映射，注释写「chip in InputBar」但 **InputBar 未渲染** |
| 入口 | `AppLayout`：`activeSessionId == null` → `NewConversation`；否则 transcript + `InputBar` |

**缺口**：会话级计量数据层仍在，但没有挂在 composer 发送区。

---

## 2. 开源参考（本地 `code-repository/github`）

对照对象与 hip 的适配结论：

### 2.1 OpenCode — `SessionContextUsage`

- **位置**：会话标题行 / 侧栏工具区（非发送键旁）；圆形进度 + tooltip。
- **语义**：取**最后一条带 tokens 的 assistant** 的 token total / 模型 `limit.context` → 上下文占用 %。
- **披露**：tooltip 三行：cost / usage% / tokens；点击可开 context 明细 tab。
- **对 hip**：语义最值得学（**上下文占用 ≠ 会话累计**）。hip 暂无 context breakdown 面板 → v1 用 tooltip 即可，不引入新侧栏。

### 2.2 DeerFlow — `TokenUsageIndicator`

- **位置**：聊天页 **header 右上**（与 export/artifact 并列）。
- **语义**：thread 累计 input/output/total；预设 off/summary/per_turn/debug。
- **对 hip**：披露层级好（主显 + 下拉明细 + 偏好），但对 hip「发送键左侧」过重；**不要**把 header 偏好系统搬进 composer。消息级 per-turn 已由 `MessageBubble` 覆盖。

### 2.3 Codex TUI — footer / token_usage

- **位置**：composer 底部 footer 右侧 context indicator。
- **语义**：明确拆分 `total_token_usage`（会话累计）与 `last_token_usage`（当前上下文尺寸）；% 基于 **last**。
- **布局**：窄宽度时 **优先丢掉 context 指示**，保证主操作/hint 可读（progressive collapse）。
- **对 hip**：数据模型与窄宽降级策略直接可搬；hip 用 CSS truncate / `hidden sm:` 即可。

### 2.4 Pi agent — interactive footer

- **位置**：editor 下方 footer：cwd · session · tokens/cache · cost · **context usage** · model。
- **对 hip**：强化「计量属于会话工作面脚注，而非标题装饰」；hip 的 flat dock 已是等价位置。

### 2.5 OpenHands — `BudgetUsageText`

- **位置**：会话区旁，主显 **$ 预算**。
- **对 hip**：hip 是 BYOK / 本机密钥，无组织预算；费用仅作 tooltip 补充，不主显。

### 2.6 Orca — status-bar usage %

- **语义**：账号 / 订阅配额窗口，不是会话 context。
- **对 hip**：不适用；避免做成「账户用量」叙事。

### 参考取舍（一句话）

| 学 | 不学 |
| --- | --- |
| OpenCode / Codex：**last-turn 作 context %** | OpenCode 进度环作唯一主控件（hip 更偏 quiet text） |
| Codex：累计与 last 分离 | DeerFlow header 偏好预设系统 |
| Pi：放在输入工作区脚注 | Orca 账号配额 / OpenHands 预算主叙事 |
| 窄宽可折叠 | 新侧栏 / 新设置页 |

---

## 3. 目标与非目标

### Goals

1. 在 **已有会话** 的 `Composer` 工具行中，发送/停止按钮**左侧**展示当前会话 token 计量。
2. 主显可一眼判断 **上下文压力**（有 context window 时显示 % + zone 色）；无 window 时降级为累计 token 数。
3. Tooltip / title 给出 **可理解明细**（占用、累计 in/out、可选费用）。
4. 复用现有 hooks / i18n / 语义色；无 usage 时不占位（quiet by default）。
5. 单测覆盖展示逻辑与挂载条件；不引入新协议字段。

### Non-Goals（v1）

- Context breakdown 面板、缓存 token 分项、按 agent 拆分（可列 v2）。
- 账号配额 / 组织预算 / 速率限制 UI。
- 在 `NewConversation` 草稿态显示计量。
- 改 MessageBubble per-turn 展示。
- 改 sidecar 计费或持久化 schema。
- 用户可配置的「显示/隐藏计量」设置项（v1 固定策略；v2 可加）。

---

## 4. 语义模型（关键决策）

历史上 `ChatTitleBar` 用 **会话消息 usage 求和** 除以 context window 得到 %。  
多轮后累计 total 会 **远超** 窗口，导致 % 很快顶到 100%（danger），**不能代表真实上下文占用**。

业界（OpenCode / Codex）区分两套数：

| 指标 | 定义 | 用途 |
| --- | --- | --- |
| **Context fill（主显 %）** | 最近一条带 `usage` 的 assistant 消息的 `totalTokens`（或 `inputTokens`，见下） / 当前模型 `limit.context` | 上下文压力、zone 色 |
| **Session cumulative（明细）** | 全会话消息 `usage` 求和（已有 `selectUsageTotal`） | 本会话累计 in/out/total、费用 |

### 4.1 Context fill 分子选择

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| A. last `totalTokens` | OpenCode 风格；含本轮 output | **v1 采用**（与 catalog 对齐简单，协议已有） |
| B. last `inputTokens` | 更接近「进模型前上下文」 | 更准，但 provider 上报不一致时可能偏低；v1.1 可切换 |
| C. last `input + output` 手算 | 同 A 若 total 可信 | 仅当 total 缺失时 fallback |

**v1 决策：A**，fallback：若 `totalTokens` 缺失则用 `input + output`。

### 4.2 模型 key / context window

复用 `useTokenUsage` 现有逻辑：

- `active.config.model` 存在 → `` `${llmProvider}/${model}` ``
- 否则 `activeModelKey(config)`
- `catalog[provider].models[model].limit.context`

模型切换后 % 应对 **新** context window 重算（分子仍为 last usage）。

### 4.3 Zone 阈值

保持 `zoneForPercent`：

- `&lt; 50` → `success`（`text-success`）
- `50–79` → `warning`（`text-warning`）
- `≥ 80` → `danger`（`text-danger`）
- 无 percent → 默认 `text-ink-tertiary`（仅显示累计数）

---

## 5. 产品行为

### 5.1 显示条件

| 条件 | 行为 |
| --- | --- |
| `NewConversation`（无 session id） | **不显示** |
| 有 active session，但尚无任何 `message.usage` | **不显示**（首轮结束、usage 上报后再出现） |
| 有 usage，catalog 无 context | 显示累计 `toLocaleString()` 数字（无 %） |
| 有 usage + context | 主显 `{{percent}}%`；可选紧凑副标 `(used / window)` |
| `sessionActionBlocked`（审批 / 权限门闩） | InputBar 整块被替换为 status；计量随 composer 一起隐藏（可接受） |
| running + Stop 按钮 | 计量仍显示在 **Stop 左侧**（与 Send 同槽） |

### 5.2 主显文案（默认）

推荐 **紧凑主显**（对齐旧 title-bar，但分子改为 context fill）：

```
42% · 12.4k
```

或恢复旧格式（更宽）：

```
42% (12,400 / 128,000)
```

**v1 推荐：**

- 默认宽度：`{{percent}}%`（`text-caption` / `text-meta`）
- `title` / tooltip：完整 `percentageTooltip` + 累计 io + 可选 cost  
  例：`12,400 / 128,000 tokens (42%) · 本对话累计 3,200 in · 1,100 out · ~$0.0123`

无 percent 时主显：`12.4k` 或 `12,400`（见 §6.3 格式化）。

**不**在主显塞 cost 数字（避免与 token 混淆；费用进 tooltip）。

### 5.3 交互

| 行为 | v1 |
| --- | --- |
| 点击 | **无操作**（纯信息 chip，非 button） |
| Hover | 原生 `title` 或 Radix Tooltip（若项目已有统一 Tooltip 原语则用；否则 `title` 足够） |
| 键盘 | 不入 tab 序（`aria-hidden` 或 `tabIndex={-1}` 的 span）；信息由 `aria-label` 暴露给读屏 |

v2 可选：点击打开 session 用量 popover（in/out/total/cost 表），对齐 DeerFlow 轻量版。

### 5.4 与消息级 usage 的关系

| 层级 | 位置 | 内容 |
| --- | --- | --- |
| 会话 | Composer 发送键左 | Context % 或累计；tooltip 明细 |
| 轮次 | MessageBubble 脚注 | 本轮 total tokens + io tooltip |

二者并存，不合并。

---

## 6. UI 规格

### 6.1 布局（Composer 工具行）

当前结构（`Composer.tsx`）：

```
[ leftSlot: pickers… ]          [ Send | Stop ]
```

目标：

```
[ leftSlot: pickers… ]          [ TokenChip ] [ Send | Stop ]
```

- TokenChip 与发送键同一右簇：`flex items-center gap-1.5`（或 `gap-2`）
- 发送/停止按钮尺寸不变（`h-7 w-7 rounded-full`）
- TokenChip：`shrink-0`，`text-meta` 或 `text-caption`，`tabular-nums`，`select-none`
- zone 色只作用在数字/百分比文字上，**不要**大色块背景（quiet chrome）；可选极轻 `bg-surface-muted rounded-full px-1.5 py-0.5` 对齐旧 title-bar pill

### 6.2 宽度与降级（Codex 思路）

| 视口 / 可用宽 | 行为 |
| --- | --- |
| 正常 | `42%` 或 `42% (12.4k)` |
| 窄（composer 右簇拥挤） | 仅 `42%`；无 % 时仅 `12k` |
| 极窄 | 可 `hidden` 计量，保证 Send 可点（`max-sm:hidden` 或容器 query） |

leftSlot 已有多个 picker；计量不得把发送键挤出可见区。

### 6.3 数字格式

新增纯函数（建议 `src/lib/formatTokens.ts`，单测）：

| 值 | 显示 |
| --- | --- |
| &lt; 1_000 | `999` |
| &lt; 10_000 | `1.2k`（1 位小数，去尾 0） |
| ≥ 10_000 | `12k` / `128k`（整数 k） |
| ≥ 1_000_000 | `1.2M` |

Tooltip 内使用完整 `toLocaleString()`。

### 6.4 视觉方言

- 颜色：仅用已有 `text-success` / `text-warning` / `text-danger` / `text-ink-tertiary`
- 不新增 accent 强调；非 danger 时偏 muted
- 与 `MessageBubble` usage 同一信息层级（meta）
- 不引入 ProgressCircle（OpenCode 风格）作为 v1 必选项；若后续要环图，需单独视觉评审

### 6.5 文案 / i18n

已有 key（复用，必要时补）：

| Key | 用途 |
| --- | --- |
| `chat.usage.sessionTotal` | tooltip 前缀 |
| `chat.usage.io` | 累计 in/out |
| `chat.usage.tokens` | 总量句式 |
| `chat.usage.cost` | `~{{cost}}` |
| `chat.usage.percentage` | `{{percent}}%` |
| `chat.usage.percentageTooltip` | used / total (percent) |

建议新增（可选）：

| Key | 示例 |
| --- | --- |
| `chat.usage.contextFill` | `Context {{percent}}%` |
| `chat.usage.aria` | `Session token usage: {{percent}} percent, {{used}} of {{window}}` |

全语言：`en` / `zh-CN` / `zh-TW` / `ja` / `ko` 同步。

---

## 7. 数据与实现方案

### 7.1 推荐 API 形状

扩展（或并列）`useTokenUsage`，避免继续把「累计」误标为 context used：

```ts
type SessionTokenMeter = {
  /** Last assistant usage total (context fill numerator) */
  contextTokens: number | null
  contextWindow: number | undefined
  percent: number | null
  zone: 'success' | 'warning' | 'danger' | null
  /** Session sum — existing selectUsageTotal */
  cumulative: TurnUsage | null
  /** Optional USD from catalog cost × cumulative */
  costUsd: number | null
}
```

实现要点：

1. `cumulative`：现有 `selectUsageTotal` + `useShallow`（**禁止**去掉 shallow，防 infinite re-render）。
2. `contextTokens`：自 active messages **从尾向前**找第一条 `usage` 非空的 assistant（对齐 OpenCode `lastAssistantWithTokens`）。
3. `percent` / `zone`：对 `contextTokens` 而非 cumulative 调用 `computePercentage` / `zoneForPercent`。
4. `costUsd`：`computeCost(cumulative, catalogModel.cost)`；无 rate → null。

### 7.2 UI 组件

| 文件 | 职责 |
| --- | --- |
| `src/components/chat/TokenUsageChip.tsx` | 展示组件：读 `useTokenUsage`（扩展后），渲染 chip |
| `src/components/chat/Composer.tsx` | 右簇插入 chip（`rightMeta` slot 或直接 embed） |
| `src/components/chat/InputBar.tsx` | **不必**自己算 usage；若 slot 化则传入 `<TokenUsageChip />` |
| `src/lib/formatTokens.ts` | 紧凑数字格式 |
| `src/domain/hooks.ts` | 语义修正 + 可选 cost |
| tests | 见 §9 |

**挂载策略（二选一，推荐 A）：**

- **A.** `Composer` 内直接挂 `TokenUsageChip`（仅 `variant=flat` 的会话 dock 显示；`card` 的 NewConversation 路径不渲染）。  
  - 优点：发送键左侧布局收口在一处。  
  - 注意：`NewConversation` 也用 `Composer variant=card` → chip 内 `useTokenUsage()==null` 自然隐藏即可。
- **B.** `Composer` 增加 `trailingBeforeSend?: ReactNode`，由 `InputBar` 注入。  
  - 优点：Composer 更纯。  
  - 缺点：多一层 prop。

**推荐 A**：数据 hook 自判 null，Composer 无条件挂载，draft 自动空。

### 7.3 伪布局

```tsx
// Composer 工具行右侧
<div className="flex items-center gap-1.5">
  <TokenUsageChip />
  {running ? <StopButton /> : <SendButton />}
</div>
```

```tsx
// TokenUsageChip
const meter = useSessionTokenMeter() // or extended useTokenUsage
if (!meter?.cumulative && meter?.contextTokens == null) return null
// render span[data-testid=session-usage]
```

### 7.4 测试 id

- 恢复 `data-testid="session-usage"`（与历史 e2e / 注释一致）
- 可选 `data-zone={zone}` 便于断言色阶

---

## 8. 实现分期

### P0 — 可交付最小集（本 spec 必做）

1. 修正 context % 分子为 **last assistant usage**。
2. 新增 `TokenUsageChip`，挂到 Composer 发送/停止左侧。
3. 主显 % 或累计数 + zone 色；`title` 明细（累计 io）。
4. i18n 复用；缺 aria 则补。
5. 单测：format、meter 选择、chip 渲染条件、Composer 右簇结构。

### P1 — 增强（同 PR 可选 / 紧随）

1. Tooltip 展示 `computeCost` / `formatUsd`（catalog 有 cost 时）。
2. 紧凑 `formatTokens`（12.4k）用于主显副标。
3. 窄宽 `max-sm:hidden` 或仅显示 %。

### P2 — 后续

1. 点击 popover：累计表 + 当前模型 context 条。
2. Context fill 分子可配置（input-only vs total）。
3. Compaction 事件后的「窗口重置」提示（若 sidecar 发 compaction 信号）。
4. 缓存读写 tokens（若协议扩展）。

---

## 9. 验收标准

### 功能

- [ ] 打开已有会话且至少一轮带 usage → 发送键左侧出现 `session-usage`
- [ ] 新对话草稿（NewConversation）→ **不出现**
- [ ] 仅一轮 usage 时，% ≈ last.total / context（允许四舍五入）
- [ ] 多轮后 % **不**随「所有轮 total 相加」线性飙到 100%（除非 last 本身已满）
- [ ] 切换模型后，window 与 % 跟随新模型 catalog
- [ ] running 时 chip 在 Stop 左侧仍可见
- [ ] 无 usage 时 DOM 无占位空白块

### 质量

- [ ] `useShallow` 仍保护 usage total 选择器
- [ ] `yarn tsc` 绿；相关 vitest 绿
- [ ] 不改 `tokens.css` 品牌 hex；不改 sidebar 宽度
- [ ] 五语 i18n key 对齐（`translation-keys` 测试）

### 无障碍

- [ ] 有可读 `aria-label` 或等价
- [ ] 不抢发送按钮焦点

---

## 10. 测试计划

| 用例 | 类型 | 断言 |
| --- | --- | --- |
| `selectContextTokens` last assistant | unit | 取最后有 usage 的 assistant，忽略 user/无 usage |
| cumulative 仍为全量 sum | unit | 与现 `usageTotal.test` 一致 |
| percent 用 context 非 cumulative | unit | 两轮各 100k、window 128k → 约 78% 而非 clamp 100%（若 cumulative 会 200k） |
| `formatTokens` | unit | 边界表 |
| `TokenUsageChip` null / % / no-window | component | testid、class zone |
| `Composer` 结构 | component | session-usage 在 composer-send 前 |
| `InputBar` 有 session + usage | component | 可见 |
| zone class mapping | unit | 保留/迁入真实 chip 导出函数 |

---

## 11. 风险与缓解

| 风险 | 级别 | 缓解 |
| --- | --- | --- |
| Provider 不报 usage | 中 | 无 usage 隐藏；与消息级一致 |
| totalTokens 与 in+out 不一致 | 低 | total 优先，缺失时 in+out |
| 累计被误当作 context（旧行为） | 高 | spec 明确改 last；测试锁定 |
| leftSlot 过挤挤掉发送键 | 中 | chip shrink + 窄宽隐藏 |
| cost 币种/价目滞后 | 低 | tooltip 前缀 `~`；无 rate 不显示 |
| ACP 外部 agent 无 catalog window | 中 | 无 % 仅显示累计或 last 绝对数 |

---

## 12. 文件触点（预估）

| Path | Change |
| --- | --- |
| `src/domain/hooks.ts` | context fill + 可选 cost；导出 meter |
| `src/domain/index.ts` | 导出若有新 hook 名 |
| `src/components/chat/TokenUsageChip.tsx` | **新增** |
| `src/components/chat/TokenUsageChip.test.tsx` | 从 class 映射扩展为真组件测 |
| `src/components/chat/Composer.tsx` | 右簇挂 chip |
| `src/components/chat/Composer.test.tsx` | 结构断言（若有） |
| `src/lib/formatTokens.ts` (+ test) | 可选 P1 |
| `src/i18n/*.ts` | aria / 补文案 |
| `src/domain/usageTotal.test.ts` 或新 `sessionTokenMeter.test.ts` | context vs cumulative |

**预计 diff**：小（~150–250 LOC），无 sidecar / protocol 变更。

---

## 13. 决策记录（请确认）

| # | 决策 | 默认提案 | 备选 |
| --- | --- | --- | --- |
| D1 | 主显语义 | Context fill %（last usage） | 仅会话累计数字（旧 title-bar 但去掉误导 %） |
| D2 | 主显格式 | `42%` 紧凑 | `42% (12.4k / 128k)` 完整 |
| D3 | 挂载方式 | Composer 内嵌 chip | `trailingBeforeSend` slot |
| D4 | 费用 | P1 tooltip | v1 不做 |
| D5 | 点击 | v1 无 | v2 popover |
| D6 | 草稿态 | 永不显示 | — |

---

## 14. 建议落地顺序

1. **锁语义**：补 `selectContextTokens` + 测试（防止再引入 cumulative/% 混用）。
2. **TokenUsageChip** + Composer 右簇挂载。
3. **i18n / a11y**。
4. **（可选）** formatTokens + cost tooltip。
5. 自测：多轮会话、换模型、running/stop、NewConversation、无 catalog。

---

## 附录 A — 旧 UI 参考（已删 ChatTitleBar）

```tsx
{tokenUsage && (
  <span data-testid="session-usage" className={`… ${zoneClass}`}>
    {tokenUsage.percent !== null
      ? `${tokenUsage.percent}% (${used} / ${window})`
      : used.toLocaleString()}
  </span>
)}
```

迁移时：**位置**从 title-bar → composer 发送键左；**分子**从 cumulative → last context tokens。

## 附录 B — Composer 当前右簇

```185:217:src/components/chat/Composer.tsx
      <div className={cn('flex items-center justify-between pt-1.5', isCard && 'px-0.5')}>
        <div className={cn('flex items-center gap-0.5', locked && 'pointer-events-none opacity-50')}>
          {leftSlot}
        </div>
        {running && onStop ? (
          <div className="flex items-center gap-2">
            {reconnecting && <span className="text-meta text-ink-tertiary">{t('chat.reconnecting')}</span>}
            <Button … data-testid="composer-stop" … />
          </div>
        ) : (
          <Button … data-testid="composer-send" … />
        )}
      </div>
```

改动点：统一右侧为 `flex` 容器，先 chip 后 stop/send；reconnecting 文案保持在 stop 旁。
