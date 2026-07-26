# Design Spec: Roundtable 真·多轮 Loop（Chair-loop Engine）

| Field | Value |
|-------|--------|
| **Title** | Roundtable Multi-Round Loop Engine |
| **Date** | 2026-07-26 |
| **Status** | Implemented (P2a) — loop engine default; set `HIP_ROUNDTABLE_ENGINE=sim` to force v1 sim |
| **Audience** | hip core (sidecar session / protocol / React UI) |
| **Depends on** | [`roundtable-mode.md`](./roundtable-mode.md)（空态入口、产品语义、v1 sim framing） |
| **Reference** | hip subagent timeline · ActivityBar lanes · plan-mode one-shot enter |

---

## 1. Overview

将圆桌从 **单次 completion 模拟多轮**（`ROUNDTABLE_ENGINE=sim`，见 v1 frame）升级为 **状态机驱动的真·多轮 LLM loop**（`ROUNDTABLE_ENGINE=loop`）：

- 每一次 **路由 / 规划 / 顾问发言 / 阶段性结论 / 终局决策** 均为独立模型调用（或独立可观测步骤）。
- **hip** 是唯一 **主席 + 决策者**；顾问只有意见权。
- 用户侧仍是 **一条首问 + 一个 assistant turn**（内部多步流式事件），空态入口与「简单题降级」语义与 v1 对齐。

```
User first message (roundtable armed)
        │
        ▼
┌───────────────────┐
│ RoundtableRunner  │  ← sidecar, replaces plain single-shot reply path
└─────────┬─────────┘
          │
   Chair: route ──skip──► normal single reply ──► done
          │
          convene
          ▼
   Chair: plan { N, agenda[] }
          ▼
   for r in 1..N:
        Chair: open_round { focus, speakers[] }
        for speaker in speakers:   // default serial_react
             Advisor(persona) completion
        Chair: stage_conclusion | early_exit
          ▼
   Chair: decide
          ▼
        done
```

---

## 2. Goals & Non-Goals

### Goals（P2）

1. **真多轮**：至少「plan → ≥2 rounds（每轮 ≥1 顾问 + stage）→ decide」为独立 completion 序列。
2. **强制状态机**：未 `stage` 不得进入下一轮；未 `plan` 不得开顾问；`decide` 仅 hip。
3. **路由降级**：简单题 0 顾问调用，走普通单轮答（与 v1 产品承诺一致）。
4. **可观测**：前端能逐步看到 plan / 发言 / 阶段结论 / 决策（timeline 或等价事件），诚实流式、不伪装五 socket。
5. **可取消**：`message:cancel` 中止整个 Runner；已完成步骤保留。
6. **护栏**：`N ∈ [2,4]`、`maxAdvisorCallsPerMeeting`、超时强制 `decide`。
7. **默认无工具**：Chat 圆桌顾问与 chair 讨论步 `tools: []`（避免开会变改代码）。
8. **双引擎**：`sim` 保留为 fallback / 低成本路径；`loop` 由 flag 开启。

### Non-Goals（P2）

- 五个真实长期 subagent 会话 / ACP 圆桌。
- Code surface 圆桌、顾问读仓库写文件。
- 用户插话改议程（P2.5+）。
- 投票民主、无限轮、three.js。
- 与 Execution Mode / Autopilot 耦合。
- 把 loop 做成通用 multi-agent 框架（只服务 roundtable）。

---

## 3. Relationship to v1

| 层 | v1 `sim` | P2 `loop` |
|----|----------|-----------|
| 空态 chip / draft.roundtable | 同 | 同 |
| 简单题降级 | prompt 自觉 | **Chair JSON `route`** |
| 讨论形态 | 一篇 markdown 演多轮 | **Runner 真多步** |
| Wire marker | `<!--hip.roundtable.v1-->` | 可仍用 v1 marker 触发；或 `config.roundtableEngine` |
| 决策权 | prompt 写 hip | **decide 节点强制 hip** |
| UI badge | 圆桌 | 同 + 可选 `rounds=N` meta |

**兼容：** 入口与 strip/badge 逻辑不动。Sidecar 识别 roundtable 首条后按 engine 分支。

---

## 4. Product semantics (locked for loop)

### 4.1 角色

