# Hooks Settings Honesty — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Prefer surgical diffs: i18n + small JSX only. **Do not** change sidecar hook fire semantics, fishbone layout coordinates, or protocol events.

**Goal:** Make the「挂钩配置」page honest about *declared* plugin hooks vs *runtime* paths—legend/badge wording, path chips, event path footnotes, expand-panel scope—without redesigning the fishbone.

**Architecture:** Keep static-scan data (`PluginMeta.hookEvents` / `hookCount`). User-visible copy uses **declared / not declared**. Path education via non-interactive chips + per-event path notes in expand panel. Internal props/testids may keep `configured` to avoid churn.

**Tech Stack:** React 18, i18next, Vitest + Testing Library, existing `HookConfig` / `HookLifecycleDiagram` / `hookCatalog`.

**Spec:** [`docs/superpowers/specs/2026-07-13-hooks-settings-honesty-spec.md`](../specs/2026-07-13-hooks-settings-honesty-spec.md)

**Runtime context (already shipped):** [`../specs/2026-07-12-hooks-workflow-parity-spec.md`](../specs/2026-07-12-hooks-workflow-parity-spec.md)

**Locked defaults (spec §10 / §12):**

| Decision | Value |
|----------|--------|
| User wording | 已声明 / 未声明 · Declared / Not declared |
| Code identifiers `configured` | **Keep** (no mass rename) |
| Path chips | Non-interactive, no filter |
| Scope of work | UI/i18n only (P0+P1 in one PR) |
| SessionStart deny | Footnote matches code; no runtime fix here |
| Workflow deep-link | Out of scope (P2) |

**Out of scope:** Sidecar fire order, gate hooks, dual fishbones, live fire telemetry, settings write UI.

---

## Dependency graph

```text
T1 hookCatalog path-note keys (pure data)
     │
     ├─► T2 i18n en / zh-CN / zh-TW (all new + renamed user strings)
     │
     └─► T3 HookLifecycleDiagram UI (chips, legend, expand panel)
              │
              ├─► T4 HookConfig tests + translation-keys
              │
              └─► T5 README cross-link + mark spec Implemented

Suggested: single commit or PR for T1–T5.
```

**PR / commit order:**

| Batch | Tasks | Theme |
|-------|-------|--------|
| PR-A (recommended single PR) | T1–T5 | Honest hooks settings page |

---

## File map

### Modify (primary)

```
src/components/account/hookCatalog.ts
src/components/account/HookLifecycleDiagram.tsx
src/components/account/HookConfig.test.tsx
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
src/i18n/translation-keys.test.ts          # only if structure breaks key parity checks
packages/sidecar/src/session/hooks/README.md
docs/superpowers/specs/2026-07-13-hooks-settings-honesty-spec.md  # status → Implemented
```

### Optional touch

```
src/components/account/HookConfig.tsx      # only if chips live here (prefer diagram-only per spec)
```

### Do not touch

```
src/components/account/hookFishbone.ts     # layout / RIBS
packages/sidecar/src/session/workflow-runner.ts
packages/protocol/src/hooks.ts
src-tauri/src/plugins.rs                   # scan stays declaration-level
```

---

## T1 — Catalog: path-note key map (exhaustive)

**Files:** `hookCatalog.ts` (+ tiny unit assertions in existing catalog tests if any; else `HookConfig.test.tsx` later).

- [ ] **T1.1** Add `HOOK_EVENT_PATH_NOTE_KEYS` as `Record<HookEvent, string>` parallel to `HOOK_EVENT_DESC_KEYS`, keys under `settings.hooks.events.pathNotes.<Event>` (or `settings.hooks.pathNotes.<Event>`—pick one prefix and use everywhere).
- [ ] **T1.2** Ensure TypeScript `satisfies Record<HookEvent, string>` so missing events fail compile.
- [ ] **T1.3** Optional: export a short helper `pathNoteKey(event: HookEvent): string` if useful.
- [ ] **T1.4** Commit slice: `feat(hooks-ui): path note keys for hook catalog`

**Key list (must cover all 12):**

```
SessionStart, UserPromptSubmit, TurnStart,
PreToolUse, PostToolUse, PostToolUseFailure,
PermissionRequest, Stop, TurnComplete,
ActivityStart, ActivityEnd, ActivityBudgetRequest
```

---

## T2 — i18n: declared wording + path copy (P0+P1)

**Files:** `en.ts`, `zh-CN.ts`, `zh-TW.ts`.

Use **exact semantic targets** from spec §5; wording may be tightened for length but must not drop required facts.

### T2.1 Legend / badge / empty / summary

