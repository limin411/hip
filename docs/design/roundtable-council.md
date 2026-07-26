# Design Spec: Roundtable Council（多智能体议会）

| Field | Value |
|-------|--------|
| **Title** | Roundtable Council — Multi-Agent Debate, Rebuttal, Vote + Agents Panel |
| **Date** | 2026-07-26 |
| **Status** | Implemented (P3a–P3b core) — multi-agent projection + edges + Agents roster; vote P3c deferred |
| **Audience** | hip core (sidecar session / protocol / React UI / Agents panel) |
| **Depends on** | [`roundtable-mode.md`](./roundtable-mode.md)（空态入口）· [`roundtable-loop.md`](./roundtable-loop.md)（Chair 状态机、route/plan/stage/decide） |
| **Reference UI** | 右侧 Agents：`AgentDashboard` · `CollaborationStructure` · `AgentCard` · `SubAgentCard` |

---

## 1. Overview

在已实现的 **Chair-loop**（`ROUNDTABLE_ENGINE=loop`）之上，升级为 **Council 引擎**（`ROUNDTABLE_ENGINE=council`）：

| 维度 | loop（已实现） | council（本 spec） |
|------|----------------|-------------------|
| 顾问 | 同模型假角色，无独立 `agentId` | **每个角色 = 可观测子 agent** |
| 交互 | 自然语言「对话体」 | **结构化 SpeechAct**：开题 / 附议 / 反驳 / 修正 / 提问 |
| 决策输入 | Minutes + stage | Minutes + 边 + **可选记名投票** |
| 决策权 | hip 拍板 | **hip 仍为唯一最终决策者**（票不可绑死 hip） |
| 主 transcript | 折叠 markdown 纪要 | 精简纪要（结论优先） |
| 右侧 Agents | 基本只有 supervisor | **花名册 + 实时发言 + 交锋边 + 票** |

```
User issue (roundtable marker)
        │
        ▼
┌────────────────────────────┐
│  RoundtableCouncilRunner   │  extends loop state machine
└─────────────┬──────────────┘
              │
   hip (supervisor) ── route / plan / open_round / stage / vote? / decide
              │
              ├─ roundtable:strategist  ── agentRuns + agent:started/finished
              ├─ roundtable:skeptic
              ├─ roundtable:creative
              ├─ roundtable:operator
              └─ roundtable:audience
                    │
                    └─ SpeechAct JSON + prose
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   Main transcript                 Right Agents panel
   (plan / stage / decide)         (roster, edges, votes, full speech)
```

**产品一句话：**  
主栏看「会怎么定」；右侧 Agents 看「谁在争什么、票怎么投」。

---

## 2. Goals & Non-Goals

### Goals（P3）

1. **真多智能体**：每位顾问发言对应独立 `agentId`、`agent:started` / `agent:finished`、`AgentRun`（`role: 'subagent'`, `parentAgentId: 'supervisor'`, `name` 为人名）。
2. **结构化讨论**：发言携带 `SpeechAct`；反驳必须 `target` 点名。
3. **可选投票**：顾问记名投票；hip 读票后 `decide`（可否决多数）。
4. **右侧 Agents 满血**：开会即花名册占位；running 态实时；点开看全文与边。
5. **主栏干净**：不重复堆五人全文；默认折叠过程，突出 stage + decide。
6. **简单题降级**：`route.convene=false` → 0 顾问 agent、不打开花名册噪音。
7. **引擎可切换**：`sim` / `loop` / `council`；默认在 dogfood 后 bake-in `council` 或保留 `loop`。
8. **护栏**：继承 loop 的 N∈[2,4]、maxAdvisorCalls、wall-clock、cancel。

### Non-Goals（P3）

- 外部 ACP agent 扮演顾问（仅 builtin 模型路径）。
- 顾问默认带写工具 / 并行改仓库（Chat 圆桌默认 `tools: []`）。
- 纯民主多数决替代 hip。
- 无限轮、无限顾问席。
- 重做 AgentDashboard 信息架构（只扩展数据与轻量 UI 块）。
- Code surface 圆桌（可后续；本 spec 锁定 Chat）。

---

## 3. Relationship to prior specs

| Spec | 职责 |
|------|------|
| [`roundtable-mode.md`](./roundtable-mode.md) | 空态 chip、one-shot、marker、FE strip/badge |
| [`roundtable-loop.md`](./roundtable-loop.md) | ChairAction、route/plan/stage/decide、Minutes、render |
| **本 spec** | 顾问 → 真 agent；SpeechAct；vote；Agents 面板契约 |