| 角色 | 运行时 | 权责 |
|------|--------|------|
| **hip (Chair)** | Runner 内 chair 调用 | 路由、定 N、点名、阶段结论、early exit、**最终决策** |
| 战略家 / 怀疑论者 / 创意者 / 执行者 / 受众倡导者 | advisor 调用 | 仅发言；读 Issue + Minutes + 本轮上文；**无工具** |
| 用户 | session user message | 议题来源；P2 默认不打断 |

### 4.2 回合边界

| 常量 | 值 | 说明 |
|------|-----|------|
| `ROUNDTABLE_ROUNDS_MIN` | 2 | 召开时最少轮 |
| `ROUNDTABLE_ROUNDS_MAX` | 4 | 最多轮 |
| `maxAdvisorsPerRound` | 4 | 单轮最多点名（默认建议 2–3） |
| `maxAdvisorCallsPerMeeting` | 12 | 硬顶；触顶强制 decide |
| `maxChairActions` | 24 | 防 chair 死循环 |
| `advisorMaxOutTokens` | 实现定 | 发言宜短（2–5 句） |

### 4.3 发言模式（P2a 只实现第一种）

| mode | 行为 | P2 |
|------|------|-----|
| `serial_react` | 按 `speakers[]` 顺序；后者可见本轮已发言 | **默认 / P2a** |
| `parallel_then_synth` | 并行独立 → chair 综合 | P2c |
| `debate_pair` | 两人 micro 交锋 | P3 |

---

## 5. State machine

### 5.1 Phases

```ts
type RoundtablePhase =
  | 'routing'           // chair: convene?
  | 'normal_reply'      // single assistant answer; no advisors
  | 'planning'          // chair: N + agenda
  | 'round_open'        // chair: focus + speakers
  | 'advisor_speaking'  // advisor completion in flight
  | 'stage_conclude'    // chair: stage | early_exit
  | 'deciding'          // chair: final decision
  | 'done'
  | 'aborted'
```

### 5.2 Transitions

```
routing
  ├─ route.convene=false  → normal_reply → done
  └─ route.convene=true   → planning
planning                  → round_open (round=1)
round_open                → advisor_speaking (first speaker)
advisor_speaking
  ├─ more speakers        → advisor_speaking
  └─ speakers done        → stage_conclude
stage_conclude
  ├─ earlyExit | round==N → deciding
  ├─ round < N            → round_open (round+1)
  └─ maxAdvisorCalls      → deciding   // guard
deciding                  → done
* + cancel                → aborted
```

### 5.3 Invariants

1. `planning` 前不得 `advisor_speaking`。  
2. 每个 `round` 结束必须经过 `stage_conclude`（除非 `aborted`）。  
3. `deciding` 不得再调度顾问。  
4. `N` 一经 `plan` 锁定；early exit 只跳过剩余轮，不增大 N。  
5. 任意失败：可 **重试当前节点 ≤2 次**；仍失败则 `deciding` 用已有 Minutes 尽力拍板，或 `aborted` + 错误 notice。

---

## 6. Structured I/O (ChairAction)

Chair 每步输出 **严格 JSON**（优先 tool/function schema 或 `response_format`；失败则 parse + repair 一次）。用户不可见原始 JSON。

```ts
type PersonaId =
  | 'strategist'
  | 'skeptic'
  | 'creative'
  | 'operator'
  | 'audience'

/** Chair → Runner */
type ChairAction =
  | {
      type: 'route'
      convene: false
      /** User-visible normal reply (markdown) */
      reply: string
    }
  | {
      type: 'route'
      convene: true
      /** Optional one-liner why convening */
      reason?: string
    }
  | {
      type: 'plan'
      rounds: 2 | 3 | 4
      /** length === rounds; one line each */
      agenda: string[]
      /** Why this N */
      rationale: string
    }
  | {
      type: 'open_round'
      round: number          // 1-based
      focus: string
      speakers: PersonaId[]  // 1..maxAdvisorsPerRound, unique
      mode?: 'serial_react'  // P2a fixed
    }
  | {
      type: 'stage'
      round: number
      agreed: string[]
      open: string[]
      /** Required if !earlyExit && round < N */
      nextFocus?: string
      earlyExit?: boolean
      earlyExitReason?: string
    }
  | {
      type: 'decide'
      decision: string
      residual: string[]
      nextSteps: string[]
    }
```

