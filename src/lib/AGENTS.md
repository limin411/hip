# src/lib/ — AGENTS.md

Pure utility functions. 25 modules, all with co-located tests (`foo.ts` → `foo.test.ts`). No React, no state, no side effects — just data transforms, filters, formatters, and type guards used across the frontend.

## STRUCTURE

```
lib/
├── datetime.ts           # formatClockTime, formatAbsolute, formatRelativeTime (locale-aware)
├── sessions.ts           # filterSessions, filterBySurface, surfaceOf
├── agentTools.ts         # grantedMcpServerIds (back-compat parser)
├── agentCategory.ts      # Agent category label lookup
├── agentDraft.ts         # Draft creation helpers
├── agentFilters.ts       # Filter agents by type/status/ownership
├── agentModelOptions.ts  # Model selection helpers
├── checkpointMode.ts     # Checkpoint mode label/formatter
├── diffSplit.ts          # Split git diffs by file
├── hoverPeek.ts          # Peek content extraction for hover cards
├── modelBadges.ts        # Model capability badge computation
├── modelFilter.ts        # Filter models by provider/capability
├── modelKey.ts           # Model key normalization/serialization
├── mcpServerDraft.ts     # MCP server draft helpers
├── providerGroups.ts     # Group providers by category
├── renderedArtifacts.ts  # Artifact rendering transforms
├── roleColor.ts          # Agent role → color mapping
├── snippet.ts            # Code snippet extraction/trimming
├── timelineFilter.ts     # Timeline event filtering
├── todos.ts              # Todo item parsing/matching
├── turnAgents.ts         # Agent attribution from turn data
├── usageCost.ts          # Token usage / cost computation
├── utils.ts              # General-purpose: clamp, slugify, debounce
├── wordDiff.ts           # Word-level diff computation
└── acpPresets.ts         # ACP agent preset definitions
```

## PATTERNS

- **1:1 test co-location**: Every `foo.ts` has `foo.test.ts` in same directory
- **Named exports only**: Zero `export default`
- **Pure functions only**: No React hooks, no Zustand stores, no DOM access, no side effects
- **No barrel**: No `index.ts` — consumers import directly (`import { filterSessions } from '@/lib/sessions'`)
- **Small modules**: Most <40 lines. Each module does ONE thing.
- **Generic where useful**: `filterSessions<T extends { title, preview }>` etc.

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Session search/filter | `sessions.ts` | `filterSessions()`, `filterBySurface()` |
| Time formatting | `datetime.ts` | `formatRelativeTime()`, `formatClockTime()` — Intl-aware |
| Model/provider filtering | `modelFilter.ts`, `providerGroups.ts` | Used in model picker dropdowns |
| Diff rendering | `diffSplit.ts`, `wordDiff.ts` | Git diff → artifact panel transforms |
| Token cost calculation | `usageCost.ts` | Usage stats → cost display |
| General utilities | `utils.ts` | `clamp()`, `slugify()`, `debounce()` |

## NOTES

- `agentTools.ts` is back-compat only — parses legacy `allowedTools` arrays for old internal agent configs. New code uses `allowedMcpServers` directly.
- Tests are co-located unit tests — fast, no sidecar or browser needed.
- Chinese JSDoc comments on many functions (项目注释惯例).
