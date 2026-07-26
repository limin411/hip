# Design Spec: Roundtable Dynamic Cast + High-Quality Verdict

| Field | Value |
|-------|--------|
| **Title** | Roundtable L1/L2/L3 persona lenses + decide verdict quality |
| **Date** | 2026-07-26 |
| **Status** | Implemented (L1–L3 + verdict + report hero) |
| **Audience** | hip core (sidecar roundtable / HTML report; FE roster names optional) |
| **Depends on** | [`roundtable-loop.md`](./roundtable-loop.md) · [`roundtable-council.md`](./roundtable-council.md) |
| **Non-goals parent** | Vote P3c remains deferred; no free-form seat IDs outside base `PersonaId` |

---

## 1. Problem

| Pain | Root cause |
|------|------------|
| Seats sound interchangeable | Advisor system prompt is a **label only** — no mission, lens, or taboos |
| Same angles on every topic | Prompts are **not issue-conditioned** |
| Always five generic seats | Council forces full roster; chair `speakers[]` ignored in council mode |
| “No core conclusion” in report | Decision exists but is **process-secondary**, no forced one-line **verdict**, thin decide prompt |

**Product one-liner:**  
Different questions × different seats → distinct lenses; the report leads with a **high-quality hip verdict**, process is supporting evidence.

---

## 2. Goals & Non-Goals

### Goals

1. **L1 — Static persona archive**: Each base `PersonaId` has a multilingual brief (mission, typical probes, must-not).
2. **L2 — Issue-conditioned prompts**: Advisor system/user prompts inject issue, agenda, round focus, and seat-specific must-cover for *this* meeting.
3. **L3 — Dynamic cast**: Chair `plan` may emit a **cast** (2–5 seats from base IDs) with per-meeting `title` / `lens` / `mustCover` / `mustNot`. Council uses cast for who speaks; fallback = full L1 roster.
4. **Verdict protocol**: `decide` requires a short **verdict** + structured body; residual / nextSteps / optional tradeoffs; quality rubric in chair prompts.
5. **Report hero**: HTML summary puts **核心结论 (verdict)** first-screen; process diagrams secondary.
6. **Backward compatible**: Missing cast / verdict still parse and run; tests and old transcripts degrade gracefully.

### Non-Goals

- Arbitrary seat IDs (e.g. `cfo`) outside `PersonaId` set (keeps agentId / edges / FE roster stable).
- Separate LLM call only for “cast” when plan can carry cast (one chair action).
- Perfect NLG QA; quality gate is **cheap structural** (length / presence), one optional re-ask.
- Redesign FE Agents dashboard IA (display name may use cast title when wired).
- Vote P3c.

---

## 3. Architecture

```
route → plan{ rounds, agenda, rationale, cast? }
              │
              ▼  resolveCast(plan.cast) → MeetingCast
              │    missing/invalid → default L1 full roster
              │
   for r in 1..N:
        open_round{ focus, speakers? }
        speakers = council ? cast.ids
                 : intersect(open.speakers, cast.ids) || cast.ids
        for seat in speakers:
             system = L1 brief + L2/L3 lens + tools + envelope
             user   = issue + minutes + focus + mustCover + prior
        stage
              │
              ▼
   decide{ verdict, decision, keyTradeoffs?, residual, nextSteps }
              │
              ▼
   report HTML: hero(verdict) → decision body → process → rounds → roles
```

**Authority unchanged:** Advisors never decide; hip alone emits `decide`.

---

## 4. L1 — Static persona archive

### 4.1 Data shape

```ts
export interface PersonaBrief {
  id: PersonaId
  /** Short display label (existing i18n names). */
  label: Record<RoundtableLang, string>
  /** What this seat optimizes for. */
  mission: Record<RoundtableLang, string>
  /** Default probes when no cast override. */
  typicalProbes: Record<RoundtableLang, string[]>
  /** Hard constraints (never final authority, etc.). */
  mustNot: Record<RoundtableLang, string[]>
}
```

### 4.2 Base archive (content intent)

| id | Mission (en intent) |
|----|---------------------|
| strategist | Long-horizon goals, competitive position, option value |
| skeptic | Weak assumptions, failure modes, evidence gaps, cost of being wrong |
| creative | Non-obvious reframes, alternatives, asymmetric bets |
| operator | Sequencing, feasibility, resources, operational risk |
| audience | End-user / stakeholder impact, trust, accessibility of outcome |

All five remain the **only** agentId keys: `roundtable:${id}`.

### 4.3 Where used

- Default cast when L3 cast omitted.
- Base layer of every advisor system prompt (always).
- Labels for report seat board when cast has no custom title.

---

## 5. L2 — Issue-conditioned prompts

### 5.1 Inputs to prompt builders

```ts
export interface AdvisorPromptContext {
  persona: PersonaId
  lang: RoundtableLang
  issue: string
  agenda: string[]
  focus: string
  minutes: string
  priorThisRound: SpeechRecord[]
  /** Resolved seat from MeetingCast (L1 default or L3). */
  seat: CastSeat
}
```

### 5.2 System prompt skeleton