**Advisor 输出：** 纯文本短段落（非 JSON）。Runner 写入 `RoundLocal` 与后续 Minutes。

### 6.1 Validation (Runner)

| Action | 校验失败时 |
|--------|------------|
| `plan.rounds` 越界 | clamp 到 [2,4] 或重试 |
| `agenda.length !== rounds` | 重试 |
| `speakers` 空 / 重复 / 未知 id | 重试或默认 `['strategist','skeptic']` |
| `open_round.round` 不匹配当前 | 忽略并重试 chair |
| `stage` 缺 `nextFocus` 且未 earlyExit 且非末轮 | 重试 |
| 未知 `type` | 重试；耗尽 → deciding/abort |

---

## 7. Context layers

| Layer | 内容 | 读者 |
|-------|------|------|
| **Issue** | 用户原题（strip 后正文）+ 语言 | 全体 |
| **Minutes** | Chair 维护滚动纪要：立场表、未决点、已否决方案（目标 ≤2k tokens） | 全体 |
| **Round local** | 本轮已产生的 advisor 全文 | 本轮后续顾问 + stage |
| **Chair private** | plan、各 stage、call 计数、guard 状态 | 仅 chair |

### 7.1 Minutes 更新时机

- 每个 `stage` 成功后：chair 或小型 compress 调用把本轮 Round local **折叠**进 Minutes。  
- P2a 可简化：直接拼接「Round r stage bullets」，超长时截断最早轮细节。  
- P2b：独立 `compress_minutes` 调用。

### 7.2 Advisor system sketch

```
You are {persona_label} in a hip roundtable.
Issue: ...
Minutes: ...
This round focus: ...
Prior speeches this round: ...
Speak 2–5 sentences. Address others when relevant.
Do not claim final authority. No tools.
Language: same as the user issue.
```

### 7.3 Chair system sketch

```
You are hip — chair and sole decision-maker of a roundtable.
Emit exactly one ChairAction JSON per step.
Never role-play all advisors in one blob.
Prefer fewer speakers and sharper focus.
...
```

---

## 8. Runner algorithm (normative)

```
function runRoundtable(issue, lang, signal):
  minutes = empty
  calls = { advisor: 0, chair: 0 }
  state = routing

  action = chair(route_prompt(issue, lang))
  if action.type==route && !action.convene:
    emit normal_reply(action.reply); return done

  action = chair(plan_prompt(...))  // expect plan
  N = action.rounds
  agenda = action.agenda
  emit plan_event(N, agenda, rationale)

  for r in 1..N:
    if calls.advisor >= maxAdvisorCalls: break
    open = chair(open_round_prompt(r, agenda[r-1], minutes))
    emit round_open(open)
    roundLocal = []
    for speaker in open.speakers:
      if calls.advisor >= maxAdvisorCalls: break
      text = advisor(speaker, issue, minutes, open.focus, roundLocal)
      calls.advisor++
      roundLocal.push({ speaker, text })
      emit speech(r, speaker, text)
    stage = chair(stage_prompt(r, roundLocal, minutes, N))
    emit stage(stage)
    minutes = updateMinutes(minutes, r, roundLocal, stage)
    if stage.earlyExit or r == N: break

  decision = chair(decide_prompt(issue, minutes, stages))
  emit decide(decision)
  return done
```

**取消：** 任意 await 检查 `signal.aborted` → `aborted`，flush 已 emit 事件。

---

## 9. Protocol & persistence

### 9.1 触发

| 信号 | 说明 |
|------|------|
| User content starts with `<!--hip.roundtable.v1-->` | 现网 FE 注入 |
| 或 `SessionConfig.roundtableEngine?: 'sim' \| 'loop'` | 可选显式 |
| 仅 **session 首条 user** + Chat surface | 与 v1 同；后续普通消息不进 Runner |

Sidecar：在 dispatch 首条时若检测到 roundtable → `engine=loop` 且 flag on 则 `RoundtableRunner`，否则 v1 普通 turn（模型吃整段 frame）。

### 9.2 流式事件（建议）

不强制新 WS 顶层 type；优先 **复用 turn 内 timeline / 自定义 step**，便于一个 assistant message：

