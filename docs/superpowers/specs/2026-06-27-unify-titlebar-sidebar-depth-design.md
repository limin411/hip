# Unify Title Bar and Sidebar Depth

## Problem

The title bar (`TitleBar`) and the sidebar (`Sidebar`) currently use different visual depth languages:

- **Title bar**: translucent glass background (`--glass-bg`), glass border (`--glass-border`), `backdrop-blur-xl`, and a subtle sticky shadow (`shadow-sticky-top`). It reads as an elevated, frosted-glass plane.
- **Sidebar**: flat opaque `bg-surface`, no right border, no shadow. The only separation from the main content is the 1px resize-handle divider (`bg-border`).

This mismatch makes the top and left edges of the app shell feel visually disconnected. The title bar looks "floating" while the sidebar looks "pasted on," breaking the cohesive chrome aesthetic.

## Goal

Make the title bar and sidebar share the same elevation language by giving the sidebar the same glass treatment as the title bar. After the change, both edges should feel like parts of a single frosted-glass frame.

## Proposed Design

Apply a full-height glass surface to the sidebar that mirrors the title bar's material:

- **Background**: `bg-[var(--glass-bg)]`
- **Right edge divider**: `border-r border-[var(--glass-border)]`
- **Blur**: `backdrop-blur-xl`
- **Shadow**: keep it subtle; the title bar already uses `shadow-sticky-top` on its bottom edge. The sidebar does not need a heavy cast shadow, but a very faint inset or no extra shadow keeps it from competing. The border itself provides the structural separation.

The resize handle that sits between the sidebar and the main panel can remain visually thin (1px), but its color should align with the glass border language: use `bg-[var(--glass-border)]` in the resting state so it reads as the seam between two glass planes rather than an unrelated gray line.

When the sidebar is collapsed, the `SidebarPeek` slide-out panel should use the same glass treatment so the hover-reveal feels consistent with the expanded state.

## Detailed Changes

1. **`src/components/sidebar/Sidebar.tsx`**
   - Wrap the sidebar root in a full-height glass container:
     - `h-full`
     - `bg-[var(--glass-bg)]`
     - `backdrop-blur-xl`
     - `border-r border-[var(--glass-border)]`
   - Preserve existing internal layout and padding for `SurfaceTabs`, `NewSessionButton`, `SessionSearch`, `SessionList`, and `AccountFooter`.

2. **`src/routes/AppLayout.tsx`**
   - Update the resize-handle divider color to match the glass border:
     - Change `bg-border` to `bg-[var(--glass-border)]` on the 1px divider.
   - Keep hover/drag accent color unchanged (`group-hover:bg-accent`, `group-data-[resize-handle-state=drag]:bg-accent`).

3. **`src/components/sidebar/SidebarPeek.tsx`**
   - Replace `bg-surface border-r border-border` with the glass tokens:
     - `bg-[var(--glass-bg)]`
     - `backdrop-blur-xl`
     - `border-r border-[var(--glass-border)]`

4. **Tokens**
   - No new tokens are required. Reuse the existing `--glass-bg` and `--glass-border` CSS variables from `src/styles/tokens.css`.

## Visual Behavior

- **Light mode**: sidebar becomes a slightly translucent white plane with a near-invisible dark border, matching the title bar.
- **Dark mode**: sidebar becomes a translucent near-black plane with a subtle light border, matching the title bar.
- **Collapsed state**: `SidebarPeek` slides out with the same glass material, so the peek feels like the same sidebar rather than a different component.
- **Settings overlay**: the settings full-screen overlay sits above the sidebar and is unaffected; it remains `bg-surface` opaque.
- **Scroll performance**: `backdrop-blur` can be expensive during sidebar scroll. Because the session list is a child of the glass container, the blur applies to the container only; scrolling content inside should not re-composite the blur on every frame. We will verify this in the implementation phase.

## What Is Out of Scope

- Redesigning the title bar itself.
- Adding new shadows or elevation tokens beyond the existing `shadow-sticky-top`.
- Changing the sidebar layout, padding, or component structure.
- Modifying the resizable panel behavior (widths, collapse thresholds).

## Acceptance Criteria

- [ ] The sidebar background, right border, and blur match the title bar's glass treatment.
- [ ] The resize-handle divider uses the glass border color at rest.
- [ ] `SidebarPeek` uses the same glass treatment as the expanded sidebar.
- [ ] Both light and dark modes look cohesive.
- [ ] No visual regressions in the settings overlay or collapsed hover peek.
- [ ] The change passes existing UI/E2E tests (if any cover the sidebar/title bar rendering).
