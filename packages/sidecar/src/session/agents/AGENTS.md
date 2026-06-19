# packages/sidecar/src/session/agents/ — AGENTS.md

External agent providers. The factory (`index.ts`) creates an `AgentProvider` for each agent type. Primary implementation: **AcpAgentProvider** (native ACP JSON-RPC over stdio).

## OVERVIEW

Agents are configured in `~/.hip/config/hip-agents.json` (Rust-managed). The sidecar reads this via `HIP_AGENTS_PATH` env var. Each agent can be `kind: 'acp'` (OpenCode/Kimi) or `kind: 'internal'` (managed sub-agent).

## STRUCTURE

```
agents/
├── index.ts            # createAgentProvider() factory
├── types.ts            # AgentProvider interface + ExternalAgentHooks
├── invoker.ts          # createAgentInvoker() — dispatches to internal or external
├── registry.ts         # readAgentsConfig() from HIP_AGENTS_PATH, resolveAgentModel()
├── acp-provider.ts     # AcpAgentProvider: multiplexed ACP sessions over warm child processes
├── acp-connection.ts   # Warm ClientSideConnection pool, init/auth, permission forwarding
├── acp-config.ts       # Builds command/args/env for ACP child processes
├── acp-quirks.ts       # Per-provider behavioral workarounds (cancel, model defaults)
└── __fixtures__/       # Mock agent scripts for provider testing
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| ACP session lifecycle | `acp-provider.ts` | Init → runTurn → dispose; supports resume/reconnect |
| ACP child spawn | `acp-config.ts` | Self-managed — no model/key injection from hip |
| Permission forwarding | `acp-provider.ts` | Translates ACP permission:request → GraphEmit |
| Agent narrowing | `invoker.ts` | Per-agent skills/MCP whitelist from AgentConfig |
| Mock agents for tests | `__fixtures__/` | mock-acp-agent.mjs |

## CONVENTIONS

- **ACP agents self-manage models/auth** — hip no longer pushes model config (model rollback)
- **Warm process pool**: ACP connections are pre-created, multiplexed per session
- **Never throws**: `connectAll()` skips failing servers with a log