```ts
// Conceptual wire (names illustrative)
type RoundtableEvent =
  | { kind: 'roundtable.route'; convene: boolean }
  | { kind: 'roundtable.plan'; rounds: number; agenda: string[]; rationale: string }
  | { kind: 'roundtable.round_open'; round: number; focus: string; speakers: PersonaId[] }
  | { kind: 'roundtable.speech'; round: number; speaker: PersonaId; content: string; streaming?: boolean }
  | { kind: 'roundtable.stage'; round: number; agreed: string[]; open: string[]; earlyExit?: boolean }
  | { kind: 'roundtable.decide'; decision: string; residual: string[]; nextSteps: string[] }
  | { kind: 'roundtable.done'; earlyExit?: boolean; advisorCalls: number }
  | { kind: 'roundtable.aborted'; reason?: string }
```

实现选项（按侵入性排序）：

1. **P2a：** `token:stream` 推渲染用 markdown 增量（Runner 把事件格式化成可见章节），内部仍真多调用。  
2. **P2b：** `timeline` 增加 `kind: 'roundtable'` 或 `text` steps 带 `meta.role`。  
3. **P2c：** 独立 `roundtable:event` 消息 + FE 专用渲染器。

### 9.3 Message / meta

| 字段 | 用途 |
|------|------|
| User `content` | 仍可存 wire frame；UI strip（现网） |
| Assistant `content` | 最终拼接的可读纪要（decide 后完整）或流式累积 |
| Optional `meta.roundtable` | `{ engine, convened, roundsPlanned, roundsRan, earlyExit, advisorCalls }` |

### 9.4 持久化

- P2a：只依赖现有 message/timeline 持久化；Runner 状态 **仅内存**（进程内 turn）。  
- 断线：与现网 running turn 一样 resync；不要求会议 checkpoint 恢复（non-goal）。

---

## 10. FE / UX

### 10.1 不变

- 空态 `RoundtableStarter`、badge、skill 互斥、Chat-only。  
- 一个 user bubble（原文）+ 一个 assistant turn。

### 10.2 Loop 可见结构（渲染目标）

```
## 会议规划
计划 3 轮 · …

## 第 1 轮 — …
**怀疑论者：** …
**执行者：** …
### 阶段性结论（hip）
…

## 第 2 轮 — …
…

## 决策（hip）
…
## 后续步骤
…
```

- Stage / Decision 视觉权重大于顾问发言（左边框或 heading 级）。  
- 进行中可显示安静状态行：`圆桌 · 第 2/3 轮 · 战略家`（复用 `TurnStatusLine` 或 ActivityBar）。  
- **禁止** 假多人同时 typing 动画伪装实时群聊。

### 10.3 i18n

状态行 key 示例：`chat.roundtable.status.planning` / `round` / `deciding`（实现时补齐五语）。

---

## 11. Sidecar module layout

```
packages/sidecar/src/session/roundtable/
  types.ts           # Phase, ChairAction, PersonaId, events
  schema.ts          # JSON schema / zod parse + repair
  minutes.ts         # updateMinutes, truncate
  chair.ts           # prompts + completeChair(action)
  advisor.ts         # completeAdvisor(persona, ctx)
  runner.ts          # state machine (normative §8)
  render.ts          # events → user-visible markdown chunks
  index.ts           # detect + enter from turn dispatch
```

**集成点（示意）：**

- 首条 user 处理路径（现 `runTurn` / dispatch-internal）前：  
  `if (isRoundtableUserMessage(content) && engine==='loop') return runRoundtable(...)`  
- Cancel：注册同一 session abort signal。  
- Usage：每次 completion 计入本 turn usage（与 multi-step 一致）。

---

## 12. Feature flags

```ts
// FE craft or shared
export const ROUNDTABLE_STARTER = true           // existing empty-state

// Sidecar / config
export type RoundtableEngine = 'sim' | 'loop'
// Default until P2a ships: 'sim'
// hip.toml optional later: [chat] roundtableEngine = "loop"
```

| Flag | 行为 |
|------|------|
| `sim` | 现网：整段 frame 进普通 agent turn |
| `loop` | RoundtableRunner |
| loop 抛错且 `fallbackSim=true` | 可选降级为 sim 单次生成（P2b；P2a 可直接错误） |

---

## 13. Cost, latency, guards

