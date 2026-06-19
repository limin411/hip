# src/components/artifact/ — AGENTS.md

Workspace/"Code" surface panel. Displays file trees, agent dashboards, git diff timelines, and checkpoint management. The largest component directory.

## STRUCTURE

```
artifact/
├── ArtifactPanel.tsx       # Main panel: tab-based (files/agents/timeline/changes), resizable
├── FileTree.tsx             # Directory tree with expand/collapse + file selection
├── FilePreview.tsx          # File content viewer (text, images, PDFs)
├── ChangesView.tsx          # Git diff display: modified files, DiffDisplay, branch/switcher
├── DiffDisplay.tsx          # Unified/split diff rendering
├── TimelineView.tsx         # Agent run timeline with ToolCall details
├── AgentDashboard.tsx       # Sub-agent execution tree (AgentCard + SubAgentCard)
├── AgentCard.tsx            # Agent run card with tool traces
├── SubAgentCard.tsx         # Sub-agent card with task input/output
├── ToolTrace.tsx            # Individual tool call detail view
├── BranchSwitcher.tsx       # Git branch list + switch
├── GitInitBanner.tsx        # "Initialize git" prompt
├── CheckpointList.tsx       # Session checkpoint list with revert
├── CheckpointDiffPreview.tsx# Checkpoint-to-current diff viewer
├── SurfaceTabs.tsx          # Surface tab bar (chat/code switch)
├── FolderInput.tsx          # Working directory input
├── SidebarToggle.tsx        # Sidebar collapse toggle
├── previewKind.ts           # Pure function: determines file preview type
├── previewKind.test.ts      # Test for previewKind
├── SubAgentCard.logic.test.ts # Logic test for sub-agent card
└── ArtifactPanel.logic.test.ts # Logic test for artifact panel
```

## TAB ARCHITECTURE

ArtifactPanel uses internal tab state (not React Router):
- **Files** — `FileTree` + `FilePreview` (resizable split)
- **Agents** — `AgentDashboard` → `AgentCard` → `SubAgentCard` → `ToolTrace`
- **Timeline** — `TimelineView` with `ToolTrace` tool call expansion
- **Changes** — `ChangesView` → `DiffDisplay` + `BranchSwitcher` (git-gated)

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| File operations | `FileTree.tsx` + `FilePreview.tsx` | Uses `useFsStore`, tree expansion state |
| Git diff display | `ChangesView.tsx` + `DiffDisplay.tsx` | Unified/split views, word-level diff |
| Agent execution tree | `AgentDashboard.tsx` | Groups by agent via `groupByAgent()` from `@/lib/turnAgents` |
| Checkpoint management | `CheckpointList.tsx` | List, diff preview, revert |

## NOTES

- Multiple components import from `@/components/chat/` — cross-directory dependency
- `TimelineView.tsx` has one `eslint-disable-line react-hooks/exhaustive-deps` — intentional, watches `diff.checkpoints.length` for revert detection
- `previewKind.ts` is a pure function module with its own test — the pattern for extractable logic
