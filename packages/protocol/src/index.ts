/**
 * @hip/protocol — shared types between the React UI and the Node sidecar.
 * Domain modules are re-exported here for a stable public surface.
 */

export * from './session-core.js'
export * from './execution-mode.js'
export * from './providers-agents.js'
export * from './mcp-config.js'
export * from './hooks.js'
export * from './plugins.js'
export * from './marketplace.js'
export * from './mcp-registry.js'
export * from './skills.js'
export * from './extension-registry.js'
export * from './message-model.js'
export * from './memory-types.js'
export * from './workspace-types.js'
export * from './mcp-resources.js'
export * from './agent-profile.js'
export * from './messages.js'
export * from './session-events.js'
export * from './workflow-protocol.js'
export * from './hip-config.js'
export * from './token-estimation/index.js'
export * from './task-runtime.js'

export {
  normalizeSessionConfig,
  SESSION_CONFIG_DEFAULTS,
  type SessionConfigLike,
  type NormalizedSessionConfig,
} from './session-config.js'
export {
  parseClientMessage,
  isClientMessageType,
  CLIENT_MESSAGE_TYPES,
  type ClientMessageType,
} from './message-guard.js'

export * from './orchestration-types.js'
export * from './team-types.js'
