# Sidebar Search + New Session Same Row

**Date:** 2026-07-03
**Status:** approved

## Motivation

Currently the sidebar header area stacks three elements vertically:
1. SurfaceTabs (Chat/Code toggle)
2. NewSessionButton (full-width primary button)
3. SessionSearch (full-width search input)

This wastes vertical space. By moving the new session button to the right of the search box on the same row, we save ~40px of vertical space for the session list.

## Design

### Before

```
┌─────────────────────┐
│  [Chat]  [Code]     │
│  [+ New Chat      ] │  ← full-width button, own row
│  [🔍 Search...    ] │  ← full-width input, own row
└─────────────────────┘
```

### After

```
┌─────────────────────┐
│  [Chat]  [Code]     │
│  [🔍 Search... [+] ] │  ← same row, icon-only button
└─────────────────────┘
```

### Changes

#### 1. `NewSessionButton` — add `iconOnly` prop

- New optional prop `iconOnly?: boolean`
- When `true`:
  - Renders `<Button variant="primary" size="icon">` with a `Plus` icon from lucide-react
  - Overrides height to `h-9 w-9` (`className` prop) to match search input height
  - Sets `aria-label={label}` for accessibility (preserves the surface-dependent label like "New Chat" / "New Code Task")
- When `false` (default): existing full-width behavior unchanged

#### 2. `Sidebar` — horizontal row layout

Replace vertical stack with a horizontal flex row for search + button:

```tsx
{/* Before */}
<NewSessionButton surface={surface} />
<SessionSearch />

{/* After */}
<div className="flex items-center gap-2">
  <SessionSearch />
  <NewSessionButton surface={surface} iconOnly />
</div>
```

The search box naturally fills remaining space via flex; the button sits at a fixed `h-9 w-9`.

### Files touched

| File | Change |
|------|--------|
| `src/components/sidebar/NewSessionButton.tsx` | Add `iconOnly` prop, `Plus` icon render path |
| `src/components/sidebar/Sidebar.tsx` | Wrap search + button in flex row |
| `src/components/sidebar/NewSessionButton.test.tsx` | Add test case for `iconOnly` mode |

### Testing

- Existing `NewSessionButton` tests remain unchanged (default mode still works)
- New test: `renders icon button with aria-label when iconOnly` — verifies `Plus` icon presence and correct `aria-label`

## Edge cases

- **Narrow sidebar**: the search input flexes to fill available space; the button stays `36x36`. If the sidebar is extremely narrow, the input naturally shrinks — same behavior as today.
- **Searching spinner**: the `Loader2` spinner already lives in `SearchBox`, unaffected by this change.
- **Surface switch**: clicking the icon button still calls `sessionService.newConversation(surface)` with the current surface, same as today.
