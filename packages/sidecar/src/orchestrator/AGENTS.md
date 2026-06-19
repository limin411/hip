# packages/sidecar/src/orchestrator/ — AGENTS.md

DAG workflow engine for multi-agent orchestration. Defines `WorkflowDef` (nodes + edges), validates for cycles, reduces events into `RunState`, and executes via `AgentRunner`. Currently defined but **not yet wired** into the session path — the session uses the supervisor→worker pattern directly.

## STRUCTURE

```
orchestrator/
├── index.ts         # Re-exports all modules
├── ports.ts         # Abstractions: AgentRunner, WorkflowStore, OrchestratorEventSink + fakes
├── registry.ts      # AgentRegistry: maps AgentConfig[] → capabilities (streamsReasoning, toolCalls, HITL, modelSwitch)
├── reduce.ts        # Pure event reducer: reduce(state, def, event) — DAG join semantics, template resolution
├── executor.ts      # runWorkflow() — launches ready nodes, fail-fast, skip propagation, abort handling
└── validate.ts      # Cycle detection (DFS 3-color), unknown agents, unreachable nodes, bad templates
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add workflow capability | `registry.ts` | `capabilitiesFor()` maps AgentConfig → capabilities |
| Change DAG semantics | `reduce.ts` | Pure function — conditional edges, skip cascade, `{{input}}` / `{{input.x}}` / `{{nodeId}}` template resolution |
| Run a workflow | `executor.ts` | `runWorkflow()` — event-sink emission, abort signal handling |
| Validate a definition | `validate.ts` | Cycle detection, agent existence, reachability |

## CONVENTIONS

- **Pure reducer**: `reduce()` is stateless — takes `RunState`, returns new `RunState`
- **Fail-fast**: First node failure stops the DAG
- **Template syntax**: `{{input}}` (full input), `{{input.field}}` (nested), `{{nodeId}}` (output of specific node)
- **No side effects**: All I/O via `AgentRunner` port (test with `FakeAgentRunner`)
