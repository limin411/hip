# Unify Title Bar and Sidebar Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the title bar's glass treatment to the sidebar and its peek panel, and align the resize-handle divider color, so the top and left edges of the app shell share the same visual depth.

**Architecture:** Reuse the existing CSS glass tokens (`--glass-bg`, `--glass-border`) and `backdrop-blur-xl` utility already used by `TitleBar`. Add a thin glass border to the sidebar's right edge, update the collapsed peek panel to match, and tint the resizable panel divider with the glass border color at rest. No new design tokens or component restructure are needed.

**Tech Stack:** React, Tailwind CSS, Vitest, @testing-library/react, happy-dom

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/components/sidebar/Sidebar.tsx` | Modify | Apply glass background, right border, and blur to the sidebar root. |
| `src/components/sidebar/Sidebar.test.tsx` | Create | Verify the sidebar root renders with the expected glass CSS classes. |
| `src/components/sidebar/SidebarPeek.tsx` | Modify | Apply the same glass treatment to the collapsed hover peek panel. |
| `src/components/sidebar/SidebarPeek.test.tsx` | Create | Verify the peek panel renders with the expected glass CSS classes. |
| `src/routes/AppLayout.tsx` | Modify | Change the sidebar resize-handle divider resting color from `bg-border` to `bg-[var(--glass-border)]`. |

---

### Task 1: Glass Sidebar Root

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:14`
- Create: `src/components/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebar/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

vi.mock('@/store/uiStore', () => ({
  useUiStore: () => ({ activeView: 'chat' }),
}))

vi.mock('@/domain', () => ({
  sessionService: {
    setSurface: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  useActiveSessionId: () => null,
}))

describe('Sidebar glass styling', () => {
  it('renders the sidebar root with glass background, right border, and blur', () => {
    render(<Sidebar />)
    const root = screen.getByTestId('sidebar-root')
    expect(root).toHaveClass('bg-[var(--glass-bg)]')
    expect(root).toHaveClass('border-r')
    expect(root).toHaveClass('border-[var(--glass-border)]')
    expect(root).toHaveClass('backdrop-blur-xl')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
yarn vitest run src/components/sidebar/Sidebar.test.tsx
```

Expected: FAIL — `Unable to find element by: [data-testid="sidebar-root"]` and/or missing classes.

- [ ] **Step 3: Implement the glass sidebar root**

Modify `src/components/sidebar/Sidebar.tsx` line 14 from:

```tsx
<div className="flex h-full flex-col">
```

To:

```tsx
<div data-testid="sidebar-root" className="flex h-full flex-col bg-[var(--glass-bg)] backdrop-blur-xl border-r border-[var(--glass-border)]">
```

Keep all child elements and layout classes unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
yarn vitest run src/components/sidebar/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/components/sidebar/Sidebar.test.tsx
git commit -m "feat(sidebar): apply glass treatment to sidebar root"
```

---

### Task 2: Align Resize-Handle Divider Color

**Files:**
- Modify: `src/routes/AppLayout.tsx:68`

- [ ] **Step 1: Update the sidebar divider color**

Modify `src/routes/AppLayout.tsx` line 68 from:

```tsx
<div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
```

To:

```tsx
<div className="mx-auto h-full w-px bg-[var(--glass-border)] transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
```

Leave the second resize handle (between main panel and artifact/preview panel) unchanged; it is not part of the title-bar/sidebar depth relationship.

- [ ] **Step 2: Run type-check and tests**

Run:

```bash
yarn type-check
yarn test
```

Expected: PASS for both.

- [ ] **Step 3: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat(layout): use glass border color for sidebar resize divider"
```

---

### Task 3: Glass Sidebar Peek Panel

**Files:**
- Modify: `src/components/sidebar/SidebarPeek.tsx:55`
- Create: `src/components/sidebar/SidebarPeek.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebar/SidebarPeek.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarPeek } from './SidebarPeek'

vi.mock('@/store/uiStore', () => ({
  useUiStore: () => ({ collapsed: true, activeView: 'chat' }),
}))

vi.mock('@/domain', () => ({
  sessionService: {
    setSurface: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  useActiveSessionId: () => null,
}))

describe('SidebarPeek glass styling', () => {
  it('renders the peek panel with glass background, right border, and blur', () => {
    render(<SidebarPeek />)
    const peek = screen.getByTestId('sidebar-peek')
    expect(peek).toHaveClass('bg-[var(--glass-bg)]')
    expect(peek).toHaveClass('border-r')
    expect(peek).toHaveClass('border-[var(--glass-border)]')
    expect(peek).toHaveClass('backdrop-blur-xl')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
yarn vitest run src/components/sidebar/SidebarPeek.test.tsx
```

Expected: FAIL — missing element/classes.

- [ ] **Step 3: Implement the glass peek panel**

Modify `src/components/sidebar/SidebarPeek.tsx` line 55 from:

```tsx
className={cn(
  'absolute left-0 top-0 z-40 h-full bg-surface border-r border-border transition-transform ease-out motion-reduce:transition-none',
  state.open ? 'translate-x-0' : '-translate-x-full',
)}
```

To:

```tsx
className={cn(
  'absolute left-0 top-0 z-40 h-full bg-[var(--glass-bg)] backdrop-blur-xl border-r border-[var(--glass-border)] transition-transform ease-out motion-reduce:transition-none',
  state.open ? 'translate-x-0' : '-translate-x-full',
)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
yarn vitest run src/components/sidebar/SidebarPeek.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SidebarPeek.tsx src/components/sidebar/SidebarPeek.test.tsx
git commit -m "feat(sidebar): apply glass treatment to sidebar peek panel"
```

---

### Task 4: Verify Full Suite and Visual Cohesion

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite and type-check**

Run:

```bash
yarn type-check
yarn test
```

Expected: PASS for both.

- [ ] **Step 2: Run the dev server and visually inspect**

Run:

```bash
yarn dev
```

Open the app in the Tauri window or browser (per project dev workflow) and verify:

1. The sidebar left edge matches the title bar's translucent glass look in both light and dark mode.
2. The 1px divider between sidebar and main panel uses the same faint glass border color at rest.
3. Collapsing the sidebar and hovering the left edge reveals a `SidebarPeek` panel with the same glass material.
4. The settings overlay still renders opaquely above the chrome.
5. Scrolling the session list inside the glass sidebar remains smooth.

- [ ] **Step 3: Final commit (if any visual tweaks were needed)**

If no visual tweaks were required, this step is optional. If adjustments were made:

```bash
git add .
git commit -m "chore(sidebar): final visual polish for glass sidebar"
```

---

## Self-Review

**Spec coverage:**
- Sidebar glass background/border/blur → Task 1
- Resize-handle divider color alignment → Task 2
- SidebarPeek glass treatment → Task 3
- Light/dark mode cohesion and visual verification → Task 4

**Placeholder scan:**
- No TBD/TODO placeholders.
- No vague "add appropriate styling" steps.
- Each code change includes exact `old_string` / `new_string`.

**Type consistency:**
- All class names reference existing Tailwind utilities and CSS variables already in use by `TitleBar`.
- Test mocks match the store/domain patterns used in neighboring tests.
