# packages/sidecar/src/session/ — AGENTS.md

Core LangGraph agent runtime. The `Session` class (904 lines) is the integration hub, importing from all sibling subdirectories (agents/, mcp/, skills/) and utility modules (workspace-fs, workspace-git, tools, compaction, etc.).

## OVERVIEW

Each `Session` instance manages one AI agent conversation: LangGraph loop, model building, tool execution, external agent dispatch, git checkpoints, permission HITL, and turn lifecycle.

## STRUCTURE

```
session/
├── session.ts                  # Session class (904 lines) — central orchestrator
├── session-manager.ts          # Message router: processes all ClientMessage types
├── graph.ts                    # LangGraph StateGraph: compact → agent → tools → nudge/pause
├── tools.ts                    # Tool definitions (500 lines): file ops, bash, git, task, dispatch_agent, MCP tools
├── agent-profile.ts            # AgentProfile interface + built-in profiles (supervisor/plan/explore/worker)
├── agent-profile-manager.ts    # Dual-layer agent profile config: ~/.hip/config/agents.json + .hip/agents.json
├── context-fragment.ts         # ContextFragment interface + FragmentRegistry for composable prompt assembly
├── fragments/                  # ContextFragment implementations (system, skills, time, token-budget, subagent)
├── hooks/                      # Hook registry + lifecycle event implementations
│   ├── registry.ts             # HookRegistry: fire, aggregate, matcher support
│   ├── README.md               # Hook event reference (9 events incl. Stop, PermissionRequest)
│   └── ...tests
├── model-factory.ts            # buildChatModel(), ReasoningChatOpenAI (DeepSeek reasoning extraction)
├── model-runner.ts             # RealModelRunner: streams deltas, retries before first token
├── subagent.ts                 # runSubagent(): depth-1 worker, same tools minus task/dispatch
├── internal-runner.ts          # runManagedAgent(): dispatched internal agent with narrowed tools
├── workspace-fs.ts             # File system: lsDir, readForPreview, path jail + symlink guard
├── workspace-git.ts            # Git operations (516 lines): diff parsing, checkpoints, branches, revert
├── system-prompt.ts            # System prompt builder: supervisor, child, managed agent variants
├── compaction.ts               # Context summarization when token budget exceeded
├── doom-loop.ts                # Detect repeating tool-call batches → nudge → pause
├── loop-control.ts             # Limits: MAX_STEPS=25, CHILD_MAX_STEPS=15
├── verify.ts                   # Phantom-write detection (claimed vs. actual write_file calls)
├── scratch.ts                  # Per-session temp workspace management
├── tool-trace.ts               # ReasoningTracker, trajectory collection
├── idle-watchdog.ts            # 60s idle timeout → abort turn
├── surface.ts                  # surfaceOf(): chat vs code classification
├── usage.ts                    # Token counting helpers
├── retry.ts                    # withRetry(), isRetryable()
├── agents/                     # External agent providers → AGENTS.md
├── mcp/                        # MCP client pool → manager.ts, json-schema-to-zod.ts
└── skills/                     # Skill registry → registry.ts, frontmatter.ts
```

## WHERE TO LOOK

| Task | File | Key method/export |
|------|------|-------------------|
| Session lifecycle | `session.ts` | `sendMessage()`, `runTurn()`, `destroy()`, `hydrate()` |
| Message routing | `session-manager.ts` | `handleAsync()` — exhaustive switch on 27 ClientMessage types |
| Agent loop | `graph.ts` | `buildGraph()` → compiled StateGraph |
| Tool set | `tools.ts` | `buildTools()` — permission-mode gated |
| Agent profiles | `agent-profile.ts`, `agent-profile-manager.ts` | `BUILTIN_PROFILES`, `AgentProfileManager.resolveConfig()` |
| Context fragments | `context-fragment.ts`, `fragments/` | `FragmentRegistry.assemble()` |
| Hooks | `hooks/registry.ts`, `hooks/README.md` | `HookRegistry.fire()`, 9 lifecycle events |
| Plan profile | `graph.ts`, `plan-profile.test.ts` | `routeAfterCompact()`, `planNode` |
| Git operations | `workspace-git.ts` | `collectWorkspaceDiff()`, `captureCheckpoint()`, `revertToCheckpoint()` |
| System prompt | `system-prompt.ts` | `buildSystemPrompt()`, `childSystemPrompt()` |
| Doom loop detection | `doom-loop.ts` | Nudge after 3 identical tool-call batches |
| Phantom writes | `verify.ts` | Regex claim detection vs. actual write_file executions |

## ANTI-PATTERNS

- **Session.ts is a god file** (904 lines, 30+ methods). Couples 15+ subsystems. Refactor target — extract concerns (git, permissions, title generation) into separate modules
- **NEVER touches HEAD/index** — `workspace-git.ts` checkpoint restore writes to temp index first
- **Never throws** — Most public methods return `{ ok: false, error }` instead of throwing