```
You are {seat.title} ({base label}) in a hip roundtable.
Mission: {seat.lens || L1.mission}
You MUST cover when relevant: {seat.mustCover || L1.typicalProbes}
You MUST NOT: {seat.mustNot || L1.mustNot} · claim final authority (hip decides)
Tools: web_search / web_fetch / read-only FS …
Speech envelope JSON: prose + acts with target when rebut/support/question
Language: {lang}
```

### 5.3 User prompt skeleton

```
Issue:
{issue}

Agenda (full meeting):
{agenda bullets}

Minutes (prior rounds / stage conclusions):
{minutes}

This round focus: {focus}

Prior speeches this round: …
Your seat: {title}
Lens: {lens}
Must respond to this round: {mustCover for round or seat}
Give your contribution now. Name other personas when agreeing/rebutting.
```

### 5.4 Round-level mustCover (optional, cheap)

If open_round later gains `mustCoverBySeat`, use it; **P0** only uses seat-level mustCover + focus string (no extra chair fields required).

---

## 6. L3 — Dynamic cast

### 6.1 Schema extension on `plan`

```ts
export interface CastSeat {
  id: PersonaId
  /** Meeting-specific display title (e.g. "监管合规质疑者"). */
  title: string
  /** How this seat views THIS issue. */
  lens: string
  /** 1–4 concrete questions/angles for this meeting. */
  mustCover: string[]
  /** Optional extra taboos for this meeting. */
  mustNot?: string[]
}

// ChairAction plan:
{
  type: 'plan'
  rounds: 2 | 3 | 4
  agenda: string[]
  rationale: string
  cast?: CastSeat[]   // optional; 2–5 unique PersonaIds
}
```

### 6.2 Parse / normalize (`resolveCast`)

| Rule | Behavior |
|------|----------|
| Missing / empty cast | Full L1 default: all 5 IDs, title=label, lens=mission, mustCover=typicalProbes |
| Invalid id | Drop seat |
| Duplicate id | Keep first |
| Count after filter | If 0 → default full; if 1 → pad with skeptic/strategist from L1 until ≥2; if >5 → take first 5 |
| Empty title/lens | Fill from L1 brief for that id |
| Empty mustCover | Fill from L1 typicalProbes |

### 6.3 Runner behavior

| Mode | Speakers per round |
|------|-------------------|
| **council** | Always **cast.ids** (parallel). Do **not** force all five if cast is subset. Do **not** ignore cast in favor of hard-coded `PERSONA_IDS`. |
| **loop** | `open_round.speakers` filtered to cast.ids; if empty after filter → cast.ids |

### 6.4 Events & report

- `roundtable.plan` gains optional `cast: CastSeat[]` (normalized).
- `RoundtableReportPayload.cast` for HTML seat board labels (title + lens snippet).
- Markdown plan section lists cast one-liners when present.

### 6.5 Display names

- `councilDisplayName(persona, lang, cast?)` → cast seat title if present else L1 label.
- Agent panel names follow the same (turn wiring passes title).

### 6.6 Edges / speech acts

- `target` remains base `PersonaId` only (no custom ids).
- Acts targeting seats not in cast are dropped or ignored at edge collect (existing parse already filters personas).

---

## 7. Decide — high-quality verdict

### 7.1 Schema

```ts
{
  type: 'decide'
  /** 1–3 sentences; standalone executive answer. Required for quality. */
  verdict: string
  /** Structured body: what was adopted / rejected / boundaries. */
  decision: string
  /** Explicit tradeoffs hip accepted. */
  keyTradeoffs?: string[]
  residual: string[]
  nextSteps: string[]
  confidence?: 'high' | 'medium' | 'low'
}
```

**Parse rules:**

- If `verdict` missing/empty → derive: first non-empty line of `decision` (trimmed, max ~280 chars) **or** reject and rely on chair retry.
- Prefer: empty verdict **throws** on first parse so `CHAIR_PARSE_RETRIES` re-asks; on last retry, soft-derive from decision so meeting still completes.
- `keyTradeoffs` optional array; default `[]`.
- `confidence` optional; invalid → omit.

### 7.2 Chair prompt rubric (decide user)

Require hip to:

1. Write **verdict** first (user-readable without reading process).
2. In **decision**, name which seats were **adopted / rejected** when conflict existed.
3. List **keyTradeoffs** (what was sacrificed).
4. **nextSteps** must be actionable (verb + object; avoid pure restatement of issue).
5. Do not only restate minutes; resolve open items or escalate residual explicitly.
6. Language = session lang.

### 7.3 Structural quality gate (optional one retry)

After successful parse, if **any** of:

- `verdict.length < 12`
- `decision.length < 40`
- `nextSteps.length === 0`

→ one extra `chairOnce` with feedback: `"Previous decide failed quality bar: … Re-emit decide."`  
If second also fails bar → accept best effort (prefer second text).

Budget/synthetic decide must still set a clear **verdict** line (budget exhausted) + short decision body.

### 7.4 Events & report payload

