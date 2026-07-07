import { FIXED_AGENT_IDS } from '@hip/protocol'

/**
 * Three fixed, non-deletable internal agents.
 *
 * These are NOT stored in hip.toml's `agents` array. Their enable/disable
 * state is persisted under `[fixedAgents]` in hip.toml.
 *
 * Tool restrictions mirror the corresponding sidecar AgentProfile entries
 * (see packages/sidecar/src/session/agent-profile.ts).
 */
export { FIXED_AGENTS } from '@hip/protocol'

export { FIXED_AGENT_IDS }
