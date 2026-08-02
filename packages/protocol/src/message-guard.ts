/**
 * Known ClientMessage `type` discriminators.
 * Keep in sync with ClientMessage in index.ts — contract tests catch drift.
 */
export const CLIENT_MESSAGE_TYPES = [
  'session:create',
  'session:destroy',
  'message:send',
  'input:enqueue',
  'input:steer',
  'message:cancel',
  'message:regenerate',
  'message:resume',
  'session:list',
  'session:load',
  'session:search',
  'session:delete',
  'session:softDelete',
  'session:restore',
  'session:trash:list',
  'session:trash:empty',
  'session:trash:purge',
  'session:rename',
  'session:setCwd',
  'session:setThinking',
  'session:setEffort',
  'session:setSystemPrompt',
  'session:setPermissionMode',
  'session:setForcePlan',
  'session:setExecutionMode',
  'session:setAgent',
  'session:setModel',
  'config:setActiveModel',
  'config:testProvider',
  'fs:ls',
  'fs:read',
  'fs:lsCwd',
  'fs:readCwd',
  'fs:diff',
  'fs:diffSummary',
  'fs:diffFile',
  'fs:gitInit',
  'git:checkpoint:list',
  'git:commitLog',
  'git:branch:list',
  'git:branch:switch',
  'permission:respond',
  'agent:setConfigOption',
  'plugin:install:url',
  'plugin:install:github',
  'plugin:delete',
  'plugin:reload',
  'extension:inspect',
  'extension:preflight',
  'workflow:run',
  'workflow:getActive',
  'mcp:listResources',
  'mcp:readResource',
  'mcp:listPrompts',
  'mcp:getPrompt',
  'mcp:reconnect',
  'plan:respond',
  'session:setOrchMode',
  'agent:setProfile',
  'subagent:background',
  'subagent:resume',
  'replay:session',
  'message:compact',
  'memory:list',
  'memory:get',
  'memory:upsert',
  'memory:delete',
  'memory:deleteBySourceSession',
  'memory:restore',
  'memory:emptyTrash',
  'memory:export',
  'memory:import',
  'memory:getConfig',
  'memory:setConfig',
  'memory:consolidate',
  'memory:reindex',
  'memory:indexStatus',
  'memory:getStatus',
  'memory:rewriteMirrors',
  'memory:importMirror',
  'session:setMemoryFlags',
  'ui:emptyGreeting:generate',
  'task:list',
  'task:stop',
  'task:getOutput',
] as const

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number]

const CLIENT_TYPE_SET: ReadonlySet<string> = new Set(CLIENT_MESSAGE_TYPES)

/** True when `type` is a known ClientMessage discriminator. */
export function isClientMessageType(type: unknown): type is ClientMessageType {
  return typeof type === 'string' && CLIENT_TYPE_SET.has(type)
}

/**
 * Structural gate for inbound WS payloads before they enter SessionManager.
 * Validates that raw JSON is a non-null object with a known `type` string.
 * Does not deep-validate every field (that would duplicate the type system);
 * rejects garbage that would otherwise land in the wrong switch branch.
 */
export function parseClientMessage(raw: unknown): { type: ClientMessageType } & Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const type = (raw as { type?: unknown }).type
  if (!isClientMessageType(type)) return null
  return raw as { type: ClientMessageType } & Record<string, unknown>
}
