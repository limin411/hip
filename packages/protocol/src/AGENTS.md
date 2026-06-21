# @hip/protocol — AGENTS.md

Single-file shared WebSocket message type package consumed as raw `.ts` source by frontend (Vite alias) and sidecar (NodeNext). Zero runtime deps, zero build step.

## OVERVIEW

A 710-line TypeScript module exporting ~81 type/interface/enum definitions that both the React frontend and the Node.js sidecar import directly. All inter-process communication flows through the `ClientMessage` and `ServerMessage` discriminated unions defined here.

## STRUCTURE

```
src/
├── index.ts                       # 710 lines, 81 exports — the entire public surface
├── index.contract.test.ts         # Exhaustive type-guard tests for ClientMessage/ServerMessage/SessionEvent unions
├── hipConfig.contract.test.ts     # HipConfig shape + serialization roundtrip contract
├── agent-config.test.ts           # AgentConfig + AgentDescriptor type checks
├── acp-messages.test.ts           # ACP protocol message contract tests
├── mcpSkills.contract.test.ts     # McpServerConfig + SkillMeta/SkillEntry contract
├── permissionMode.contract.test.ts # PermissionMode + PermissionRequestPayload contract
├── orchestration-types.test.ts    # WorkflowDef + OrchestratorEvent contract
└── subagent-protocol.test.ts      # SubagentMode + agent frame protocol contract
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add WS message type | `index.ts` → `ClientMessage` union or `ServerMessage` union | Discriminated by `.type`; both sides must handle every variant |
| Add shared config type | `index.ts` → `HipConfig`, `ProviderEntry`, `McpServerConfig`, `AgentConfig`, `SkillEntry` | Serialized as JSON between frontend ↔ sidecar |
| Protocol contract tests | `index.contract.test.ts` | Type-guard patterns that break `tsc` when union variants change |
| Permission mode logic | `index.ts` → `PermissionMode` (`'chat'` / `'edit'` / `'full'`), `PermissionRequestPayload` | `undefined` ⇒ treated as `'edit'` for back-compat |
| Agent config shape | `index.ts` → `AgentConfig`, `AgentDescriptor`, `AgentCapabilities` | Used by frontend provider forms and sidecar agent factory |
| Session lifecycle types | `index.ts` → `SessionConfig`, `SessionEvent` union, `Message` | Session init params + event-sourced message types |

## CONVENTIONS

- **Module resolution**: `NodeNext` — sidecar imports MUST use `.js` extension. Frontend uses Vite `bundler` resolver (no extension needed).
- **Pure types/values**: No async, no file I/O, no process access. Types and simple data objects only.
- **No runtime dependencies**: Zero `dependencies` in `package.json`. A leaf in the dependency graph.
- **Discriminated unions**: `ClientMessage`, `ServerMessage`, `SessionEvent` use string `type` discriminant for exhaustive switches on both sides.
- **Test suffix**: `*.contract.test.ts` for protocol shape contracts. Tests verify union exhaustiveness at compile time.
- **Serializable constraint**: Every type crossing the WebSocket must be JSON-serializable. No `Date`, `BigInt`, `Map`, `Set`, or class instances.
- **`@deprecated` tolerance**: Deprecated fields (e.g. `toolPermissions`) are kept for back-compat but ignored at runtime.

## ANTI-PATTERNS

- **Don't add sidecar-specific or frontend-specific logic here.** Type-only. Shared runtime utilities belong in a separate package.
- **Don't add non-serializable fields to JSON-crossing types.** Class instances silently break across the WS boundary.
- **Don't remove or rename union variants without updating both sides.** A removed `ServerMessage` variant still dispatched by sidecar causes silent drops.
- **Don't add non-`@hip/protocol` imports.** This package has no deps and must stay that way.

## NOTES

- Consumed as source: `"main": "src/index.ts"` in `package.json`. Vite aliases `@hip/protocol` to this path; sidecar imports via tsx/NodeNext.
- Contract tests assert union exhaustiveness at compile time: adding a `ClientMessage` variant without a matching type-guard arm is a `tsc` error.
- `ClientMessage` and `ServerMessage` are the only two top-level WS unions; all other types are nested within these or are config shapes.
- Config types (`HipConfig`, `ProviderEntry`, etc.) are shared between frontend settings form, Rust shell, and sidecar.
