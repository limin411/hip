# Chat right-panel auto-open — final deliverables only

| Field | Value |
| --- | --- |
| **Date** | 2026-07-22 |
| **Status** | Implemented |
| **Surface** | Chat (`chatPanelOpen` / `PreviewPanel`); Code unchanged |
| **Primary code** | `src/lib/writeFollow.ts`, `src/lib/renderedArtifacts.ts`, `src/domain/serverMessageEffects.ts` |

## Problem

During Chat turns the right panel force-opens on nearly every durable write (`tool:finished` write-follow), including process scripts, intermediate docs, and source files. Users only want the panel when the agent’s **final** turn produces a **previewable deliverable** (document, image, HTML, PDF).

## Goals

1. **No mid-turn force-open** on Chat: process writes (scripts, drafts, source) must not steal conversation width.
2. **Turn-end auto-open only for durable renderable products**: image / markdown / html / pdf that are not ephemeral or process-intermediate paths.
3. **Process intermediate filter**: draft / wip / partial (and existing ephemeral temp/scratch) paths never auto-open.
4. **Deferred scripts**: write-then-run (or write-only scripts) never force-open the panel; stdout / transcript remain primary.
5. **Code surface**: keep current policy (never force-open; follow into Files only if panel already open).
6. **User dismiss**: `panelDismissedThisTurn` still suppresses auto-open for the rest of the turn.
7. **Manual open**: ArtifactCard click and PanelToggle still open the panel.

## Non-goals

- Changing Code `codePanelOpen` force-open policy (already correct).
- Hiding ArtifactCard rows for intermediate files (cards may still list them; click-to-open is intentional).
- Semantic “is this the final answer file?” ML; heuristics are path-based only.

## Policy matrix (Chat)

| Event | Path class | Auto-open panel? | Preview/focus follow |
| --- | --- | --- | --- |
| `tool:finished` write | any | **No** | Yes if panel **already** open (and follow not paused/dismissed) |
| `tool:finished` write | ephemeral / skip | No | No |
| `tool:finished` script (defer) | `.py`/`.sh`/… panel closed | No | Defer until turn end or cancel on `run_script` |
| `message:complete` | durable renderable product | **Yes** (unless dismissed) | Yes → last product |
| `message:complete` | intermediate / ephemeral / source / script | **No** | Optional focus only if panel already open (deferred flush) |
| User closes panel this turn | — | No further auto-open | — |
| ArtifactCard / PanelToggle | — | Manual open | Yes |

### Durable renderable product

A path qualifies for auto-open when **all** hold:

1. Finished `write_file` in this turn’s `toolCalls` (same recovery rules as `extractRenderedArtifacts`).
2. `previewKind` ∈ `{ image, markdown, html, pdf }`.
3. Not `isProcessIntermediatePath` (includes ephemeral temp/scratch **and** basename markers `draft` / `wip` / `partial`).

Examples:

| Path | Auto-open at turn end? |
| --- | --- |
| `page.html`, `report.md`, `chart.png`, `out.pdf` | Yes |
| `src/app.ts`, `lib/util.js` | No (not renderable) |
| `scripts/check.py` (+/− `run_script`) | No |
| `/tmp/x.md`, `scratch/note.md`, `notes_draft.md`, `wip-outline.md` | No |

## Behavior changes (delta from previous)

### Before

1. Chat `tool:finished` + non-ephemeral write → **immediate** `setSessionChatPanelOpen(true)`.
2. Script paths deferred; if not consumed by `run_script`, **open at turn end**.
3. `message:complete` also opened on any renderable write (including draft-like names under project root).

### After

1. Chat never force-opens from `openWriteFollowPanel` when the panel is closed (mirrors Code).
2. Script deferred flush may update preview/focus but **does not** open a closed panel.
3. Sole Chat auto-open entry: `message:complete` + `extractAutoOpenArtifacts` (renderable ∩ durable).

## Implementation