| Key | zh-CN target | en target |
|-----|--------------|-----------|
| `diagram.legendConfigured` | 已声明 | Declared |
| `diagram.legendAvailable` | 未声明 | Not declared |
| `diagram.configuredBadge` | 已声明 | Declared |
| `diagram.notConfigured` | 未声明 | Not declared |
| `eventsOn` | `{{count}} 个事件已声明` | `{{count}} events declared` |
| `configuredEmpty` / `configuredEmptyHint` | 尚未声明… | No hooks declared yet… |
| `diagram.expandEmpty` / `expandEmptyHint` | 未有插件声明… | No plugin declares… |

- [ ] **T2.1** Update keys above in all three locales.

### T2.2 introShort

- [ ] **T2.2** Rewrite `settings.hooks.introShort` to include: read-only, **declared**, static scan (not live probe), three paths, exclude gate/external ACP, click for sources, edit plugin files.

### T2.3 Path chips

- [ ] **T2.3** Add keys (names illustrative—match implementation):

```
settings.hooks.diagram.pathMain
settings.hooks.diagram.pathSubagent
settings.hooks.diagram.pathWorkflow
settings.hooks.diagram.pathExcluded
settings.hooks.diagram.scanHint          # 高亮 = 静态扫描
settings.hooks.diagram.pathWorkflowNote  # optional caption: 工作流回合按整次 run
```

### T2.4 Event main desc + path notes

- [ ] **T2.4** Refresh `settings.hooks.events.*` main lines if needed for consistency.
- [ ] **T2.5** Add `pathNotes` (or chosen prefix) for all 12 events with **required** facts:

| Event | Must mention |
|-------|----------------|
| SessionStart | Primary on chat first message; not re-fired for bare workflow:run; deny behavior honest vs code |
| UserPromptSubmit | Chat processInput; workflow:run if text; no double-fire on message+dag |
| TurnStart | Once per chat turn; once per workflow **run** (not per node); not per subagent |
| Pre/PostTool* | Main + subagent + workflow agent; **not** gates |
| PermissionRequest | Chat HITL primary; workflow no HITL by default |
| Stop | continue+prompt **main session only**; workflow fires but no second DAG |
| TurnComplete | Chat turn / workflow run; not subagent stop |
| Activity* | Activity path; pure workflow:run usually N/A |

### T2.5 Residual keys

- [ ] **T2.6** Align `configuredDesc`, `diagram.subtitle` / `subtitleFishbone` if still present in tree (even if unused in compact page—keep glossary consistent).
- [ ] **T2.7** zh-TW 与 zh-CN 同义繁体；en 完整。

```bash
yarn vitest run src/i18n/translation-keys.test.ts
```

---

## T3 — Diagram UI: chips + expand path scope

**Files:** `HookLifecycleDiagram.tsx` (+ CSS only if chip row needs class; prefer existing Tailwind/legend chip classes).

### T3.1 Legend row

- [ ] **T3.1** Keep structure; strings come from updated i18n (T2).
- [ ] **T3.2** Add `scanHint` after legend chips (`text-caption text-ink-tertiary`).
- [ ] **T3.3** `data-testid="hook-diagram-scan-hint"` for tests.

### T3.2 Path chip row

- [ ] **T3.4** Above or below legend, render four chips: main / subagent / workflow / excluded.
- [ ] **T3.5** Non-buttons (or `type="button"` disabled / `span`); no click filter.
- [ ] **T3.6** Optional muted line `pathWorkflowNote`.
- [ ] **T3.7** `data-testid="hook-diagram-path-chips"` wrapping the row; each chip optional `data-path="main"|…`.

Reuse styles: `hook-fishbone-legend-chip` or sibling class in `HookLifecycleDiagram.css` if needed.

### T3.3 ExpandPanel

- [ ] **T3.8** Under event code + main `HOOK_EVENT_DESC_KEYS` description, render path note: `t(HOOK_EVENT_PATH_NOTE_KEYS[event])` with `text-caption text-ink-tertiary`.
- [ ] **T3.9** `data-testid="hook-diagram-path-note"` on that line.
- [ ] **T3.10** Optional one-line source disclaimer at bottom of panel (`diagram.expandScanDisclaimer`).
- [ ] **T3.11** Badge on event nodes still uses `configuredBadge` key (now “已声明”).

### T3.4 HookConfig.tsx

- [ ] **T3.12** Prefer **no** change if chips live in diagram. Only edit if intro needs a second line (avoid duplication).

```bash
yarn vitest run src/components/account/HookConfig.test.tsx
```

---

## T4 — Tests

**Files:** `HookConfig.test.tsx`.

