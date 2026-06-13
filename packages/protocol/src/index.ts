export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer'

export interface SessionConfig {
  llmProvider: string          // provider id (was the 'deepseek' literal)
  model: string
  baseURL?: string             // resolved OpenAI-compatible base URL for the provider
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
  thinking?: boolean           // DEPRECATED: retained for back-compat; no longer swaps models
  language?: 'en' | 'zh-CN' | 'zh-TW'
}

/** Global current model the whole app uses. */
export interface ActiveModel {
  providerID: string
  modelID: string
  baseURL: string              // always resolved; sidecar falls back to DEEPSEEK_DEFAULT when unknown
}

/** One provider's non-secret config (the key lives only in ~/.hip/config/auth.json). */
export interface ProviderConfigEntry {
  enabled: boolean
  baseURL?: string             // catalog default or user override; required for custom
  custom?: { name: string }    // present iff user-defined (not in the models.dev catalog)
}

/** Durable, non-secret provider config persisted to ~/.hip/config/hip-providers.json. */
export interface ProvidersConfig {
  providers: Record<string, ProviderConfigEntry>
  activeModel?: Pick<ActiveModel, 'providerID' | 'modelID'>   // baseURL resolved at read time
}

/** auth.json key name AND env var name for a provider's API key. Single source of the rule. */
export function providerKeyEnv(providerID: string): string {
  return `HIP_MODEL_${providerID.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
  stopped?: boolean // assistant turn was cancelled mid-stream; partial content kept
  timeline?: TimelineStep[]  // ordered reasoning+tool steps for this turn (assistant only)
  toolCalls?: ToolCall[]     // flat tool calls for this turn, referenced by timeline tool steps via callId
  agentRuns?: AgentRun[]     // per-agent run metadata for THIS turn (taskInput/output/timing/parent)
}

export interface AgentRun {
  agentId: string
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
  taskInput?: string        // instruction this sub-agent received
  parentAgentId?: string    // who delegated (always 'supervisor' for our 2-level tree)
  toolCalls?: ToolCall[]     // ordered by seq; hydrated from the tool_calls table
  messageId?: string         // turn this run belongs to (maps agent_runs.message_id; NULL → no assistant message)
}

export type ToolStatus = 'running' | 'finished' | 'error'

export interface ToolCall {
  callId: string
  agentId: string          // who called it: supervisor | planner | coder | reviewer
  name: string             // 'read_file' | 'write_file' | 'edit_file' | … (never 'task')
  input: string            // JSON-stringified args; clipped to ~4 KB if huge
  output?: string          // JSON-stringified result; absent while running
  status: ToolStatus
  error?: string
  seq: number              // monotonic per turn → deterministic ordering
  truncated?: boolean      // input and/or output was clipped; sticky-OR
}

/**
 * One step in an assistant turn's execution trace. `stepSeq` is a single
 * turn-global monotonic counter shared across reasoning and tool steps, so a
 * timeline interleaves them in true wall-clock order. A 'tool' step carries no
 * payload — it references a ToolCall (on Message.toolCalls) by callId.
 */
export type TimelineStep =
  | { kind: 'reasoning'; stepSeq: number; agentId: string; role: AgentRole; content: string; truncated?: boolean }
  | { kind: 'tool'; stepSeq: number; agentId: string; role: AgentRole; callId: string }

export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
}
export interface SearchHit {
  sessionId: string
  messageId: string | null
  title: string
  snippet: string
  timestamp: number
}

/** One immediate child of a directory. `path` is a real absolute host path. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
}

export type DiffLineType = 'add' | 'del' | 'ctx'

/** One rendered diff line. `oldNo`/`newNo` are 1-based; null on the side the line doesn't exist. */
export interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
}

/** One changed file in the workspace diff. `path` is cwd-relative for display. */
export interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
  truncated?: boolean   // per-file line cap (or untracked read cap) hit
  binary?: boolean      // binary change — lines is empty
}

/** Outcome of a workspace diff request. */
export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'

export type ClientMessage =
  | { type: 'session:create'; id: string; config: SessionConfig }
  | { type: 'session:destroy'; sessionId: string }
  | { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user' }
  | { type: 'message:cancel'; sessionId: string }
  | { type: 'message:regenerate'; sessionId: string }
  | { type: 'message:resume'; sessionId: string; content: string }
  | { type: 'session:list' }
  | { type: 'session:load'; sessionId: string }
  | { type: 'session:search'; query: string }
  | { type: 'session:delete'; sessionId: string }
  | { type: 'session:rename'; sessionId: string; title: string }
  | { type: 'session:setCwd'; sessionId: string; cwd: string }
  | { type: 'session:setThinking'; sessionId: string; thinking: boolean }
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'config:setActiveModel'; providerID: string; modelID: string; baseURL: string }
  | { type: 'fs:ls'; sessionId: string; path: string }
  | { type: 'fs:read'; sessionId: string; path: string }
  | { type: 'fs:lsCwd'; cwd: string; path: string }
  | { type: 'fs:readCwd'; cwd: string; path: string }
  | { type: 'fs:diff'; sessionId: string }
  | { type: 'fs:gitInit'; sessionId: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'agent:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; parentAgentId?: string; taskInput?: string }
  | { type: 'token:stream'; sessionId: string; turnId: string; agentId: string; delta: string }
  | { type: 'agent:finished'; sessionId: string; turnId: string; agentId: string }
  | { type: 'reasoning:delta'; sessionId: string; turnId: string; agentId: string; role: AgentRole; stepSeq: number; delta: string }
  | { type: 'tool:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; callId: string; name: string; input: string; seq: number; truncated?: boolean }
  | { type: 'tool:finished'; sessionId: string; turnId: string; agentId: string; callId: string; status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }
  | { type: 'session:thinking'; sessionId: string; thinking: boolean }
  | { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'config:activeModel'; providerID: string; modelID: string; hasApiKey: boolean }
  | { type: 'message:complete'; sessionId: string; message: Message }
  | { type: 'agent:interrupt'; sessionId: string; turnId: string; agentId: string; question: string; context?: string }
  | { type: 'error'; sessionId?: string; code: string; message: string }
  | { type: 'ready'; hasApiKey: boolean }
  | { type: 'session:list:result'; sessions: SessionSummary[] }
  | { type: 'session:loaded'; sessionId: string; messages: Message[]; config?: SessionConfig }
  | { type: 'session:search:result'; query: string; hits: SearchHit[] }
  | { type: 'session:deleted'; sessionId: string }
  | { type: 'session:title'; sessionId: string; title: string }
  | { type: 'session:cwd'; sessionId: string; cwd: string }
  | { type: 'fs:ls:result'; sessionId: string; path: string; entries: FsEntry[]; error?: string }
  | { type: 'fs:read:result'; sessionId: string; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }
  | { type: 'fs:lsCwd:result'; cwd: string; path: string; entries: FsEntry[]; error?: string }
  | { type: 'fs:readCwd:result'; cwd: string; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }
  | { type: 'fs:diff:result'; sessionId: string; state: DiffState; files?: DiffFile[]; totalFiles?: number; error?: string }
  | { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }
