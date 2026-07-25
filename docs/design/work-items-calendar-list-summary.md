# Design Summary: Work-item tracking redesign (calendar-first)

**Date:** 2026-07-25  
**Doc:** `grok-design-doc-6ee51c70.md` (R2.1)  
**Status:** Draft — ready to implement

## Problem

Work items today are master-detail (list + side pane) with optional dates. Product wants a **month calendar default**, **list mode**, **modal CRUD**, **required dates (default today)**, and **status-based colors** — per locked decisions and `tmp/work-items-calendar-design.html`.

## Solution (high level)

1. **Single cutover** — toolbar `SegmentedControl` (月历 | 列表), month nav in calendar mode only; remove master-detail (ships with e2e).
2. **WorkItemEditorModal** — form-local create/edit; create-on-save; soft-delete stays on page.
3. **Required dates** — `ensureScheduleDates` in `schedule.ts` on load/create/save → today; `hasExtras` ignores today–today-only so empty shells still discard pre-cutover.
4. **Status colors** — defaults from mockup; sidebar recolor; `~/.hip/work-items/ui-prefs.json`.
5. **Calendar** — pure helpers in `calendar.ts`; multi-day bars; `+N more`; no drag v1.
6. **Shared modal bus** — `workItemViewStore` (`requestCreate` / `requestEdit` / `highlightId`); AppSidebar + palette + `n` + day-add; **`leaveWorkItems` closes modal**.

## Key decisions (selected)

| Decision | Choice |
|----------|--------|
| Default entry | filter `all` + month calendar (**at cutover only**) |
| CRUD chrome | Modal, not detail pane |
| New items | Create-on-save after cutover |
| Colors storage | `ui-prefs.json` under work-items dir |
| Archived color | From `archivedAt` |
| Cancelled color | Fixed `#a78bfa` (≠ archived) |
| Week start | Sunday-first (v1) |
| Search | List-only; sticky across view switch |
| Sidebar counts | Out of v1 |
| Archive empty title | Block + focus (like Save) |
| Leave tasks | `closeModal()` + clear highlight |

## Non-goals

Drag-reschedule, week view, system calendar sync, per-item color, user lists, time-of-day, calendar search, sidebar counts, mon-first week (v1).

## PR sequence (7 PRs — R2 plan)

| PR | Scope |
|----|--------|
| **PR1** | Required dates + `hasExtras` fix (`schedule.ts`); no UI layout; no filter default change |
| **PR2** | Status color ui-prefs IPC (`paths.rs`, `lib.rs`, atomic write) |
| **PR3** | Calendar pure helpers (imports `ensureScheduleDates`) |
| **PR4** | Editor modal + `commitItemDraft` + `workItemViewStore` (no page cutover) |
| **PR5** | Sidebar status dots + recolor (no counts) |
| **PR6** | **Cutover: calendar UI + list modal + shell entry points + leaveWorkItems + e2e + `filterId: 'all'`** |
| **PR7** | Polish: i18n, a11y, non-null types, optional Rust hard-require dates |

PRs 1–2 parallelizable. **Never land PR6 without green work-items e2e.** No secondary calendar feature flag.

## Anchors in repo

- UI: `src/components/work-items/*`
- Domain: `src/domain/work-items/*`
- Store: `src/store/workItemStore.ts` (+ new view/prefs stores)
- Leave path: `src/components/layout/sidebarActions.ts` (`leaveWorkItems`)
- Create entry: `AppSidebar.tsx`, `GlobalCommandPalette.tsx`
- IPC/Rust: `src/ipc/workItems.ts`, `src-tauri/src/work_items.rs`, `paths.rs`, `lib.rs`
- Mockup: `tmp/work-items-calendar-design.html`
- Reuse: `Modal`, `SegmentedControl`, `Popover`
