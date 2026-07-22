# hip UX Visual & Interaction Elevation — Design Spec & Plan

| Field | Value |
| --- | --- |
| **Title** | UX Visual & Interaction Elevation |
| **Date** | 2026-07-22 |
| **Status** | Implemented (2026-07-22) |
| **Product** | hip — Tauri desktop AI workbench |
| **Depends on** | `docs/design/visual-craft-elevation.md` (dialect foundation; largely landed) |
| **Constraints** | Theme hexes frozen · Shell layout/IA frozen · No new product capabilities |

---

## Overview

hip already has a strong monochrome foundation (tokens, type ladder, flat chrome, focus/hover dialects, density, vibrancy). This program elevates **perceived craft** and **interaction quality** without rebrand or re-layout.

**Success lens:** quiet chrome that feels cut from one metal; agent runs that read as a story; composer that is powerful but not noisy; empty/loading states that feel intentional.

---

## Goals & Non-Goals

### Goals

1. **P0 Craft hygiene** — form fields use shared `Input`/`inputClassName`; residual forks gone; attachments/chips on radius lattice.
2. **P1 Runtime narrative** — ActivityBar terminal states settle with a clear status rail; Plan awaiting approval is decision-grade; sub-agent cards remain scannable.
3. **P2 Composer density** — primary vs secondary control rows; shared action banner primitive; blocked dock not double-bordered noise.
4. **P3 Finish states** — shared Skeleton; branded LoadingScreen; EmptyState adoption where local forks remain.
5. **P4 Surface tone** — Chat vs Code micro-density; window blur quieting on chrome.

### Non-Goals

- Accent/brand hex changes, shell geometry/IA, new features.
- Full design-system Storybook, mascot redesign, marketing rebrand.
- Big-bang Composer rewrite or Settings IA redesign.

### Hard constraints

| # | Constraint |
| --- | --- |
| 1 | Do not edit brand/semantic color hex blocks in `tokens.css` |
| 2 | No `AppLayout` panel proportion / sidebar width / rail IA changes |
| 3 | Style + micro-interaction only — no new user-facing capabilities |

---

## Design Principles

1. **Quiet by default, loud on purpose** — accent for selection, field focus, rare status.
2. **One dialect** — Field / Chrome / Menu-fill focus; `state-hover` interactive fills (see visual-craft-elevation).
3. **Borders structure, not texture** — avoid nested card grids.
4. **Progressive disclosure** — show outcome chips; hide advanced pickers until needed.
5. **Runtime is a narrative** — initializing → tools → agents → settle (success / partial / error / stopped).
6. **Minimum mechanism** — prefer shared primitives over one-off class strings.

---

## Workstreams

### P0 — Visual craft hygiene

| Item | Spec | Files |
| --- | --- | --- |
| Form field forks | Replace local `inputCls` / `textareaCls` with `inputClassName` / `textareaClassName` (or `<Input>` / `<Textarea>`). Icon search keeps local `pl-* pr-*`. | `AgentEditor`, `AddProviderDialog`, `EndpointModelDialog`, `ProviderDetail`, `MemoryConfig`, `McpConfig`, `HostFormDialog` |
| Attachment radius | User message attachment chips use `rounded-md` | `MessageBubble.tsx` |
| Composer field-within | Card shell uses `focusFieldWithin` constant (not duplicated utilities) | `Composer.tsx` |
| Dialect gate | `scripts/check-visual-dialects.mjs` stays green | hygiene |

**Done when:** no local full field class string duplicates of Field geometry; message attachments rounded; dialect script green.

### P1 — Runtime narrative

| Item | Spec | Files |
| --- | --- | --- |
| Activity settle rail | Terminal statuses (success / partial / error / stopped) show a 2px left semantic color rail on the summary row container; running keeps quiet (no rail). | `ActivityBar.tsx` |
| Initializing copy | Keep single-line initializing; use existing i18n keys only (no phase machine unless data exists). | — |
| Plan awaiting | Awaiting: `border-l-2 border-l-accent` + existing accent-subtle fill; primary Approve first; secondary Amend; danger Reject. Progress bar track when `total > 0`. | `PlanProgressPanel.tsx` |
| Sub-agent settle | On non-running status, header gains subtle settle (`transition-colors`); status icons already semantic — keep. | `SubAgentCard.tsx` (minimal) |

**Done when:** light/dark screenshots of running vs success ActivityBar and awaiting Plan panel feel decision-grade without layout shift.

### P2 — Composer density & banners

