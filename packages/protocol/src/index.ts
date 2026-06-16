export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer' | 'worker' | 'subagent'

export interface SessionConfig {
  llmProvider: string          // provider id (was the 'deepseek' literal)
  model: string
  baseURL?: string             // resolved OpenAI-compatible base URL for the provider
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
  thinking?: boolean           // DEPRECATED: retained for back-compat; no longer swaps models
  language?: 'en' | 'zh-CN' | 'zh-TW'
  agentId?: string             // undefined / 'builtin' => built-in hip agent; else an AgentConfig.id
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

export type AgentTransport = 'thin' | 'rich'

/** acp only: who supplies the model + API key to the external agent. */
export type AgentAuthMode = 'hip-managed' | 'opencode-self'

/** Which configured model an external agent should use. References hip-providers.json. */
export interface BoundModel { providerID: string; modelID: string }

export interface AgentConfig {
  id: string                          // nanoid
  name: string                        // display name
  description?: string                // when-to-use text shown to hip's dispatch tool + the agent card
  kind: 'custom' | 'opencode' | 'acp' | 'internal' // selects the provider/runtime
  command: string                     // executable (PATH name or absolute path); '' for internal
  args: string[]                      // static launch args; [] for internal
  transport: AgentTransport
  acceptsModelConfig: boolean
  boundModel?: BoundModel             // required iff acceptsModelConfig and the user picked a model; internal: the agent's model (unset ⇒ global active)
  authMode?: AgentAuthMode            // acp only: who supplies the model+key (default 'opencode-self')
  quirks?: string                     // acp only: per-agent quirk-profile key (e.g. 'opencode')
  env?: Record<string, string>        // advanced manual env overrides
  prompt?: string                     // internal only: the persona system prompt (required for kind 'internal')
  allowedTools?: string[]             // internal only: tool-name allow-list; undefined ⇒ full default set
  enabled: boolean
}

export interface AgentsConfig { agents: AgentConfig[] }

// ──────────────────────────────────────────────────────────────────
// MCP server config (persisted to ~/.hip/config/hip-mcp-servers.json)
// ──────────────────────────────────────────────────────────────────

/** Transport hip uses to reach an MCP server. */
export type McpTransport = 'stdio' | 'sse' | 'http'

/** One user-configured MCP server. stdio uses command/args/env; sse/http use url/headers. */
export interface McpServerConfig {
  id: string                          // nanoid
  name: string                        // display name
  transport: McpTransport
  command?: string                    // stdio: executable (PATH name or absolute path)
  args?: string[]                     // stdio: launch args
  env?: Record<string, string>        // stdio: child-process env overrides
  url?: string                        // sse/http: endpoint URL
  headers?: Record<string, string>    // sse/http: request headers (e.g. Authorization)
  enabled: boolean
}

/** Durable MCP server config persisted to ~/.hip/config/hip-mcp-servers.json. */
export interface McpServersConfig { servers: McpServerConfig[] }

// ──────────────────────────────────────────────────────────────────
// Skills (Claude-format SKILL.md folders under ~/.hip/skills)
// ──────────────────────────────────────────────────────────────────

/** One installed skill, scanned from ~/.hip/skills/<id>/SKILL.md frontmatter. */
export interface SkillMeta {
  id: string                          // folder slug under ~/.hip/skills
  name: string                        // frontmatter `name`
  description: string                 // frontmatter `description`
  dir: string                         // absolute skill directory
  hasScripts: boolean                 // true iff the skill ships a scripts/ dir (run_script hint)
}

/** Skill enable/disable overrides, persisted to ~/.hip/config/hip-skills.json. A missing id is treated as enabled. */
export interface SkillsConfig { enabled: Record<string, boolean> }

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
  usage?: TurnUsage          // turn total = sum of agentRuns' usage; present once usage was reported
}

/** Provider-reported token counts for a turn or a single agent's slice of it.
 *  Counts only — $ cost is computed in the renderer from the models.dev catalog price. */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** One agent-advertised session config selector (model/mode/reasoning level). */