**兼容：**

- 入口与 wire marker **不变**（`<!--hip.roundtable.v1-->`）。
- `Message.roundtable` meta 扩展字段（见 §9）。
- `HIP_ROUNDTABLE_ENGINE=sim|loop|council`（默认建议：先 `loop`，council 成熟后改 `council` 或按 flag）。

---

## 4. Product semantics (locked)

### 4.1 权责

| 角色 | 权责 |
|------|------|
| **用户** | 空态开启圆桌 = 邀请议会；不强制开会 |
| **hip（supervisor）** | 路由、议程、点名、阶段结论、early exit、**最终决策**；可发起 vote |
| **五顾问** | 意见权 + 投票权；无终局拍板权 |
| **系统** | 编排、投影 agentRuns、护栏；不做语义裁决 |

### 4.2 顾问花名册（固定 5 席）

| agentId | name（i18n） | 职责 |
|---------|--------------|------|
| `roundtable:strategist` | 战略家 / Strategist | 长期目标与方向 |
| `roundtable:skeptic` | 怀疑论者 / Skeptic | 风险、薄弱假设、盲点 |
| `roundtable:creative` | 创意者 / Creative | 新颖想法与更好角度 |
| `roundtable:operator` | 执行者 / Operator | 实际步骤与实施 |
| `roundtable:audience` | 受众倡导者 / Audience | 用户/客户/观众需求 |

常量：

```ts
export const COUNCIL_AGENT_PREFIX = 'roundtable:'
export const COUNCIL_PERSONAS = [
  'strategist', 'skeptic', 'creative', 'operator', 'audience',
] as const
// agentId = `roundtable:${persona}`
```

### 4.3 hip 与投票

> **投票是顾问意见聚合，不是立法。**  
> hip 的 `decide` 可采纳多数、可折中、可否决并说明理由。UI 必须显示「hip 决策」而非「议会通过」。

---

## 5. State machine (extends loop)

### 5.1 Phases

在 loop 相位上增加 `vote`（可选）：

```
routing
  ├─ convene=false → normal_reply → done
  └─ convene=true  → planning
planning → round_open
round_open → advisor_speaking  (1..k council agents)
advisor_speaking* → stage_conclude
stage_conclude
  ├─ earlyExit | last round
  │     ├─ (optional) vote → deciding
  │     └─ deciding
  └─ next round_open
vote (optional) → deciding
deciding → done
* + cancel → aborted
```

**何时进入 vote（P3c，可配置）：**

| 策略 | 条件 |
|------|------|
| `never` | 默认 P3a/b：无投票阶段 |
| `on_close` | 最后一轮 stage 后、decide 前 |
| `on_chair` | chair 在 stage 中设 `requestVote: true` |
| `on_split` | stage.open 非空且 `roundsRan >= 2` |

P3a 实现 **不跑 vote 相位**，schema 预留。

### 5.2 Invariants（继承 + 新增）

1. 未 `plan` 不得 `advisor_speaking`。  
2. 每个 round 结束必须 `stage`（除非 aborted）。  
3. 顾问 agent 不得发出 `decide`。  
4. `agentId` 必须匹配 `roundtable:<persona>`。  
5. `rebut` / `support` / `question` 的 `target` 必须是本会其他顾问（或 `claimId`）。  
6. Vote 全员完成后才 `decide`（若进入 vote 相位）；超时则 hip 用部分票 + Minutes。  
7. Cancel 中止所有 in-flight 顾问 completion，已完成 run 保留。

---

## 6. Structured I/O

### 6.1 ChairAction extensions

在 loop 的 ChairAction 上增加：

```ts
// open_round — 扩展
{
  type: 'open_round'
  round: number
  focus: string
  speakers: PersonaId[]
  mode?: 'serial_react' | 'parallel_then_synth' | 'debate_pair' | 'rebuttal_pass'
  /** debate_pair only */
  pair?: [PersonaId, PersonaId]
  microTurns?: number  // default 2, max 3
}

// stage — 扩展
{
  type: 'stage'
  // ...existing agreed/open/nextFocus/earlyExit
  requestVote?: boolean
  /** claim ids still contested (for vote ballot) */
  ballotOptions?: Array<{ id: string; label: string }>
}

// 新增
{
  type: 'open_vote'
  question: string
  options: Array<{ id: string; label: string }>
  /** Who must vote; default all who spoke this meeting */
  voters?: PersonaId[]
}
```

