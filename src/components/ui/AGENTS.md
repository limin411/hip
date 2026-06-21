# src/components/ui/ — AGENTS.md

Shared UI primitives — shadcn/Radix thin wrappers used across all feature components (chat, artifact, account, sidebar, rail).

## STRUCTURE

```
ui/
├── Button.tsx          # cva variant-driven button (5 variants × 4 sizes)
├── Modal.tsx           # Radix Dialog wrapper (title/description/content overlay)
├── DropdownMenu.tsx    # Radix DropdownMenu compound component (Root/Trigger/Content/Item/Separator)
├── ContextMenu.tsx     # Radix ContextMenu compound component
├── Tabs.tsx            # Radix Tabs compound component (Root/List/Trigger/Content)
├── Input.tsx           # Styled <input> with cn() merge
├── Textarea.tsx        # Styled <textarea> with cn() merge
├── Switch.tsx          # Radix Switch toggle
├── Avatar.tsx          # Radix Avatar with fallback initials
├── Badge.tsx           # Small label/count pill
├── Separator.tsx       # Radix Separator (horizontal/vertical)
└── useResizableBox.ts  # Pointer-event drag resize hook (returns { width, ref })
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a new UI primitive | Copy nearest existing file pattern | forwardRef + cn() + named export |
| Add Button variant | `Button.tsx:4` | `cva()` variants map — primary/secondary/ghost/outline/danger × sm/md/lg/icon |
| Mirror Radix compound API | `DropdownMenu.tsx` or `Tabs.tsx` | Re-export Root/Trigger from Radix, wrap Content with forwardRef + cn() |
| Drag-resize a panel | `useResizableBox.ts` | Returns `{ width, ref }`; attach ref to target, read width for layout |

## CONVENTIONS

- **CSS variables only**: All colors via `var(--surface)`, `var(--accent)`, `var(--ink)`, `var(--border)`, etc. No hardcoded hex.
- **`cn()` class merging**: Every component accepts `className` and merges it with internal classes via `cn()` from `@/lib/utils`.
- **Named exports only**: Zero `export default`. Re-exports from Radix use `export const Foo = RadixPrimitive.Foo`.
- **Compound components mirror Radix API**: `DropdownMenu.*`, `Tabs.*`, `ContextMenu.*` follow Radix's dot-notation pattern — re-export Root/Trigger as-is, wrap Content/Item with `forwardRef`.
- **`forwardRef` where Radix expects**: Content, Item, Trigger wrappers use `forwardRef`; simple elements like Root/Group are direct re-exports.
- **`cva` for Button variants**: `class-variance-authority` manages variant × size matrix in `Button.tsx`.

## ANTI-PATTERNS

- **No business logic**: These are pure presentational primitives. Keep hooks, stores, domain logic in feature directories.
- **No hardcoded colors**: Never write `#fff`, `bg-blue-500`, etc. Use only CSS variable tokens.
- **Avoid `export default`**: All 12 files use named exports exclusively.
- **No barrel exports**: No `index.ts` — import files directly (e.g., `import { Button } from '@/components/ui/Button'`).

## NOTES

- Referenced by chat (`Composer.tsx`, `ModelPicker.tsx`), artifact (`ArtifactPanel.tsx`, `BranchSwitcher.tsx`), account (all setting dialogs), sidebar, and rail components.
- Keep primitives thin: styling + accessibility attributes, no side effects. Composability over features.
- `useResizableBox.ts` is the only non-component file — a custom hook for pointer-event drag resize used by the artifact panel.