export interface AcpConfigOption {
  id: string
  name: string
  category?: 'model' | 'mode' | 'thought_level' | string
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

/** The tool a permission request is gating, rendered in the HITL modal. */
export interface PermissionRequestPayload {
  title: string
  kind: string                      // read|edit|delete|execute|fetch|other
  diff?: { path: string; oldText: string; newText: string }
  content?: string
}

/** Identifies a dispatched sub-agent when its work surfaces in a parent's turn (nested HITL, frames). */
export interface AgentFrame {
  agentId: string
  parentAgentId: string
  name: string
}

/** A choice the agent offers for a permission request. */
export interface PermissionOption {
  optionId: string
  name: string
  kind: string                      // allow_once|allow_always|reject_once|reject_always
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
  usage?: TurnUsage          // this agent's token counts for the turn (hydrated from agent_runs.*_tokens)
}

export type ToolStatus = 'running' | 'finished' | 'error'

export interface ToolCall {
  callId: string
  agentId: string          // who called it: supervisor | a sub-agent (e.g. worker-1)
  name: string             // 'read_file' | 'write_file' | 'edit_file' | 'task' | … ('task' delegations are valid here)
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
  noNewline?: boolean            // 该侧文件末尾无换行
}

/** One hunk (@@ block) within a changed file. */
export interface DiffHunk {
  oldStart: number; oldLines: number
  newStart: number; newLines: number
  header?: string                // @@ 第二段后的 section 文本（如所在函数），可空
  lines: DiffLine[]
  truncated?: boolean            // 本文件行预算耗尽后该 hunk 被截断
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** One changed file in the workspace diff. `path` is cwd-relative for display. */
export interface DiffFile {
  path: string                   // renamed 时为新路径
  oldPath?: string               // renamed 旧路径（cwd 相对）
  status: DiffFileStatus
  additions: number
  deletions: number
  hunks: DiffHunk[]
  truncated?: boolean            // 文件级截断
  binary?: boolean               // 二进制变更，hunks 为空
}

/** Outcome of a workspace diff request. */
export type DiffState = 'ok' | 'not_a_repo' | 'git_missing' | 'no_cwd' | 'error'
export type DiffBase = 'session-start' | 'head'
export interface DiffSummary { totalFiles: number; totalAdditions: number; totalDeletions: number }

/** One per-turn (or session-start) checkpoint on the private ref chain. */
export interface Checkpoint {
  id: string                                  // "<sessionId>:<turnId>" ("<sessionId>:start" for #0)
  sessionId: string
  turnId: string | null                       // null for checkpoint #0 (session start)
  kind: 'start' | 'turn' | 'pre-revert'
  label: string | null                        // denormalized turn label for the timeline
  treeSha: string                             // drives diffs + restore
  commitSha: string                           // GC-protected ref target
  branch: string | null                       // branch at capture (for cross-branch warnings, A2)
  createdAt: number
}

/** One row of the session-start..HEAD commit log (更改 tab). */
export interface CommitLogEntry {
  sha: string
  shortSha: string
  message: string
  author: string
  timestamp: number                           // committer time, ms
}

/** The three timeline diff modes — each maps to a base→head tree pair. */
export type CheckpointMode = 'this-turn' | 'since-then' | 'since-start'

/** One branch in the repo, with a flag for the checked-out one. */
export interface Branch { name: string; current: boolean }

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
  | { type: 'fs:diff'; sessionId: string; base?: DiffBase }
  | { type: 'fs:diffSummary'; sessionId: string; base?: DiffBase }
  | { type: 'fs:diffFile'; sessionId: string; path: string; base?: DiffBase; context?: number | 'full' }
  | { type: 'fs:gitInit'; sessionId: string }
  | { type: 'git:checkpoint:list'; sessionId: string }
  | { type: 'git:checkpoint:diff'; sessionId: string; checkpointId: string; mode: CheckpointMode }
  | { type: 'git:commitLog'; sessionId: string }
  | { type: 'git:branch:list'; sessionId: string }
  | { type: 'git:branch:switch'; sessionId: string; branch: string }
  | { type: 'git:revert'; sessionId: string; checkpointId: string }
  | { type: 'permission:respond'; sessionId: string; requestId: string; optionId?: string; cancelled?: boolean }
  | { type: 'agent:setConfigOption'; sessionId: string; configId: string; value: string }

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
  | { type: 'fs:diff:result'; sessionId: string; base: DiffBase; hasSessionStart: boolean; state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
  | { type: 'fs:diffSummary:result'; sessionId: string; base: DiffBase; hasSessionStart: boolean; state: DiffState; summary?: DiffSummary; error?: string }
  | { type: 'fs:diffFile:result'; sessionId: string; path: string; base: DiffBase; state: DiffState; file?: DiffFile; error?: string }
  | { type: 'fs:gitInit:result'; sessionId: string; ok: boolean; error?: string }
  | { type: 'git:checkpoint:list:result'; sessionId: string; checkpoints: Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }
  | { type: 'git:checkpoint:diff:result'; sessionId: string; checkpointId: string; mode: CheckpointMode; state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }
  | { type: 'git:commitLog:result'; sessionId: string; commits: CommitLogEntry[]; state: DiffState; error?: string }
  | { type: 'checkpoint:created'; sessionId: string; checkpoint: Checkpoint }
  | { type: 'git:branch:list:result'; sessionId: string; branches: Branch[]; currentBranch: string | null }
  | { type: 'git:branch:switch:result'; sessionId: string; branch: string; ok: boolean; currentBranch: string | null; error?: string }
  | { type: 'git:revert:result'; sessionId: string; checkpointId: string; ok: boolean; safetyCheckpointId?: string; error?: string }
  | { type: 'permission:request'; sessionId: string; turnId: string; requestId: string; tool: PermissionRequestPayload; options: PermissionOption[]; agentFrame?: AgentFrame }
  | { type: 'agent:configOptions'; sessionId: string; options: AcpConfigOption[] }

// ──────────────────────────────────────────────────────────────────
// Agent orchestration foundation (multi-agent workflows over the AgentProvider seam)
// ──────────────────────────────────────────────────────────────────

export type AgentId = string

export interface AgentCapabilities {
  streamsReasoning: boolean
  toolCalls: boolean
  hitl: boolean        // 交互式权限往返 (ExternalAgentHooks.requestPermission)
  modelSwitch: boolean // 实时换模型 (setConfigOption)
}

export interface AgentDescriptor {
  id: AgentId
  name: string
  kind: AgentConfig['kind'] // 'custom' | 'opencode' | 'acp'
  capabilities: AgentCapabilities
}

export type NodeId = string

export interface AgentNode {
  id: NodeId
  type: 'agent'
  agentId: AgentId
  /** 含 {{nodeId}} / {{input}} / {{input.key}} 占位,引用上游产物或运行输入。 */
  inputTemplate: string
}
export type WorkflowNode = AgentNode // 节点 union 留开口,本轮仅 'agent'

export interface EdgeCondition { kind: 'always' | 'contains' | 'equals'; value?: string }
export interface WorkflowEdge { from: NodeId; to: NodeId; when?: EdgeCondition } // when 省略=always

export interface WorkflowDef {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entry: NodeId[]
}

export type NodeStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
export interface NodeOutput { text: string; data?: unknown }
export interface NodeRunState { status: NodeStatus; output?: NodeOutput; error?: string }
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface RunState {
  runId: string
  workflowId: string
  status: RunStatus
  nodes: Record<NodeId, NodeRunState>
}

export type OrchestratorEvent =
  | { type: 'run:started' }
  | { type: 'node:started'; nodeId: NodeId }
  | { type: 'node:succeeded'; nodeId: NodeId; output: NodeOutput }
  | { type: 'node:failed'; nodeId: NodeId; error: string }
  | { type: 'node:skipped'; nodeId: NodeId }
  | { type: 'run:cancelled' }
  | { type: 'run:finished'; status: RunStatus }
