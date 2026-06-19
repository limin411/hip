# src/components/ — AGENTS.md

React component tree. 8 feature directories, 78 component files. Uses Zustand stores for global state, domain hooks for session-scoped state, and local `useState`/`useRef` for transient UI.

## STRUCTURE

```
components/
├── chat/        # Chat UI: messages, composer, model picker, permissions → AGENTS.md
├── artifact/    # Workspace panel: file tree, preview, agent dashboard, git changes → AGENTS.md
├── account/     # Settings: providers, agents, MCP, skills (14 files)
├── sidebar/     # Session list sidebar: search, peek overlay (7 files)
├── ui/          # Shared primitives: Button, Modal, Tabs, DropdownMenu (12 files)
├── layout/      # App chrome: TitleBar, ChatTitleBar, SidebarToggle (3 files)
├── rail/        # Left menu rail: navigation buttons (2 files)
└── login/       # Login page: HipLogo, AuthButton (2 files)
```

## PATTERNS

- **No barrel exports**: No `index.ts` — all imports are direct file-to-file
- **All named exports**: Zero `export default`
- **i18n everywhere**: Every component uses `useTranslation()` from `react-i18next`
- **State management**: Three-tier — Zustand stores (global) + domain hooks (session-scoped) + local useState (transient)
- **Props typing**: Inline interfaces, no separate type files
- **CSS variables only**: All colors via `var(--surface)`, `var(--accent)`, etc.
- **Chinese comments**: Many inline comments in Chinese (设计意图 inline docs)

## UI PRIMITIVES (`ui/`)

shadcn/Radix-style thin wrappers. All use `cn()` for class merging:
- **Compound components**: `DropdownMenu.*`, `Tabs.*`, `ContextMenu.*` mirror Radix API
- **`forwardRef`**: Used where Radix expects ref forwarding
- **`cva`**: Button uses `class-variance-authority` for variant management (primary/secondary/ghost/outline/danger × sm/md/lg/icon)
- **Custom hook**: `useResizableBox.ts` — pointer-event drag resize

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Chat pane | `chat/ChatPane.tsx` | Uses 6 domain hooks + 3 stores + sessionService |
| Composer | `chat/Composer.tsx` | Controlled input with `leftSlot` composition |
| Artifact panel | `artifact/ArtifactPanel.tsx` | Tab-based (files/agents/timeline/changes), resizable panels |
| Settings page | `account/SettingsPage.tsx` | Overlay when `activeView === 'settings'` |
| Session list | `sidebar/Sidebar.tsx` | Search, peek overlay, delete/rename |

## ANTI-PATTERNS

- **Hardcoded fake user**: `rail/MenuRail.tsx:22` — `const currentUser = { name: 'User', email: 'user@example.com' }` (TODO: replace when real auth implemented)
- **No component tests**: Only 4 logic test files for 74 `.tsx` components — all are pure-logic extraction (`.logic.test.ts`), not render tests