### 6.2 Advisor output: SpeechEnvelope

顾问 completion **必须**输出（JSON 优先，失败则 prose-only fallback）：

```ts
type SpeechActKind =
  | 'open'      // 提出/重申本轮主张
  | 'support'   // 附议
  | 'rebut'     // 反驳
  | 'revise'    // 修正自己先前立场
  | 'question'  // 向他人提问
  | 'vote'      // 仅 vote 相位

interface SpeechAct {
  kind: SpeechActKind
  /** Short claim in the speaker's voice */
  claim: string
  /** Required for support | rebut | question */
  target?: PersonaId
  /** Optional stable id for graph edges */
  claimId?: string
  /** rebut: what is wrong with target's claim */
  attack?: string
  /** revise: previous claim summary */
  priorClaim?: string
  /** vote phase */
  optionId?: string
  strength?: 1 | 2 | 3
  reason?: string
}

interface SpeechEnvelope {
  acts: SpeechAct[]   // 1–3 acts per speech
  prose: string       // 2–5 sentences user-facing
}
```

**校验：**

| 规则 | 处理 |
|------|------|
| `rebut` 无 target | 重试 1 次；仍失败 → 降级为 `open` |
| `rebuttal_pass` 模式且无 rebut/question | 重试；仍失败 → 接受但 stage 记「weak engagement」 |
| 非 JSON | 整段作 `prose`，`acts: [{ kind:'open', claim: first sentence }]` |

### 6.3 CouncilEvent（内部 + 可选 wire）

```ts
type CouncilEvent =
  | RoundtableEvent  // 既有 plan/speech/stage/decide…
  | {
      kind: 'roundtable.agent_speech'
      round: number
      speaker: PersonaId
      agentId: string
      envelope: SpeechEnvelope
      mode: OpenRoundMode
    }
  | {
      kind: 'roundtable.edge'
      round: number
      from: PersonaId
      to: PersonaId
      relation: 'support' | 'rebut' | 'question'
      summary: string
    }
  | {
      kind: 'roundtable.vote_cast'
      voter: PersonaId
      optionId: string
      strength: 1 | 2 | 3
      reason: string
    }
  | {
      kind: 'roundtable.vote_tally'
      question: string
      tallies: Array<{ optionId: string; label: string; score: number; voters: PersonaId[] }>
    }
```

主栏 render：speech 可用短摘要；**完整 prose 在 AgentRun.output**。  
边可在主栏 stage 前列「交锋要点」3 条以内。

---

## 7. Multi-agent runtime

### 7.1 Agent identity

```ts
function councilAgentId(p: PersonaId): string {
  return `roundtable:${p}`
}
```

| 字段 | 值 |
|------|-----|
| `agentId` | `roundtable:strategist` 等 |
| `role` | `'subagent'`（复用现网 nested chrome） |
| `parentAgentId` | `'supervisor'` |
| `name` | 本地化显示名（中/英…） |
| `taskInput` | 本轮 focus 或 vote question |
| `seq` | 本 turn 内单调（与既有 agentRuns 一致） |

**同 agent 多轮发言：**  
同一 `agentId` 在一个 turn 内可有 **多次 run** 或 **单 run 追加 output**。

| 策略 | 说明 | 推荐 |
|------|------|------|
| A. 每发言新 run | `agentId` 不变，`seq` 递增；panel 显示最新 + 历史折叠 | **P3a 推荐** 若 store 允许多 run 同 agentId |
| B. 单 run 累积 | 同一 run 追加 `---\n## Round k\n` | 实现简单，历史略糊 |
| C. agentId 带轮次 | `roundtable:strategist:r2` | 破坏花名册稳定 id，**不推荐** |

**锁定 P3a：策略 A** —— 每次发言一次 `AgentRun`（同 agentId 多条，按 seq）；UI 按 agentId 聚合显示「最新发言 + 历史条数」。

若现网 `agentRuns` 按 agentId 去重只留一条，则：

- 聚合：`output` 用最新；`taskInput` 用最新 focus；历史塞进 output 分段；或  
- 扩展 `AgentRun` 可选 `round?: number` + UI 读全部 runs 数组不过滤。

**实现检查点：** `groupByAgent` / `AgentDashboard` 对同 agentId 多 run 的行为；必要时改为 **按 agentId 合并，保留 runs[] 列表**。

### 7.2 Lifecycle per speech