| Item | Spec | Files |
| --- | --- | --- |
| Control tiers | **Primary always visible:** SessionAgentPicker, ModelPicker (if hip), AttachmentButton. **Secondary (Code):** Effort, Permission, Plan, ProjectGuidance, Worktree — wrap in collapsible `ComposerMoreControls` (popover “Tune” / sliders icon), expanded by default when any secondary control is in a non-default state if cheap to detect; else default expanded on Code, collapsed optional later. **MVP:** secondary row wraps under primary with `gap` and `opacity` hierarchy — primary full, secondary slightly quieter `text-ink-secondary` container — without removing controls (safer than hiding). | `InputBar.tsx`, `NewConversation.tsx`, new `ComposerControlRow.tsx` |
| Shared ActionBanner | Props: `tone: 'warning' \| 'danger' \| 'info'`, icon, title, description, actions. | `ui/ActionBanner.tsx` |
| Adopt banner | MissingProjectBanner, AcpCapabilityCliffBanner use ActionBanner | chat banners |
| Blocked dock | Single muted strip, no double `border-y` + outer rule fight — use `bg-surface-muted/50` + text only | `InputBar.tsx` |

**Done when:** InputBar still exposes all Code controls (tests pass); banners share structure; blocked state is one visual language.

### P3 — Empty / loading finish

| Item | Spec | Files |
| --- | --- | --- |
| Skeleton | `ui/Skeleton.tsx` — pulse muted block; `SkeletonText` lines helper | new |
| LoadingScreen | HipLogo + quiet label (reuse logo component); keep spinner as fallback motion | `LoadingScreen.tsx` |
| Plugin empty | Local EmptyState → `ui/EmptyState` with title/description | `PluginConfigView.tsx` |
| Settings loading | Memory loading uses Skeleton block | `MemoryConfig.tsx` (light touch) |

**Done when:** LoadingScreen branded; plugin empty uses shared EmptyState; Skeleton exists and used ≥1 place.

### P4 — Surface tone & native quiet

| Item | Spec | Files |
| --- | --- | --- |
| Transcript density | Code surface: existing gap. Chat surface: slightly looser vertical gap on message list if single prop available without IA change. | `ChatPane.tsx` / layout caller |
| Window blur | On `window` blur/focus, set `document.documentElement.dataset.windowFocus` = `true`/`false`; CSS: sidebar chrome `opacity` 0.92 when false (subtle). | `main.tsx` or ThemeProvider, `tokens.css` |

**Done when:** unfocused window slightly quiets chrome; chat transcript not tighter than code.

---

## Acceptance Criteria (program)

| # | Gate |
| --- | --- |
| A1 | `node scripts/check-visual-dialects.mjs` exit 0 |
| A2 | No new `inputCls = 'h-9 w-full…focus-visible:ring-accent/10'` full forks under account/terminals |
| A3 | Message attachments `rounded-md` |
| A4 | Plan awaiting has left accent rail + progress track when total > 0 |
| A5 | ActionBanner used by project + ACP banners |
| A6 | LoadingScreen shows logo |
| A7 | Unit tests for touched components still green |
| A8 | No tokens.css brand hex edits; no sidebar width change |

### Visual QA (every batch)

- [ ] Light + dark
- [ ] Comfortable + compact if density vars touched
- [ ] Keyboard: composer controls still focusable
- [ ] reduced-motion: no new infinite motion beyond existing spinners

---

## Rollout / PR plan (execution order)

```text
PR-UX-1  P0 field primitives + attachment radius + Composer focusFieldWithin
PR-UX-2  P1 ActivityBar settle + Plan progress rail/bar + SubAgent settle
PR-UX-3  P2 ActionBanner + InputBar density row + blocked dock
PR-UX-4  P3 Skeleton + LoadingScreen + EmptyState plugin + Memory skeleton
PR-UX-5  P4 window-focus quiet + Chat transcript gap
```

Each PR is independently reviewable; this track may land as sequential commits on `dev`.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Composer “hide” controls breaks e2e | MVP keeps all controls visible; only hierarchy/wrapping |
| Plan progress bar layout shift | Fixed height track only when total > 0 |
| Window opacity confuses users | Cap at ~0.92; only chrome, not transcript |
| EmptyState prop mismatch (hint vs description) | Map local API to ui/EmptyState |

---

## References

- `docs/design/visual-craft-elevation.md`
- `src/styles/tokens.css`, `tailwind.config.js`
- `src/components/ui/*`, `chat/*`, `account/*`, `layout/*`