```ts
// RoundtableEvent decide + report.decision
{
  verdict: string
  decision: string
  keyTradeoffs?: string[]
  residual: string[]
  nextSteps: string[]
  confidence?: 'high' | 'medium' | 'low'
}
```

Markdown render:

```md
## 核心结论（hip）
{verdict}

## 决策（hip）
{decision}

## 关键取舍
- …

## 残留分歧
- …

## 后续步骤
1. …
```

### 7.5 Report HTML information architecture

```
[Hero]   核心结论 · verdict (largest type, first section)
[Body]   决策正文 · tradeoffs · residual · nextSteps
[Then]   Overview / flow (optional compact) · debate · rounds · roles
```

- TOC: 核心结论 first.
- Persona sub-reports: “对照 hip 结论” shows verdict + short decision snip.

---

## 8. Chair system prompt updates

Update `chairSystemPrompt` JSON catalog:

- `plan` includes optional `cast: [{id,title,lens,mustCover,mustNot?},…]`
- Prefer cast seats that **maximize complementary lenses for THIS issue** (not always all five).
- `decide` includes `verdict`, `decision`, `keyTradeoffs`, `residual`, `nextSteps`, optional `confidence`.
- Remind: advisors never decide; cast titles are display/lens only; ids must be from base set.

`chairUserForPlan` explicitly asks for cast tailored to the issue.

---

## 9. File / module plan

| Module | Change |
|--------|--------|
| `persona-briefs.ts` **new** | L1 archive + `defaultCast(lang)` + `resolveCast(raw, lang)` |
| `prompts.ts` | L1/L2/L3 advisor builders; decide/plan chair users; chair system |
| `types.ts` | `CastSeat`, plan.cast, decide fields, report/cast/decision |
| `schema.ts` | parse plan.cast, decide.verdict / keyTradeoffs / confidence |
| `runner.ts` | resolve cast; speakers from cast; quality gate; report fields |
| `render.ts` | plan cast list; decide markdown order |
| `ids.ts` | display name with cast override |
| `report.ts` / `report-prose.ts` | hero verdict; cast labels on seat board |
| `turn.ts` | pass cast title into agent display name if available |
| tests | schema, prompts, runner cast/decide, report hero |

---

## 10. Compatibility matrix

| Input | Behavior |
|-------|----------|
| Old plan without cast | Default 5-seat L1 cast |
| Old decide without verdict | Parse soft-derive on last retry / derive for report |
| Council + 3-seat cast | Only 3 managed agents per round |
| Loop + cast | Speakers ∩ cast |
| Report without verdict in payload | Show decision body only under decision section; no empty hero |

---

## 11. Success criteria

1. Unit: `resolveCast` pads/clamps/fills L1; plan JSON with cast parses.
2. Unit: `advisorSystemPrompt` contains mission/lens for skeptic ≠ strategist.
3. Unit: L2 user prompt contains issue + focus + mustCover.
4. Unit: runner with cast of 3 → `advisorCalls` / speakers length 3 per round (council).
5. Unit: decide with verdict appears in markdown as 核心结论 / Verdict.
6. Unit: report HTML contains hero section with verdict text before process diagrams.
7. Existing runner tests updated for new decide shape; green suite for roundtable package tests.

---

## 12. Execution plan (ordered)

### Phase 0 — Spec (this doc)

- [x] Spec locked for L1/L2/L3 + verdict + report hero.

### Phase 1 — L1 static archive

- [x] `persona-briefs.ts` + tests

### Phase 2 — L2 conditioned prompts

- [x] Context-aware advisor system/user prompts

### Phase 3 — L3 dynamic cast + runner

- [x] plan.cast schema, resolveCast, council speakers from cast, display names

### Phase 4 — Decide verdict + quality

- [x] verdict / keyTradeoffs / confidence + quality re-ask + markdown

### Phase 5 — Report hero

- [x] sec-verdict first; cast titles; TOC

### Phase 6 — Wire + regression

- [x] turn.ts passes system + displayName; roundtable suite green (50 tests)

---

## 13. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Cast always returns all 5 with shallow titles | Prompt: “prefer complementary 3–5; titles must be issue-specific” |
| Model invents non-base ids | Schema drop + L1 fill |
| Quality gate loops | Max one re-ask; then accept |
| Longer plan JSON fails parse | Retries + cast optional |
| FE roster still shows 5 waiting seats | Out of scope hard change; agents that never start remain unused — optional follow-up: FE roster = cast only |

---

## 14. Open follow-ups (not this change)

- FE Agents roster driven only by cast.
- `open_round.mustCoverBySeat`.
- Vote P3c informed by cast titles.
- LangSmith trace tags for cast lens.

---

## 15. Decision log

| Decision | Choice | Why |
|----------|--------|-----|
| Free-form seat ids? | **No** — base PersonaId only | agentId / edges / FE stability |
| Separate cast chair action? | **No** — field on plan | Fewer steps, same budget |
| Council ignore cast speakers? | **No** — cast defines roster | Fixes “always five generic” |
| Verdict required? | **Yes** with soft derive on last retry | Meeting completes + quality push |
| Report order | Verdict hero first | User complaint: no core conclusion |