```
ensureStarted(agentId)  // if first time this turn for this agentId — or always for strategy A new run
  send agent:started { agentId, role: subagent, parentAgentId: supervisor, name, taskInput }
  emit step_started / text_started as today for nested agents
complete(persona system + context)
  stream optional: token:stream with agentId (subagent path — no stepSeq claim)
ensureFinished(agentId, prose + optional acts footer)
  send agent:finished
  trajectory run.output = formatted speech
```

**与 loop 差异：** loop 只把 markdown 打进 supervisor textBursts；council **额外**写 nested runs。Supervisor 仍负责 plan/stage/decide 文本。

### 7.3 Context given to each advisor

| 层 | 内容 |
|----|------|
| Issue | strip 后用户原题 |
| Minutes | chair 滚动纪要 |
| Round focus | open_round.focus |
| Prior speeches (serial) | 本轮已发言 envelope 摘要 |
| Open claims | claimId 表（从 acts 累积） |
| Ballot (vote) | options + question |

**禁止**把完整五人全文无限追加；摘要表 ≤ 2k tokens（同 loop Minutes 策略）。

### 7.4 Modes

| mode | 调度 | 右侧观感 |
|------|------|----------|
| `serial_react` | 顺序；后者见前者 envelope | 卡片依次 running |
| `parallel_then_synth` | `Promise.all`；互不可见 | 多卡同时 running |
| `debate_pair` | pair 交替 microTurns | 两卡来回 |
| `rebuttal_pass` | serial，但校验必须含 rebut/question | 边密度高 |

P3a：**serial_react + parallel_then_synth**（已有 loop 逻辑，改为真 agent）。  
P3b：rebuttal_pass + edges。  
P3c：vote。  
P3d：debate_pair。

### 7.5 Tools

Chat council：**tools: []** 对所有顾问与 chair 会议步。  
P3.5 可选：`operator` 只读工具 allowlist（`read_file` 等）且仅 Code surface——**本 spec 不实现**。

---

## 8. Right panel (Agents) contract

### 8.1 Data → UI mapping

| UI 组件 | 数据 |
|---------|------|
| `AgentDashboard` 最新 turn | `groupByAgent` / `groupAllAgents` on final message |
| `CollaborationStructure` | supervisor + children（5 顾问） |
| `AgentCard` | name、status、taskInput、output、elapsed |
| Live strip | 当前 `status==='running'` 的顾问 |

### 8.2 Roster placeholder（开会即显示）

**问题：** 未发言的顾问没有 run，面板空白。  

**方案（P3a）：**

1. `plan` 成功后，chair 侧 **预注册** 5 个 placeholder runs：  
   - `output: ''`  
   - `finishedAt: null` 直到首次发言结束；或 `finishedAt: startedAt` + status 用「waiting」  
2. 或 FE：若 `message.roundtable.engine==='council' && convened`，用 **固定花名册** 合并 runs（无 run = waiting）。

**锁定：FE 花名册合并（更干净）** —— 不写假 run。

```ts
// FE pseudo
const ROSTER = COUNCIL_PERSONAS.map(p => ({
  agentId: `roundtable:${p}`,
  name: t(`chat.roundtable.personas.${p}`),
  role: 'subagent' as const,
  parentAgentId: 'supervisor',
  status: run ? derive(run) : 'waiting',
  ...
}))
```

需扩展 `TurnAgent['status']` 增加 `'waiting'` **或** UI 层单独 `rosterStatus`，避免污染全局 agent 状态机。

**锁定：** UI 层 `CouncilRosterStatus = TurnAgent['status'] | 'waiting'`，不改协议 `AgentRun`。

### 8.3 RoundtableArena（可选块，P3b）

嵌在 `AgentDashboard` 顶部（仅 `roundtable.engine==='council'`）：

```
┌─────────────────────────────────────┐
│ 圆桌 · 第 2/3 轮 · 焦点：成本       │
│ 战略家 ──rebut──► 怀疑论者          │
│ 票：A 6 · B 3（若已 vote）          │
└─────────────────────────────────────┘
```

数据：`message.roundtable.edges` / `votes`（见 §9）或从 agentRuns 解析。

### 8.4 Focus 联动

- 主栏顾问名 / 边点击 → `focusStore.focusedAgentId = roundtable:skeptic`  
- Agents 列表已有 `data-focus-highlight` —— 复用。

### 8.5 Auto-open panel

Council 召开后（首个 `agent:started` for `roundtable:*`）：

- 若用户本 turn 未手动关面板：`focusStore` 允许 auto-open Chat 右侧 Agents 页。  
- 遵循现有「用户关闭后本 turn 不再强开」策略。

