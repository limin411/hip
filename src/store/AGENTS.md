# src/store/ — AGENTS.md

Zustand stores for client-side state management. 11 independent stores (no Zustand slices pattern). 5 stores use Tauri IPC for persistence; 2 use Zustand `persist` middleware for localStorage.

## STORES

| Store | LOC | Persistence | IPC | Purpose |
|-------|-----|-------------|-----|---------|
| `providersStore.ts` | 130 | Tauri invoke | 6 IPC modules | Provider catalog, API keys, sidecar restart on key change |
| `uiStore.ts` | 115 | Zustand persist | none | UI layout: panels, tabs, views, scroll target |
| `diffStore.ts` | 94 | In-memory | none | Per-session git diff state, checkpoints, branches |
| `draftStore.ts` | 79 | Zustand persist | none | New-conversation draft (text, model, cwd, permission mode) |
| `skillsStore.ts` | 46 | Tauri invoke | 5 IPC fns | Skill list, enable/disable, install/remove |
| `fsStore.ts` | 43 | In-memory | none | Per-session file tree + file preview |
| `agentsStore.ts` | 39 | Tauri invoke | 2 IPC fns | ACP agent config CRUD |
| `mcpServersStore.ts` | 37 | Tauri invoke | 2 IPC fns | MCP server config CRUD |
| `detectionStore.ts` | 27 | Tauri invoke | 1 IPC fn | Binary detection (installed ACP agents) |
| `useFsScope.ts` | 27 | Derived | none | Cross-store hook composing draftStore + domain session |
| `authStore.ts` | 16 | localStorage | none | Demo mock auth (NOT real OAuth) |

## PATTERNS

- **`create<T>()(...)`**: All stores use standalone Zustand `create()`. No slices pattern
- **`persist` middleware**: Only `uiStore` (partial — codeSessionId) and `draftStore` (full draft) use Zustand persist
- **`createJSONStorage` with `memoryStorage()` fallback**: For Node.js test environments without localStorage
- **Session-keyed pattern**: `diffStore` and `fsStore` use `bySession: Record<string, T>` with a `patch()` helper for immutable updates
- **IPC-backed stores**: Follow load→getState→mutate→persist→setState pattern
- **Cross-store orchestration**: Happens in `src/domain/sessionService.ts`, NOT in stores directly

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Cross-store composition | `useFsScope.ts` | Only file importing another store (draftStore) |
| IPC-backed store pattern | `providersStore.ts` | Most complex: 6 IPC modules + sidecar restart |
| Persist middleware example | `uiStore.ts` | Partial persist via `partialize` |
| Session-keyed state | `diffStore.ts` | `bySession` map with `patch()` helper |

## NOTES

- `authStore.ts` is labeled demo/mock — bypasses Zustand patterns, writes localStorage directly
- `panelLifecycle.test.ts` in this directory tests `store` reactivity patterns, not a specific store
