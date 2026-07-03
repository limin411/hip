# New Session Button Redesign

**Date**: 2026-07-03
**Status**: approved

## Problem

The "New Session" button in the sidebar header (top-left, beside the search box) is visually jarring:

- It uses the `primary` variant with a solid accent background (`#6b7c5c`), making it the most prominent element in the sidebar header.
- The 18px white Plus icon on a colored block stands out as a CTA, but "new session" is a routine operation, not the primary call-to-action.
- Its visual weight clashes with the adjacent search box, which uses a subtle border style.
- The overall feel is that the button was bolted on rather than designed as part of the row.

## Goal

Make the button feel like it belongs in the same row as the search box — same visual weight, same language — so it reads as a cohesive toolbar rather than a search box + a loud CTA block.

## Design Decision

**Scheme B: Equal-height bordered sibling block**

Keep the button as a standalone element with its own border, but switch from `primary` (solid accent fill) to `outline` (border + surface background), matching the search box's visual language exactly.

### Visual Spec

| Property | Before | After |
|---|---|---|
| variant | `primary` | `outline` |
| size | `icon` (h-8 w-8) + override `h-9 w-9` | `icon-sm` or explicit `h-9 w-9` matching search box |
| background | `bg-accent` (solid sage gray) | `bg-surface` (same as search box) |
| border | none (primary has no border) | `border border-border` (same as search box) |
| border-radius | `rounded-md` (6px) | `rounded-lg` (8px, matches search box) |
| icon | `Plus` 18px, white | `Plus` 15px, `text-ink-tertiary` |
| hover | `bg-accent-hover` + shadow | `bg-surface-muted` |
| focus ring | `ring-accent/60` | `ring-accent/60` (unchanged) |

### Why `rounded-lg` instead of `rounded-md`

The Button component defaults to `rounded-md` (6px). The search box uses `rounded-lg` (8px). Since the goal is visual cohesion, the button must adopt the search box's radius. This is achieved via `className` override.

### Why 15px icon

The search box's Search icon is 15px. Matching the size creates visual rhythm across the row. The current 18px Plus feels oversized relative to its container.

### Why `outline` over `ghost`

`ghost` (no border, no background) would make the button disappear entirely, potentially making it hard to discover. `outline` gives it just enough presence to be findable without competing with the search box.

## Implementation

### File changed

**`src/components/sidebar/NewSessionButton.tsx`** — iconOnly branch only.

```tsx
// Before
<Button
  variant="primary"
  size="icon"
  className="h-9 w-9 shrink-0"
  aria-label={label}
  data-testid="new-session-button"
  onClick={() => sessionService.newConversation(surface)}
>
  <Plus size={18} />
</Button>

// After
<Button
  variant="outline"
  size="icon"
  className="h-9 w-9 shrink-0 rounded-lg"
  aria-label={label}
  data-testid="new-session-button"
  onClick={() => sessionService.newConversation(surface)}
>
  <Plus size={15} />
</Button>
```

### Files NOT changed

- `Sidebar.tsx` — no structural changes needed; the component API stays the same.
- `Button.tsx` — no need for new variant or size; existing `outline` + `icon` + className override suffices.
- `NewSessionButton.test.tsx` — existing tests should pass without changes; verify after implementation.

### Non-goals

- Changing the non-iconOnly (full-width text) variant of the button.
- Modifying SearchBox or its internal structure.
- Adding animation or transitions beyond what Button already provides.