---

## 9. Protocol & persistence

### 9.1 Engine flag

```ts
type RoundtableEngine = 'sim' | 'loop' | 'council'
// HIP_ROUNDTABLE_ENGINE=council
// 未来 hip.toml: [chat] roundtableEngine = "council"
```

### 9.2 Message.roundtable 扩展

```ts
interface RoundtableMeta {
  engine: 'sim' | 'loop' | 'council'
  convened: boolean
  roundsPlanned?: number
  roundsRan?: number
  earlyExit?: boolean
  advisorCalls?: number
  phase?: 'done' | 'aborted'
  /** council only */
  edges?: Array<{
    round: number
    from: string  // persona or agentId
    to: string
    relation: 'support' | 'rebut' | 'question'
    summary: string
  }>
  votes?: Array<{
    voter: string
    optionId: string
    strength: 1 | 2 | 3
    reason?: string
  }>
  tally?: Array<{ optionId: string; label: string; score: number }>
  hipOverruledMajority?: boolean
}
```

持久化：沿用 `messages.roundtable` JSON 列（v24+）；扩展字段向后兼容。

### 9.3 Wire streaming

| 事件 | 用途 |
|------|------|
| `agent:started` / `agent:finished` | 右侧 Agents 主路径 |
| `token:stream` agentId=顾问 | 可选；P3a 可只最终 output 减噪 |
| `token:stream` supervisor | plan / stage / decide 主栏 |
| `message:complete` | 含 agentRuns[] + roundtable meta |

### 9.4 主栏 content 策略

**Council 主栏只渲染：**

1. 召开说明 / Meeting plan  
2. 每轮：焦点一行 + **交锋要点（边）** ≤3 + Stage conclusion  
3. Vote tally（若有）  
4. Decision (hip) + residual + next steps  

顾问全文 **不进** 主栏长文（避免与右侧重复）。  
`RoundtableBody` 折叠逻辑保留；无全文 round 段时以 stage/decision 为主。

---

## 10. Sidecar module layout

```
packages/sidecar/src/session/roundtable/
  … existing loop modules …
  council/
    ids.ts              # agentId helpers, roster
    speech-schema.ts    # SpeechEnvelope parse/validate
    edges.ts            # acts → edges
    vote.ts             # tally
    advisor-agent.ts    # start/finish agent run + complete
    runner-council.ts   # state machine (or flag branch in runner.ts)
    project-panel.ts    # ensure FE-facing runs shape
```

**集成：**

```ts
// turn.ts / runTurn
if (engine === 'council') return tryRunRoundtableCouncilTurn(...)
if (engine === 'loop')    return tryRunRoundtableTurn(...)
// else sim → normal graph
```

---

## 11. FE module layout

```
src/lib/roundtableCouncil.ts       # roster merge, edge helpers
src/components/artifact/
  CouncilRoster.tsx                # optional arena + waiting seats
  CouncilEdges.tsx                 # edge list under CollaborationStructure
src/components/chat/
  RoundtableBody.tsx               # adapt for council slim transcript
  RoundtableStatusLine.tsx         # "战略家发言中…" from focused/running agent
```

`AgentDashboard`：当 `latest` message 有 `roundtable.engine==='council'`：

1. 顶部可选 `CouncilArena`  
2. `CollaborationStructure` 下挂 `CouncilEdges`  
3. children 列表用 **roster merge**（waiting + live + done）

---

## 12. Cost, latency, guards

| Guard | Default | Notes |
|-------|---------|-------|
| rounds | 2–4 | 同 loop |
| speakers / round | 2–3 点名 | 避免每轮 5 人全开 |
| maxAdvisorCalls | 12 | 同 loop |
| wall-clock | 180–240s | council 略放宽可选 240s |
| max parallel advisors | 4 | parallel 模式 |
| vote timeout | 单 voter 30s | 超时记弃权 |

**粗算：** N=2 × 3 speakers serial ≈ 6 顾问 + ~5 chair ≈ **11+** completions（接近 loop）。  
N=3 × 5 + vote ≈ **20+** —— 必须靠点名与 early exit。

---

## 13. Testing plan

| 层 | 用例 |
|----|------|
| speech-schema | rebut 无 target 失败；合法 envelope |
| edges | acts → edges 去重 |
| vote | strength 加权 tally |
| runner-council mock | convene → 3 agent:started 顺序；parallel 并发 |
| turn integration | message.agentRuns 含 5 席中发言者；roundtable.edges 可选 |
| FE roster | convened 后 waiting 席可见；running 高亮 |
| FE focus | 点击边 → focusedAgentId |
| regression | engine=loop 行为不变；sim 不变 |

