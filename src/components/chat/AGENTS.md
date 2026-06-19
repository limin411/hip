# src/components/chat/ — AGENTS.md

Chat surface UI. The primary user interaction area: message display, text input, model/prompt selection, and permission handling.

## STRUCTURE

```
chat/
├── ChatPane.tsx          # Main chat container: message list + input bar + model picker
├── MessageBubble.tsx      # Single message: user bubble, assistant output, tool calls, artifacts
├── ThinkingBubble.tsx     # Collapsible reasoning display (DeepSeek R1 thinking)
├── CodeBlock.tsx          # Syntax-highlighted code blocks (markdown fenced)
├── FolderPill.tsx         # Clickable folder/directory reference
├── StreamingCursor.tsx    # Blinking cursor during streaming
├── TurnTimeline.tsx       # Collapsed turn history strip
├── MessageActions.tsx     # Message action buttons (regenerate, copy)
├── InputBar.tsx           # Input area container
├── Composer.tsx           # Text input with model chips (CwdChip, ModelChip) + send button
├── ComposerChip.tsx       # Composer chip component
├── ModelPicker.tsx        # Model + permission mode selector
├── PermissionModePicker.tsx # Permission mode toggle (chat/edit/full)
├── PermissionModal.tsx    # HITL permission grant/deny dialog
├── FatalErrorPane.tsx     # No-API-key or incompatible model error screen
├── NewConversation.tsx    # Empty-state new conversation prompt
├── ChatTitleBar.tsx       # Session title + surface switcher
├── ModelPicker.logic.test.ts   # Pure logic tests for model picker
├── PermissionModePicker.logic.test.ts # Pure logic tests for permission picker
└── SubAgentCard.logic.test.ts # Pure logic tests for sub-agent display
```

## DATA FLOW

```
Domain hooks (useActiveSession, useActiveMessages, etc.)
  → Store selectors (useUiStore, useDomainStore)
    → Local React state (scroll position, highlightedId, etc.)
      → sessionService imperative calls (send, regenerate, cancel, setSurface)
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Message rendering | `ChatPane.tsx` | Orchestrates 6 domain hooks, streaming state, scroll management |
| Composer input | `Composer.tsx` | Controlled component, `leftSlot` for model chips |
| Model/permission UI | `ModelPicker.tsx` + `PermissionModePicker.tsx` | Model config + HITL mode selection |
| Permission HITL | `PermissionModal.tsx` | Grant/deny dialog for run_script and dispatch_agent |

## NOTES

- `ChatPane.tsx` imports from `@/components/artifact/` for ArtifactCard, SubAgentCard, TurnTimeline — cross-directory dependency
- All messages auto-scroll with `useRef` + `useEffect` for at-bottom detection
- Streaming state managed via `useDomainStore((s) => s.streaming.get(sessionId))`