| Guard | Default | On breach |
|-------|---------|-----------|
| max rounds | 4 | plan clamp |
| maxAdvisorCallsPerMeeting | 12 | skip to decide |
| maxChairActions | 24 | abort or decide |
| per-completion timeout | 对齐现网 LLM timeout | retry / abort |
| wall-clock meeting budget | e.g. 180s（可调） | force decide |

**延迟预期（P2a serial）：**  
N=2 × 3 speakers → ~1 route + 1 plan + 2 open + 6 advisor + 2 stage + 1 decide ≈ **13** 次调用。应用户可见 progress。

---

## 14. Testing plan

| 层 | 用例 |
|----|------|
| `schema` | 合法/非法 ChairAction；speakers 去重 |
| `minutes` | 超长截断仍保留最近 stage |
| `runner` mock LLM | skip path 0 advisor；convene N=2 完整；earlyExit；maxAdvisorCalls 强制 decide；cancel mid-speech |
| integration | 首条 marker + loop flag → 多 completion；cancel 停后续调用 |
| FE | 流式章节出现顺序；badge 仍只显示原文 |

---

## 15. Phased delivery

### P2a — Vertical slice（已实装）

- [x] `RoundtableRunner` + chair/advisor mockable completions  
- [x] `serial_react` only；默认每轮 speakers 由 chair 选（校验 1–4）  
- [x] Minutes 简单拼接  
- [x] 用户可见 markdown 增量（render.ts）经 `token:stream`  
- [x] cancel / maxAdvisorCalls  
- [x] 默认 `loop`；`HIP_ROUNDTABLE_ENGINE=sim` 回退 v1  
- [x] 单测 runner / schema / detect / minutes  
- [x] `runTurn` 入口 `tryRunRoundtableTurn`  

**Code:** `packages/sidecar/src/session/roundtable/`

### P2b

- [x] JSON parse + repair retries（`CHAIR_PARSE_RETRIES`）  
- [x] Minutes 滚动截断（`truncateMinutes`）  
- [ ] `meta.roundtable` 持久化（可选后续）  
- [ ] timeline 结构化 steps（当前 markdown 章节 + token stream）  
- [x] 预算用尽强制 interim decide  

### P2c

- [ ] 半并行顾问  
- [ ] FE 回合折叠、stage 强调、status line i18n  
- [x] wall-clock budget（默认 180s）  

### P3+

- [ ] 用户插话  
- [ ] Code Operator 只读工具  
- [ ] 真 subagent 可选后端  

---

## 16. Success criteria (P2a)

- [x] 简单题：`route.convene=false`，**0** advisor 调用，正常短答。  
- [x] 复杂题：≥2 轮；每轮有 stage；decide 仅来自 chair 节点。  
- [x] 顾问发言为 **独立 completion**（runner 单测脚本队列可证）。  
- [x] Cancel → `aborted`，partial markdown 保留。  
- [x] 触顶 `maxAdvisorCalls` 仍能 decide。  
- [x] FE strip / badge 不变（仍用 v1 marker）。  
- [x] `HIP_ROUNDTABLE_ENGINE=sim` 不进入 loop。  

---

## 17. Open questions

| # | 问题 | 倾向 |
|---|------|------|
| Q1 | loop 默认何时打开？ | 先 flag off，dogfood 后 bake-in |
| Q2 | chair/advisor 是否允许不同模型？ | P2a 同 session 模型；P2b 顾问可用更快小模型 |
| Q3 | 失败是否 fallback sim？ | P2a 否；P2b 可配置 |
| Q4 | 是否写入 `hip.toml`？ | 稳定后 `[chat] roundtableEngine` |
| Q5 | 与 parallel worktree 命名混淆？ | 文档统一称 roundtable rounds，不称 parallel slots |

---

## 18. References

- Product entry & v1 sim: [`roundtable-mode.md`](./roundtable-mode.md)  
- Frame constants: `src/lib/roundtable.ts`  
- Subagent patterns (reuse display ideas, not full runtime): `packages/sidecar/src/session/subagent.ts`  
- Turn cancel / usage: existing `message:cancel` + turn usage aggregation  

---

## 19. Changelog

| Date | Note |
|------|------|
| 2026-07-26 | Initial draft (Chair-loop, state machine, P2a slice) |
| 2026-07-26 | P2a implemented under `packages/sidecar/src/session/roundtable/`; default engine `loop` |
