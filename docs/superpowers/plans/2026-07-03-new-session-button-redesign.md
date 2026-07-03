# New Session Button Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the sidebar "New Session" icon button from `primary` (solid accent fill) to `outline` (border + surface background), matching the adjacent search box's visual language.

**Architecture:** Single-file change in `NewSessionButton.tsx` — swap variant, add `rounded-lg`, shrink Plus icon from 18px to 15px. No structural changes, no new components, no API changes.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react (Plus icon)

## Global Constraints

- Change only the `iconOnly` branch of `NewSessionButton`; the full-width text variant stays unchanged.
- Do NOT modify `SearchBox`, `Sidebar`, or `Button` components.
- Existing tests must continue to pass without modification.

---

### Task 1: Apply the visual redesign to NewSessionButton

**Files:**
- Modify: `src/components/sidebar/NewSessionButton.tsx:18-30`

**Interfaces:**
- Consumes: `Button` component (variant `outline`, size `icon`, className override)
- Produces: No interface changes — same props, same event handler, same `data-testid`

- [ ] **Step 1: Update the iconOnly branch**

```tsx
// src/components/sidebar/NewSessionButton.tsx, lines 18-30
// Replace the iconOnly return block:

  if (iconOnly) {
    return (
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
    )
  }
```

Three changes from current:
1. `variant="primary"` → `variant="outline"`
2. `className="h-9 w-9 shrink-0"` → `className="h-9 w-9 shrink-0 rounded-lg"`
3. `<Plus size={18} />` → `<Plus size={15} />`

- [ ] **Step 2: Run existing tests to verify nothing broke**

```bash
yarn test --run src/components/sidebar/NewSessionButton.test.tsx
```

Expected: all 3 existing tests pass (label rendering, aria-label on iconOnly, surface switching).

- [ ] **Step 3: Type-check**

```bash
yarn tsc --noEmit
```

Expected: no new errors. `variant="outline"` and `size="icon"` are already valid `VariantProps` on `Button`.

- [ ] **Step 4: Verify visually (manual)**

Launch the app and confirm:
- Button has border + surface background, not solid accent fill.
- Button is same height (36px) and border-radius (8px) as the search box.
- Plus icon is 15px and `text-ink-tertiary` color.
- Hover shows `bg-surface-muted`.
- Click still creates a new session.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/NewSessionButton.tsx
git commit -m "style: restyle new session button from primary to outline

Match the search box with border, surface background, and rounded-lg.
Shrink Plus icon from 18px to 15px for visual consistency.

Co-Authored-By: Claude <noreply@anthropic.com>"
```