### `src/lib/writeFollow.ts`

- Add `isProcessIntermediatePath(path)` — true for ephemeral paths **or** basename process markers:
  - `/(^|[-_.])(draft|wip|partial)([-_..]|$)/i` on basename
- Keep `writeFollowPanelPolicy` skip/defer/immediate for **preview timing** only; document that panel force-open is surface-specific and no longer driven by “immediate” on Chat.

### `src/lib/renderedArtifacts.ts`

- Add `isAutoOpenPanelArtifactPath(path)` (renderable + not process-intermediate).
- Add `extractAutoOpenArtifacts(toolCalls)` — same as `extractRenderedArtifacts` then filter by `isAutoOpenPanelArtifactPath`.
- Leave `extractRenderedArtifacts` / `collectConversationArtifacts` unchanged for ArtifactCard / PreviewPanel lists.

### `src/domain/serverMessageEffects.ts`

- `openWriteFollowPanel`: Chat branch only acts when `chatPanelOpen === true` (set tab + selected path; **do not** call `setSessionChatPanelOpen(true)`).
- `message:complete` Chat block: use `extractAutoOpenArtifacts`; open panel only when non-empty.
- Deferred flush: keep preview apply; rely on `openWriteFollowPanel` no-force-open.

### Tests

- `writeFollow.test.ts` — process-intermediate paths.
- `renderedArtifacts.test.ts` — `extractAutoOpenArtifacts` filters draft/wip/ephemeral.
- `writeFollow.effects.test.ts` / `serverMessageEffects.test.ts` — Chat:
  - mid-turn write does not open panel
  - turn-end durable product opens
  - turn-end draft / script does not open
  - dismissed this turn still blocks

## Acceptance criteria

- [x] Chat: finishing `write_file` for `page.html` mid-turn leaves `chatPanelOpen === false`.
- [x] Chat: same turn `message:complete` with that write opens panel on `page.html`.
- [x] Chat: mid-turn / end for `src/a.ts` never force-opens.
- [x] Chat: write `scripts/x.py` then `run_script` never force-opens; write-only script never force-opens.
- [x] Chat: `notes_draft.md` / `/tmp/a.md` never force-open at turn end.
- [x] Chat: user dismiss this turn blocks auto-open even if product exists.
- [x] Code: still never force-opens on write.
- [x] ArtifactCard click still opens Chat panel (unchanged path in ArtifactCard).
- [x] Unit tests green for affected files (`writeFollow`, `renderedArtifacts`, `serverMessageEffects`, `writeFollow.effects`).

## Key decisions

1. **Turn-end only for force-open** — mid-turn preview follow is allowed only when the panel is already open; matches “don’t interrupt process watching.”
2. **Path heuristics for intermediates** — draft/wip/partial + existing ephemeral; no attempt to infer “final” from assistant text.
3. **Cards vs auto-open** — ArtifactCard may still show intermediate renderables; auto-open is stricter so process noise does not expand the shell.
4. **Scripts never auto-open** — even if never executed; transcript is enough.

## Open questions

None remaining — product direction fixed by UX request (2026-07-22).

## PR Plan

### PR-1 — Chat panel auto-open: final deliverables only (this change)

| Item | Detail |
| --- | --- |
| **Title** | fix(chat): auto-open right panel only for final deliverable artifacts |
| **Files** | `docs/design/chat-panel-auto-open.md`, `src/lib/writeFollow.ts`, `src/lib/writeFollow.test.ts`, `src/lib/renderedArtifacts.ts`, `src/lib/renderedArtifacts.test.ts`, `src/domain/serverMessageEffects.ts`, `src/domain/serverMessageEffects.test.ts`, `src/domain/writeFollow.effects.test.ts` |
| **Dependencies** | None |
| **Description** | Implement policy matrix above; unit tests cover mid-turn vs turn-end, scripts, drafts, dismiss. |

Single PR is sufficient: surface is localized and tests are co-located.