---

## 14. Phased delivery

### P3a — Multi-agent visibility（已实现）

- [x] `engine=council` 默认（`HIP_ROUNDTABLE_ENGINE`）  
- [x] 每次顾问发言 → 真 `agent:started/finished` + `AgentRun`  
- [x] serial + parallel 调度（复用 loop）  
- [x] 主栏摘要（顾问全文在 Agents）  
- [x] FE roster merge + 五席  
- [ ] auto-open Agents（可选后续）  
- [x] 单测 runner hooks + speech + FE roster  
- [x] e2e seed 面板  

### P3b — SpeechAct + edges（已实现核心）

- [x] SpeechEnvelope 解析 + 降级  
- [ ] `rebuttal_pass` 强制模式  
- [x] `roundtable.edges` 持久化  
- [x] `CouncilEdges` 右侧 + focus 联动  
- [x] 主栏 slim speech 提示  

### P3c — Vote

- [ ] `open_vote` + 顾问 vote act  
- [ ] tally + hip decide 可读票  
- [ ] `hipOverruledMajority` 文案  
- [ ] Arena 计票 UI  

### P3d — Debate pair + polish

- [ ] `debate_pair` micro turns  
- [ ] 主栏极简（全文仅右侧）  
- [ ] status line：「怀疑论者反驳战略家…」  
- [ ] 可选 wall-clock 240s  

### P3.5+（可选）

- [ ] Operator 只读工具（Code）  
- [ ] hip.toml engine 配置  
- [ ] three.js 空态装饰（无关 council 核心）  

---

## 15. Success criteria (P3a)

- [ ] Council 召开后，右侧 Agents 出现 **至少一个** `roundtable:*` 子 agent。  
- [ ] 串行三发言 → 三次 `agent:started`（或三次 finished 可区分）。  
- [ ] `message:complete.agentRuns` 含顾问 output 与 `parentAgentId: supervisor`。  
- [ ] 简单题 route skip → **0** 顾问 agent。  
- [ ] Cancel 后无新的顾问 completion。  
- [ ] `engine=loop` 回归绿。  
- [ ] 主栏仍有 stage + decide；不因 council 崩溃。  

### P3b+

- [ ] 反驳边在 meta.edges 与右侧可见。  
- [ ] 投票后 tally 与 hip 决策同时可见；否决多数时有说明。  

---

## 16. Open questions

| # | 问题 | 倾向 |
|---|------|------|
| Q1 | 默认 engine 何时切到 council？ | dogfood 后；先 flag |
| Q2 | 顾问 token 是否流式到 FE？ | P3a 最终块；P3d 可选流式 |
| Q3 | 同 agentId 多 run 如何展示？ | 聚合最新 + 「历史 N 次」 |
| Q4 | claim 图是否持久化独立表？ | 否，塞 roundtable meta 即可 |
| Q5 | 是否允许用户指定少开席？ | 后续；P3 固定 5 席花名册、每轮点名子集 |

---

## 17. Risks & mitigations

| 风险 | 缓解 |
|------|------|
| 费用/延迟爆炸 | 点名 2–3 人/轮；early exit；maxAdvisorCalls |
| 假反驳 | SpeechAct 校验 + rebuttal_pass |
| 主栏与右侧重复 | 主栏只结论；全文在 Agents |
| panel 空白 | FE roster waiting 态 |
| 与 task/dispatch 子 agent 混淆 | agentId 前缀 `roundtable:` 过滤/样式 |
| 投票被误解为民主立法 | 文案「顾问投票 · hip 决策」 |

---

## 18. References

- Empty-state entry: [`roundtable-mode.md`](./roundtable-mode.md)  
- Chair-loop engine: [`roundtable-loop.md`](./roundtable-loop.md)  
- Agents panel: `src/components/artifact/AgentDashboard.tsx`, `AgentsRuntimeSplit.tsx`  
- Turn grouping: `src/lib/turnAgents.ts`  
- Subagent patterns: `packages/sidecar/src/session/subagent.ts`  
- Existing loop code: `packages/sidecar/src/session/roundtable/`  

---

## 19. Changelog

| Date | Note |
|------|------|
| 2026-07-26 | Initial complete draft (council multi-agent, SpeechAct, vote, Agents panel) |
