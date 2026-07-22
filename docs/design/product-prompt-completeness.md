# Spec: Product prompt completeness (TaskRuntime + Help parity)

**Status:** approved for implementation  
**Date:** 2026-07-22  
**Product version:** 1.0.1  
**Related commits:** `99f4daaa` (TaskRuntime), `12422667` (Agents+Runtime panel), `2dff3b4a` (Plugin Market)

## 1. Problem

Always-on Code `BASE` already teaches compact TaskRuntime rules (`run_script` background, `wait_tasks`, `monitor`, `scheduler_create`). Progressive disclosure sources lag:

| Layer | Gap |
|-------|-----|
| L2 `hip-coding` | Shell section omits async runtime depth |
| L2 `hip` skill / L0 capability-map | No Knowledge surface; no Runtime panel UX |
| L3 `agents-and-plugins.md` | Delegation table only has task / dispatch / batch; no TaskRuntime tools; EN Plugin Market missing from locales |
| Dogfood / unit tests | No regression lock on TaskRuntime always-on cues |

## 2. Goals

1. **Agent ops completeness:** `hip-coding` expands always-on TaskRuntime compact rules (no contradiction).
2. **Product help completeness:** English + locale Help document surfaces (Code / Chat / Knowledge), Agents+Runtime panel, async tools, Plugin Market (locale parity with EN topics).
3. **Regression:** dogfood + system-prompt tests assert TaskRuntime always-on strings.
4. **SoT discipline:** edit only `packages/product-content/**`; regenerate embeds with `yarn product:content`.

## 3. Non-goals

- Change runtime tool implementations or UI behavior.
- Expand always-on `BASE` further (keep compact; depth in skills).
- Full line-by-line literary translation polish beyond topic parity.
- Re-document deleted design specs under `docs/debug/`.

## 4. Content design

### 4.1 Always-on (unchanged text; locked by tests)

Keep existing `system-prompt.ts` BASE lines:

- Long shell → `run_script` `background:true` → `task_output` / `wait_tasks` / `task_stop`
- Log/CI → `monitor` (UI events, not auto-injected)
- Periodic → `scheduler_create`
- Sub-agent fire-and-forget → `task` background + output/stop

### 4.2 L2 `hip-coding` (ops)

Add section **Async TaskRuntime (shell / monitor / schedule)** after Shell & failures (or expand Shell):

- Prefer background for long shell; never invent tools; no sleep-poll.
- Tool map: `run_script` bg, `wait_tasks`, `task_output`, `task_stop`, `monitor`, `scheduler_create|list|delete`.
- Monitor: tight filters (`grep --line-buffered`); lines stream to UI; read via `task_output`.
- Scheduler: min 60s; prefer over FG sleep loops.
- UI: session right panel Agents + Runtime shows running/completed tasks.
- Bump `ops/meta.json` skillVersion `1` → `2`; extend description.

### 4.3 L0 capability-map + L2 `hip` SKILL

- Surfaces: Code | Chat | **Knowledge**.
- Note right panel: Agents (roster) + Runtime (async tasks) combined view.
- Permission row already correct; Chat surface ≠ Code edit mode remains.

### 4.4 L3 agents-and-plugins

Extend **Delegation tools** into **Delegation & TaskRuntime tools**:

| Tool | Use |
|------|-----|
| `task` | One sub-task (fg / background) |
| `dispatch_agent` | Named roster agent |
| `task_batch` | 2+ independent (true parallel) |
| `run_script` (+ `background:true`) | Shell; long work returns `task_id` |
| `wait_tasks` | Wait one or more bg tasks |
| `task_output` / `task_stop` | Poll / kill bg work |
| `monitor` | Stream stdout as UI events |
| `scheduler_create` / `list` / `delete` | Recurring wakes |

Add short **Runtime panel** note under Settings destinations in SKILL.

Keep Plugin Market section (EN). Locales must include equivalent Market + tool table topics.

### 4.5 Locales

| Locale | Action |
|--------|--------|
| zh-CN | Align SKILL, capability-map, agents-and-plugins with EN structure |
| zh-TW | Same (currently thinnest) |
| ja | Same |
| ko | Same |

Agent-facing English embeds remain English-only; locales feed Settings Help UI.

### 4.6 Tests / dogfood

- `system-prompt.test.ts`: code surface matches `/wait_tasks/`, `/scheduler_create/`, `/monitor/`.
- `product-prompt-dogfood.mjs`: always-on checks for those strings; optional matrix Q for long shell / CI watch → always-on cues + `hip-coding` skill.

## 5. Implementation plan (PR-shaped single change set)

| Step | Work | Verify |
|------|------|--------|
| P0 | This design doc | — |
| P1 | EN: capability-map, SKILL, agents-and-plugins, ops/hip-coding + meta | manual read |
| P2 | Locales: zh-CN, zh-TW, ja, ko for same files | section headings present |
| P3 | Tests + dogfood updates | vitest + yarn prompt:dogfood |
| P4 | `yarn product:content` + `yarn product:content:check` | exit 0 |

## 6. Success criteria

- [x] Code bare prompt still contains TaskRuntime compact rules
- [x] `CODING_SKILL_MD` contains wait_tasks / monitor / scheduler_create
- [x] EN + 4 locales document Knowledge surface and Runtime panel
- [x] EN + 4 locales document Plugin Market (or equivalent section)
- [x] `yarn product:content:check` pass
- [x] `yarn prompt:dogfood` pass
- [x] system-prompt unit tests pass for TaskRuntime always-on

**Implemented:** 2026-07-22 (product skill v3, ops skill v2).

## 7. Risks

- Soft size budget dogfood `code_bare_under_4k` — do **not** grow always-on BASE; only skills/docs.
- Locale drift later — prefer structural tables over long prose for easier sync.
