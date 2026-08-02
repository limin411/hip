/** Chat message, tool-call, timeline, and attachment shapes. */
import type { AgentRole } from './session-core.js'
import type { MemoryCitation } from './memory-types.js'

export interface Attachment {
  id: string
  name: string
  mimeType: string
  size?: number
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** Discussion edge between council advisors (docs/design/roundtable-council.md). */
export interface RoundtableEdge {
  round: number
  from: string
  to: string
  relation: 'support' | 'rebut' | 'question'
  summary: string
}

/** Assistant turn metadata when the roundtable engine ran. */
export interface RoundtableMeta {
  engine: 'loop' | 'sim' | 'council'
  convened: boolean
  roundsPlanned?: number
  roundsRan?: number
  earlyExit?: boolean
  advisorCalls?: number
  /** Final runner phase */
  phase?: 'done' | 'aborted'
  /** Council: structured discussion edges */
  edges?: RoundtableEdge[]
  /** Council: optional vote casts */
  votes?: Array<{
    voter: string
    optionId: string
    strength: 1 | 2 | 3
    reason?: string
  }>
  tally?: Array<{ optionId: string; label: string; score: number }>
  hipOverruledMajority?: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'notice'
  content: string
  agentId?: string
  timestamp: number
  stopped?: boolean // assistant turn was cancelled mid-stream; partial content kept
  timeline?: TimelineStep[]  // ordered reasoning+tool+text steps for this turn (assistant only)
  toolCalls?: ToolCall[]     // flat tool calls for this turn, referenced by timeline tool steps via callId
  agentRuns?: AgentRun[]     // per-agent run metadata for THIS turn (taskInput/output/timing/parent)
  usage?: TurnUsage          // turn total = sum of agentRuns' usage; present once usage was reported
  attachments?: Attachment[]
  memoryCitations?: MemoryCitation[]
  /** Present when this assistant turn was produced by the roundtable engine. */
  roundtable?: RoundtableMeta
}

/** Provider-reported token counts for a turn or a single agent's slice of it.
 *  Counts only — $ cost is computed in the renderer from the models.dev catalog price.
 *
 *  `inputTokens` / `outputTokens` / `totalTokens` are **sums** across multi-step LLM
 *  calls (billing). `contextTokens` is the best estimate of single-request context
 *  size for context-window fill % (last step input within an agent; max across agents).
 */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Single-request context size for fill %; omit on legacy rows. */
  contextTokens?: number
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
  /** Terminal-exec bridge metadata (terminal surface only). */
  meta?: {
    managedTerminalId?: string
    waitMs?: number
    callId?: string
  }
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
  /** Human-facing agent name (e.g. "Coder", "Explore"); prefer over role labels in UI. */
  name?: string
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

/** A message in a replayed session conversation. */
export interface ReplayMessage {
  readonly type: 'human' | 'ai' | 'system'
  readonly content: string
  readonly tool_calls?: readonly ReplayToolCall[]
}

export interface ReplayToolCall {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly id: string
  readonly type: 'tool_call'
}

export interface ReplayToolCallSummary {
  readonly name: string
  readonly input: unknown
  readonly output?: string
  readonly error?: string
}

export interface ReplayResult {
  readonly messages: readonly ReplayMessage[]   // conversation at the start of the requested turn
  readonly agentResponse?: string               // agent's text for this turn
  readonly toolCalls: readonly ReplayToolCallSummary[] // tool calls with inputs/outputs for this turn
}

/**
 * One step in an assistant turn's execution trace. `stepSeq` is a single
 * turn-global monotonic counter shared across reasoning, tool, and text steps, so a
 * timeline interleaves them in true wall-clock order. A 'tool' step carries no
 * payload — it references a ToolCall (on Message.toolCalls) by callId.
 * 'text' steps are supervisor narration only (KD-17 Choice A); subagent tokens
 * stay on AgentRun.output and never become text steps.
 */
export type TimelineStep =
  | { kind: 'reasoning'; stepSeq: number; agentId: string; role: AgentRole; content: string; truncated?: boolean }
  | { kind: 'tool'; stepSeq: number; agentId: string; role: AgentRole; callId: string }
  | { kind: 'text'; stepSeq: number; agentId: string; role: AgentRole; content: string; truncated?: boolean }

export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
  surface: 'chat' | 'code' | 'terminal'
  /** Terminal binding (D8); present for `surface === 'terminal'` summaries. */
  managedTerminalId?: string
  /** Persistent SSH host catalog id (D8). */
  hostId?: string
  /** Display/context remote-path hint only. */
  remotePathHint?: string
  /** Absolute project root when bound; omitted for sandbox / unbound code sessions. */
  cwd?: string
}

/** Session row currently in the product recycle bin (soft-deleted). */
export interface TrashedSessionSummary extends SessionSummary {
  /** Epoch ms when soft-deleted (write-once until restore). */
  deletedAt: number
  /** User chose to delete derived long-term memories at soft-delete time. */
  deleteDerivedMemories: boolean
}
export interface SearchHit {
  sessionId: string
  messageId: string | null
  title: string
  snippet: string
  timestamp: number
}
