# Visual Language Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade hip from monochrome-flat to modern-flat visual language (Teal accent, 4-8px radius, comfortable density, standard animations)

**Architecture:** Foundation-first approach. Modify design tokens (`tokens.css` + `tailwind.config.js`) as the single source of truth, then ripple changes outward through base UI components, then domain components, finally animation keyframes. No layout restructuring, no API changes.

**Tech Stack:** Tailwind CSS v3, CSS custom properties, Lucide React icons, Radix UI primitives

---

### Task 1: Design Token Foundation — CSS Variables

**Files:**
- Modify: `src/styles/tokens.css:5-29`

- [ ] **Step 1: Update accent color tokens**

Replace the monochrome accent variables with Teal:

```css
:root {
  /* 单色 chrome —— 极浅灰白背景、近黑正文、灰色辅助文字 */
  --bg-app: #fafafa;
  --bg-subtle: #f5f5f5;
  --bg-muted: #efefef;
  --border: #e4e4e4;
  --text-primary: #111111;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  /* 品牌强调色：Teal */
  --accent: #0d9488;
  --accent-hover: #0f766e;
  --accent-subtle: #e6f7f5;
  /* 功能状态色 —— 保留语义 */
  --success: #3d9a50;
  --danger: #d64545;
  --warning: #c77a1a;
  /* 智能体角色色 —— 保留，作为功能性指示 */
  --role-supervisor: #5b5bd6;
  --role-planner: #1a8cd8;
  --role-coder: #3d9a50;
  --role-reviewer: #c77a1a;
  /* Titlebar overlay: pushes sidebar content below macOS traffic lights */
  --traffic-lights-offset: 40px;
}
```

- [ ] **Step 2: Update base typography**

Change font-size from `14px` to `13px` and line-height from `1.6` to `1.7`:

```css
body {
  margin: 0;
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

- [ ] **Step 3: Update link hover color to use CSS variable instead of hardcoded hex**

```css
a:hover {
  color: var(--text-primary);
}
```

- [ ] **Step 4: Verify changes**

Run: `grep -n "111111\|#111\|#000000\|14px\|line-height: 1.6" src/styles/tokens.css`
Expected: no matches for old values (the `--text-primary: #111111` should remain — that's intentional, body text stays near-black)

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat: replace monochrome accent with Teal, update base typography (13px/1.7)"
```

---

### Task 2: Design Token Foundation — Tailwind Config

**Files:**
- Modify: `tailwind.config.js:37-69`

- [ ] **Step 1: Replace borderRadius with 4-8px scale**

```js
borderRadius: {
  none: '0',
  sm: '4px',
  DEFAULT: '6px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '12px',
  '3xl': '12px',
  full: '9999px',
},
```

- [ ] **Step 2: Add message-enter keyframes and animation**

```js
keyframes: {
  blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
  pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
  'message-enter': {
    from: { opacity: '0', transform: 'translateY(8px)' },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
},
animation: {
  blink: 'blink 1s step-start infinite',
  pulse: 'pulse 1.2s ease-in-out infinite',
  'message-enter': 'message-enter 0.3s ease-out',
},
```

- [ ] **Step 3: Add default transition duration**

Add after `animation` block at the same level as `borderRadius`/`boxShadow`:

```js
transitionDuration: {
  DEFAULT: '150ms',
},
```

- [ ] **Step 4: Verify changes**

Run: `node -e "const c = require('./tailwind.config.js'); const t = c.default?.theme?.extend || c.theme?.extend; console.log('radius:', JSON.stringify(t.borderRadius)); console.log('keyframes:', Object.keys(t.keyframes || {})); console.log('duration:', t.transitionDuration)"`
Expected: radius `md:6px`, `lg:8px`, `full:9999px`; keyframes includes `message-enter`; duration `{ DEFAULT: '150ms' }`

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js
git commit -m "feat: add 4-8px border-radius scale, message-enter animation, 150ms default transition"
```

---

### Task 3: Base UI Components — Button

**Files:**
- Modify: `src/components/ui/Button.tsx:6`

- [ ] **Step 1: Update ghost variant hover background**

The Button base already has `transition-colors` and `gap-2` (which becomes 8px via Tailwind's new scale). The ghost variant needs updated hover bg:

```tsx
ghost: 'text-ink-secondary hover:bg-accent-subtle hover:text-ink',
```

Note: only the `ghost` variant changes (`hover:bg-surface-muted` → `hover:bg-accent-subtle`). The `primary` variant uses `bg-accent` / `hover:bg-accent-hover` which now resolve to Teal via CSS vars. Everything else stays the same.

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Button.tsx
git commit -m "feat: ghost button hover uses accent-subtle (Teal tint) instead of surface-muted"
```

---

### Task 4: Base UI Components — Input, Textarea, DropdownMenu, ContextMenu, Modal, Tabs

**Files:**
- Modify: `src/components/ui/Input.tsx:9-10`
- Modify: `src/components/ui/Textarea.tsx:9-10`
- Modify: `src/components/ui/DropdownMenu.tsx:16-17,34-35`
- Modify: `src/components/ui/ContextMenu.tsx:15-16,33-34`
- Modify: `src/components/ui/Modal.tsx:19,21,31`
- Modify: `src/components/ui/Tabs.tsx:26`

- [ ] **Step 1: Add transition-shadow to Input focus ring**

Change line 9 in `Input.tsx`:

Was: `'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink',`
Now: `'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink transition-shadow',`

- [ ] **Step 2: Add transition-shadow to Textarea focus ring**

Change line 9 in `Textarea.tsx`:

Was: `'w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink',`
Now: `'w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink transition-shadow',`

- [ ] **Step 3: Remove shadow-float from DropdownMenu, add transition-colors to item**

In `DropdownMenu.tsx` line 17, remove `shadow-float`:

Was: `'z-50 min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-float',`
Now: `'z-50 min-w-[200px] rounded-lg border border-border bg-surface p-1',`

In `DropdownMenu.tsx` line 34-35, add `transition-colors`:

Was: `'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none',`
Now: `'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none transition-colors',`

- [ ] **Step 4: Remove shadow-float from ContextMenu, add transition-colors to item**

In `ContextMenu.tsx` line 16, remove `shadow-float`:

Was: `'z-50 min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-float',`
Now: `'z-50 min-w-[160px] rounded-lg border border-border bg-surface p-1',`

In `ContextMenu.tsx` line 33-34, add `transition-colors`:

Was: `'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none',`
Now: `'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none transition-colors',`

- [ ] **Step 5: Update Modal overlay and content**

In `Modal.tsx` line 19, change hardcoded `bg-black/40` to use a semantic color:

Was: `<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />`
Now: `<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />`

In `Modal.tsx` line 21 (the Content), `rounded-md` now resolves to 6px via the Tailwind config. That's fine — Modals now get a subtle radius.

Use `wrap` for line 21 to keep it readable but no functional change needed besides `rounded-md` auto-resolving to 6px.

- [ ] **Step 6: TabsTrigger after pseudo-element already uses `bg-accent`** — it auto-resolves to Teal. No change needed.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Input.tsx src/components/ui/Textarea.tsx src/components/ui/DropdownMenu.tsx src/components/ui/ContextMenu.tsx src/components/ui/Modal.tsx
git commit -m "feat: add transition on input/textarea focus rings, menu items; remove shadow-float from menus; fix modal overlay color"
```

---

### Task 5: Sidebar Components — Visual Refresh

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:34,41`
- Modify: `src/components/sidebar/SessionItem.tsx:57,73,87`
- Modify: `src/components/sidebar/SidebarPeek.tsx:45,55`
- Modify: `src/components/sidebar/UserMenu.tsx:37`
- Modify: `src/components/sidebar/SearchBox.tsx:22-26`

- [ ] **Step 1: Upgrade Sidebar padding from compact to comfortable**

In `Sidebar.tsx` line 34:

Was: `<div className="flex flex-col gap-2 p-1.5">`
Now: `<div className="flex flex-col gap-2.5 p-2">`

In `Sidebar.tsx` line 41:

Was: `<div className="border-t border-border p-1.5">`
Now: `<div className="border-t border-border p-2">`

- [ ] **Step 2: Update SessionItem — keep `bg-accent-subtle` for active, add transition to delete button**

In `SessionItem.tsx` line 57, the active class `bg-accent-subtle` now uses Teal tint. No change needed.

Add `transition-colors` to the delete button at line 87:

Was: `className="hidden shrink-0 text-ink-tertiary hover:text-danger group-hover:block"`
Now: `className="hidden shrink-0 text-ink-tertiary hover:text-danger group-hover:block transition-colors"`

Add `transition-shadow` to the editing input at line 73:

Was: `className="min-w-0 flex-1 rounded border border-accent/40 bg-surface px-1 py-0 text-[13px] text-ink outline-none"`
Now: `className="min-w-0 flex-1 rounded border border-accent/40 bg-surface px-1 py-0 text-[13px] text-ink outline-none transition-shadow"`

- [ ] **Step 3: Clean up SidebarPeek — remove shadow-float, round to right only**

In `SidebarPeek.tsx` line 45, remove `shadow-pop`:

Was: `className="absolute left-0.5 top-1/2 -translate-y-1/2 rounded bg-surface text-ink-tertiary opacity-0 shadow-pop transition-opacity group-hover:opacity-100"`
Now: `className="absolute left-0.5 top-1/2 -translate-y-1/2 rounded bg-surface text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"`

In `SidebarPeek.tsx` line 55, remove `shadow-float` (peek panel already has `border-r border-border` as visual boundary):

Was: `'absolute left-0 top-0 z-40 h-full bg-surface rounded-r-xl border-r border-border shadow-float transition-transform ease-out motion-reduce:transition-none'`
Now: `'absolute left-0 top-0 z-40 h-full bg-surface border-r border-border transition-transform ease-out motion-reduce:transition-none'`

Note: `rounded-r-xl` is removed because with the new Tailwind config, `rounded-r-xl` would apply 12px on the right side only, which looks odd on a panel edge. Flat edge is correct for a panel.

- [ ] **Step 4: Update UserMenu trigger spacing**

In `UserMenu.tsx` line 37, change `p-1.5` to `p-2`:

Was: `className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-surface-muted"`
Now: `className="flex w-full items-center gap-2.5 rounded-md p-2 text-[13px] text-ink-secondary transition-colors hover:bg-surface-muted"`

- [ ] **Step 5: Add transition-shadow to SearchBox input**

In `SearchBox.tsx` lines 22-26, add `transition-shadow` to the input className. Read the file to find the exact class string and add `transition-shadow` before `focus-visible:ring-2`.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/components/sidebar/SessionItem.tsx src/components/sidebar/SidebarPeek.tsx src/components/sidebar/UserMenu.tsx src/components/sidebar/SearchBox.tsx
git commit -m "feat: refresh sidebar visuals — accent-subtle active state, comfortable spacing, remove shadow-float, add transitions"
```

---

### Task 6: Chat Components — Composer, ChatPane, ChatHeader

**Files:**
- Modify: `src/components/chat/Composer.tsx:34,73,84`
- Modify: `src/components/chat/ChatPane.tsx:80,124,132,147`
- Modify: `src/components/chat/ChatHeader.tsx:37,49,8-12`

- [ ] **Step 1: Update Composer — remove shadow-pop, update stop button border-radius**

In `Composer.tsx` line 34, remove `shadow-pop`:

Was: `className="rounded-xl border border-border bg-surface p-2 shadow-pop focus-within:ring-2 focus-within:ring-accent/30"`
Now: `className="rounded-xl border border-border bg-surface p-2 focus-within:ring-2 focus-within:ring-accent/30"`

The stop button (line 73) already has `rounded-lg` and `bg-accent text-white transition-colors hover:bg-accent-hover`. Now `bg-accent` is Teal, `rounded-lg` is 8px. Change `rounded-lg` to `rounded-full` for a circular button:

Was: `className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"`
Now: `className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"`

The send button (line 84) also changes from `rounded-lg` to `rounded-full`:

Was: `className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"`
Now: `className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"`

- [ ] **Step 2: Update ChatPane — increase message gap, add message-enter animation**

In `ChatPane.tsx` line 80, change `gap-6` to `gap-10`:

Was: `<div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">`
Now: `<div className="mx-auto flex max-w-3xl flex-col gap-10 px-5 py-6">`

Add `animate-message-enter` to the message wrapper. Around line 88-91, the existing className uses `cn()` — add the animation class:

Was:
```tsx
className={cn(
  'transition-[background-color,box-shadow] duration-700',
  highlightedId === m.id && 'bg-accent-subtle ring-2 ring-accent/50',
)}
```
Now:
```tsx
className={cn(
  'animate-message-enter transition-[background-color,box-shadow] duration-700',
  highlightedId === m.id && 'bg-accent-subtle ring-2 ring-accent/50',
)}
```

The error action buttons (lines 124, 132) already have `transition-colors`. Their `bg-accent` and `hover:bg-accent-hover` now resolve to Teal. No change needed.

The "jump to latest" button (line 147) — remove `shadow-pop`, keep `transition-colors`:

Was: `className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-ink-secondary shadow-pop transition-colors hover:bg-surface-muted"`
Now: `className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-ink-secondary transition-colors hover:bg-surface-muted"`

- [ ] **Step 3: Update ChatHeader — add transition-colors to connection dot**

In `ChatHeader.tsx` line 37, add `transition-colors` to the status dot:

Was: `<span className={`h-2 w-2 rounded-full ${DOT[status] ?? DOT.disconnected}`} />`
Now: `<span className={`h-2 w-2 rounded-full transition-colors ${DOT[status] ?? DOT.disconnected}`} />`

In `ChatHeader.tsx` line 49, add `transition-colors` to the reconnect button:

Was: `className="text-[11px] text-accent hover:underline"`
Now: `className="text-[11px] text-accent hover:underline transition-colors"`

The DOT constants (lines 8-12) use Tailwind's default palette (`bg-emerald-500`, `bg-amber-500`, `bg-red-500`). These are functional status indicators — leave them as is.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/ChatPane.tsx src/components/chat/ChatHeader.tsx
git commit -m "feat: refresh chat components — teal send/stop buttons, increased message gap, message-enter animation, remove shadow-pop"
```

---

### Task 7: Chat Components — MessageBubble, FolderPill, TurnTimeline, ThinkingBubble

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: `src/components/chat/FolderPill.tsx:33,43,55`
- Modify: `src/components/chat/TurnTimeline.tsx:33,39,74,82,96`
- Modify: `src/components/chat/ChatHeader.tsx:29` (gap-1.5)

- [ ] **Step 1: Update FolderPill — add transition-colors to interactive buttons**

In `FolderPill.tsx` line 33 (bound folder button), add `transition-colors`:

Was: `className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-surface-muted"`
Now: `className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-surface-muted"`

In `FolderPill.tsx` line 43 (clear folder button), add `transition-colors`:

Was: `className="text-ink-tertiary hover:text-ink"`
Now: `className="text-ink-tertiary hover:text-ink transition-colors"`

In `FolderPill.tsx` line 55 (pick folder button), add `transition-colors`:

Was: `className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[12px] text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary"`
Now: `className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[12px] text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink-secondary"`

- [ ] **Step 2: Update TurnTimeline — add transition-colors to disclosure, delegation, tool rows**

In `TurnTimeline.tsx` line 33 (thinking disclosure), add `transition-colors`:

Was: `className="flex items-center gap-2"`
Now: `className="flex items-center gap-2 transition-colors"`

In `TurnTimeline.tsx` line 74 (turn container), `gap-1.5` is fine — stays unless content feels too tight.

In `TurnTimeline.tsx` line 82 (delegation row), add `transition-colors`:

Was: `className="flex items-center gap-2"`
Now: `className="flex items-center gap-2 transition-colors"`

In `TurnTimeline.tsx` line 96 (tool step row), add `transition-colors`:

Was: `className="flex items-center gap-2"`
Now: `className="flex items-center gap-2 transition-colors"`

- [ ] **Step 3: Update ChatHeader gap**

In `ChatHeader.tsx` line 29, change `gap-1.5` to `gap-2`:

Was: `<div className="flex items-center gap-1.5" data-tauri-drag-region="false">`
Now: `<div className="flex items-center gap-2" data-tauri-drag-region="false">`

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/FolderPill.tsx src/components/chat/TurnTimeline.tsx src/components/chat/ChatHeader.tsx
git commit -m "feat: add transition-colors to folder pills, turn timeline rows; comfortable gap in chat header"
```

---

### Task 8: ArtifactPanel Components

**Files:**
- Modify: `src/components/artifact/ArtifactPanel.tsx:38`
- Modify: `src/components/artifact/FileTree.tsx:43,97,108`
- Modify: `src/components/artifact/AgentCard.tsx:22,23,29,39`
- Modify: `src/components/artifact/ToolCallRow.tsx:33`
- Modify: `src/components/artifact/DiffViewer.tsx:29,63`

- [ ] **Step 1: Update ArtifactPanel TabsTrigger — already uses `bg-accent` in after pseudo** → Teal auto-resolved. No change needed for the tab bar.

The close button (line 38) already uses `Button variant="ghost"`. The ghost variant was updated in Task 3. No change needed.

- [ ] **Step 2: Update FileTree — transition-colors on interactive nodes**

In `FileTree.tsx` line 43 (tree nodes), add `transition-colors`:

Was: Look for `gap-1.5` on the tree node row
Now: Add `transition-colors` alongside the hover class

In `FileTree.tsx` line 97 (select folder button):

Was: `className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"`
The `transition-colors` is already present. `bg-accent` now resolves to Teal. No change needed.

In `FileTree.tsx` line 108 (CWD header), no changes needed — it's a display element.

- [ ] **Step 3: Update AgentCard — add transition-colors to card**

In `AgentCard.tsx` line 22 (card container), add `transition-colors` if the card has hover effects.

Read the file to inspect exact class strings. If the card has `hover:bg-surface-muted` or similar, add `transition-colors`.

- [ ] **Step 4: Update ToolCallRow — add transition-colors to toggle button**

In `ToolCallRow.tsx` line 33 (toggle button), add `transition-colors` alongside existing `transition-transform`:

Was: Look for `py-1.5` on the toggle button
Now: Add `transition-colors` to the className string

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/FileTree.tsx src/components/artifact/AgentCard.tsx src/components/artifact/ToolCallRow.tsx
git commit -m "feat: add transition-colors to artifact panel components"
```

---

### Task 9: Login Screen & Settings Panel

**Files:**
- Modify: `src/routes/LoginScreen.tsx:18`
- Modify: `src/components/account/SettingsPanel.tsx:73`

- [ ] **Step 1: Update LoginScreen hero icon — remove shadow-float**

In `LoginScreen.tsx` line 18, remove `shadow-float`:

Was: `<div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-accent shadow-float">`
Now: `<div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-accent">`

`bg-accent` is now Teal. `rounded-3xl` is now 12px. The hero icon becomes a soft rounded square instead of a hard rectangle.

- [ ] **Step 2: Add transition-shadow to SettingsPanel API key input**

In `SettingsPanel.tsx` line 73, add `transition-shadow`:

Was: `className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"`
Now: `className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/30"`

- [ ] **Step 3: Commit**

```bash
git add src/routes/LoginScreen.tsx src/components/account/SettingsPanel.tsx
git commit -m "feat: remove shadow-float from login hero, add transition-shadow to settings input"
```

---

### Task 10: Verification — Visual Consistency Check

- [ ] **Step 1: Verify no hardcoded shadow-float/shadow-pop remains**

```bash
rg "shadow-float|shadow-pop" src/ --include '*.tsx'
```
Expected: no matches

- [ ] **Step 2: Verify CSS variable changes are effective**

```bash
rg "#111111|#000000" src/styles/tokens.css
```
Expected: only `--text-primary: #111111;` remains (body text is intentionally near-black)

- [ ] **Step 3: Verify base font-size change**

```bash
rg "font-size:\s*14px" src/styles/tokens.css
```
Expected: no matches

- [ ] **Step 4: Verify line-height change**

```bash
rg "line-height:\s*1\.6" src/styles/tokens.css
```
Expected: no matches

- [ ] **Step 5: Build check**

```bash
yarn build
```
Expected: succeeds without errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: final verification — all visual tokens and components aligned"
```