Mock `t` currently returns keys for most strings—prefer asserting **testids** and structure:

- [ ] **T4.1** Assert path chips container present: `hook-diagram-path-chips`.
- [ ] **T4.2** Assert scan hint present: `hook-diagram-scan-hint`.
- [ ] **T4.3** On expand PreToolUse / PermissionRequest: `hook-diagram-path-note` present (content may be the i18n key if mock returns keys—assert testid + optional key substring).
- [ ] **T4.4** Keep: all catalog nodes render; empty hint; summary; expand toggle; `data-configured` still true when declared.
- [ ] **T4.5** Do **not** assert old Chinese「已配置」as required user-visible string.

Optional pure test for catalog:

- [ ] **T4.6** `Object.keys(HOOK_EVENT_PATH_NOTE_KEYS)` length === `HOOK_EVENT_CATALOG.length` and every catalog id present.

```bash
yarn vitest run src/components/account/HookConfig.test.tsx src/i18n/translation-keys.test.ts
```

---

## T5 — Docs cross-link + spec status

**Files:** sidecar hooks README, honesty spec status line.

- [ ] **T5.1** In `packages/sidecar/src/session/hooks/README.md`, add short note:

  > Settings UI「挂钩配置」shows **declared** events from static plugin scan. Runtime paths: table above. Honesty copy: `docs/superpowers/specs/2026-07-13-hooks-settings-honesty-spec.md`.

- [ ] **T5.2** Spec header `状态: **Draft**` → `**Implemented**` after merge-ready.

- [ ] **T5.3** Commit: `docs(ui): honest hooks settings declared vs runtime paths`

---

## Verification (full)

```bash
yarn vitest run \
  src/components/account/HookConfig.test.tsx \
  src/components/account/hookFishbone.test.ts \
  src/i18n/translation-keys.test.ts
```

Manual smoke:

1. Open Settings → 挂钩配置, no plugins → all「未声明」, empty hint.
2. With a plugin declaring PreToolUse → badge「已声明」; expand shows path note + plugin.
3. Expand PermissionRequest / Stop / TurnStart → footnotes match table.
4. Switch language en / zh-CN / zh-TW → no raw missing keys.

---

## Implementation notes

### i18n key layout (recommended)

```ts
settings.hooks.introShort
settings.hooks.eventsOn
settings.hooks.configuredEmptyHint
settings.hooks.diagram.legendConfigured      // "Declared"
settings.hooks.diagram.legendAvailable       // "Not declared"
settings.hooks.diagram.configuredBadge
settings.hooks.diagram.notConfigured
settings.hooks.diagram.scanHint
settings.hooks.diagram.pathMain
settings.hooks.diagram.pathSubagent
settings.hooks.diagram.pathWorkflow
settings.hooks.diagram.pathExcluded
settings.hooks.diagram.pathWorkflowNote
settings.hooks.diagram.expandScanDisclaimer
settings.hooks.events.PreToolUse             // main one-liner
settings.hooks.events.pathNotes.PreToolUse   // path footnote
// ... all events
```

Keep existing key **names** for legend (`legendConfigured`) to avoid orphan keys; only change **values**.

### SessionStart footnote honesty

Before writing copy, quick-check `session-turn-runner` / processInput:

- If `SessionStart` is `void host.hooks.fire(...)` without deny gate → path note must say notification-level / do not rely on deny to abort.
- Do not claim hard session kill unless code does.

### Expand panel layout sketch

```tsx
<code>{event}</code>
<p className="text-caption">{t(DESC[event])}</p>
<p className="text-caption text-ink-tertiary" data-testid="hook-diagram-path-note">
  {t(PATH_NOTE[event])}
</p>
{/* sources list */}
<p className="mt-2 text-caption text-ink-tertiary">{t('…expandScanDisclaimer')}</p>
```

### Accessibility

- Path chips: not focus traps; if using buttons, `disabled` or `aria-disabled` and no filter onClick.
- Path note is plain text under the heading (associated by proximity).

---

## Suggested commit message

```
docs(ui): honest hooks settings — declared vs runtime paths

- Legend/badge: declared / not declared
- Path chips + scan hint on fishbone
- Per-event path footnotes in expand panel
- Align i18n en/zh-CN/zh-TW; README cross-link
```

---

## Rollback

Revert single UI PR. No data migration. Runtime unchanged.

---

## Checklist before “done”

- [ ] Spec H1–H7 covered
- [ ] Spec A1–A8 acceptance
- [ ] Spec B1–B4 regression
- [ ] No sidecar / protocol / fishbone layout diffs
- [ ] Spec status Implemented
