# Sidebar Search + New Session Same Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the new session button from its own row to a small icon button beside the search box, saving vertical space.

**Architecture:** Two-file change. `NewSessionButton` gains an `iconOnly` prop that renders a `Plus` icon in a `size="icon"` Button instead of the full-width labeled button. `Sidebar` wraps `SessionSearch` and the icon-only `NewSessionButton` in a horizontal flex row.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react, vitest

## Global Constraints

- Surface-dependent labels ("New Chat" / "New Code Task") must remain as `aria-label` in icon mode
- Button height must match search input height (h-9 / 36px)
- Default `iconOnly={false}` behavior must remain unchanged

---

### Task 1: Add `iconOnly` prop to NewSessionButton

**Files:**
- Modify: `src/components/sidebar/NewSessionButton.tsx`
- Modify: `src/components/sidebar/NewSessionButton.test.tsx`

**Interfaces:**
- Consumes: `Plus` from `lucide-react`, `Button` from `@/components/ui/Button`, `Surface` from `@/store/uiStore`
- Produces: `NewSessionButton` accepts new optional `iconOnly?: boolean` prop; when true renders `<Button variant="primary" size="icon" className="h-9 w-9" aria-label={label}><Plus size={18} /></Button>`

- [ ] **Step 1: Add `iconOnly` test case**

In `src/components/sidebar/NewSessionButton.test.tsx`, add a new test after the existing two tests (after line 22):

```tsx
  it('renders icon button with aria-label when iconOnly', () => {
    const html = renderToStaticMarkup(<NewSessionButton surface="code" iconOnly />)
    expect(html).toContain('aria-label="sidebar.newCodeTask"')
    expect(html).toContain('<svg')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/sidebar/NewSessionButton.test.tsx`

Expected: the new test fails because `iconOnly` prop doesn't exist yet.

- [ ] **Step 3: Implement `iconOnly` prop**

Modify `src/components/sidebar/NewSessionButton.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { sessionService } from '@/domain'
import type { Surface } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

interface NewSessionButtonProps {
  surface: Surface
  iconOnly?: boolean
}

export function NewSessionButton({ surface, iconOnly = false }: NewSessionButtonProps) {
  const { t } = useTranslation()
  const label =
    surface === 'code' ? t('sidebar.newCodeTask')
    : t('sidebar.newChat')

  if (iconOnly) {
    return (
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
    )
  }

  return (
    <Button
      variant="primary"
      size="sm"
      className="w-full"
      data-testid="new-session-button"
      onClick={() => sessionService.newConversation(surface)}
    >
      <span>{label}</span>
    </Button>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/sidebar/NewSessionButton.test.tsx`

Expected: all 3 tests pass (2 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/NewSessionButton.tsx src/components/sidebar/NewSessionButton.test.tsx
git commit -m "feat: add iconOnly prop to NewSessionButton"
```

---

### Task 2: Update Sidebar layout to put search + button on same row

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

**Interfaces:**
- Consumes: `NewSessionButton` with `iconOnly` prop (from Task 1), `SessionSearch`
- Produces: Sidebar header area has SurfaceTabs on top row, search + icon button on bottom row

- [ ] **Step 1: Modify Sidebar layout**

In `src/components/sidebar/Sidebar.tsx`, change the header area (lines 15-19):

Replace:
```tsx
      <div className="flex flex-col gap-2.5 p-3">
        <SurfaceTabs active={surface} onChange={(v) => sessionService.setSurface(v)} />
        <NewSessionButton surface={surface} />
        <SessionSearch />
      </div>
```

With:
```tsx
      <div className="flex flex-col gap-2.5 p-3">
        <SurfaceTabs active={surface} onChange={(v) => sessionService.setSurface(v)} />
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SessionSearch />
          </div>
          <NewSessionButton surface={surface} iconOnly />
        </div>
      </div>
```

The outer `flex-1 min-w-0` wrapper ensures the search input shrinks properly in narrow sidebars without pushing the button out.

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Run full test suite**

Run: `yarn test`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "feat: move new session button beside search box as icon button"
```
