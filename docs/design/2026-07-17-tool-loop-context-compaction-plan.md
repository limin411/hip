# Tool-Loop Context Compaction — Plan

| Field | Value |
|-------|-------|
| **Spec** | [`2026-07-17-tool-loop-context-compaction-spec.md`](./2026-07-17-tool-loop-context-compaction-spec.md) |
| **Status** | M1/M2 implemented (2026-07-17) |

## Locked decisions

1. Prune protect ≈ 8 rounds (message window 24)  
2. Summary = SystemMessage + `[对话摘要]`  
3. Prune default **on** (`HIP_COMPACTION_PRUNE=0` to disable)  
4. Subagent compact budget **32k**  
5. Partial-on-error in same ship  

## Implementation map

| Item | Files |
|------|--------|
| Tool-round compact | `compaction.ts` |
| Prune default on | `micro-compaction.ts`, `graph.ts` compactNode |
| Subagent 32k | `subagent.ts`, `internal-runner.ts` |
| Partial error | `session-turn-runner.ts` spawn + dispatch catch |
| Tests | `compaction.test.ts`, `micro-compaction.test.ts` |

## Done checklist

- [x] tool-round fallback when few HumanMessages  
- [x] prune every compactNode step (not blocked by `compacted`)  
- [x] LLM compact can re-run after more tool rounds  
- [x] subagent/explore `buildGraph(..., 32_000)`  
- [x] partial research on subagent model failure  
- [x] unit tests green  
