/** WebSocket ClientMessage / ServerMessage protocol unions. */
import type { SessionConfig, PermissionMode, PlanItem, AgentRole } from './session-core.js'
import type {
  Attachment,
  Message,
  ReplayResult,
  AcpConfigOption,
  PermissionRequestPayload,
  PermissionOption,
  AgentFrame,
  SessionSummary,
  SearchHit,
} from './message-model.js'
import type {
  DiffBase,
  DiffState,
  DiffFile,
  DiffSummary,
  Checkpoint,
  CheckpointMode,
  CommitLogEntry,
  Branch,
  WorktreeInfo,
  FsEntry,
} from './workspace-types.js'
import type { McpServerConfig } from './mcp-config.js'
import type {
  McpResource,
  McpResourceTemplate,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
} from './mcp-resources.js'
import type { PluginManifest } from './plugins.js'
import type { WorkflowDef, OrchestratorEvent, RunState } from './workflow-protocol.js'
import type { OrchestrationMode } from './orchestration-types.js'
import type { AgentProfileInfo } from './agent-profile.js'
import type { MemoryItem, MemoryScope, MemoryStatus, MemoryFileConfig } from './memory-types.js'

export type ClientMessage =
  | { type: 'session:create'; id: string; config: SessionConfig }
  | { type: 'session:destroy'; sessionId: string }
  | { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user'; attachments?: AttachmentSendPayload[] }
  | { type: 'input:enqueue'; sessionId: string; id: string; content: string }
  | { type: 'input:steer'; sessionId: string; id: string; content: string }
  | { type: 'message:cancel'; sessionId: string }
  | { type: 'message:regenerate'; sessionId: string }
  | { type: 'message:resume'; sessionId: string; content: string; attachments?: AttachmentSendPayload[] }
  | { type: 'session:list' }
  | { type: 'session:load'; sessionId: string }
  | { type: 'session:search'; query: string }
  | { type: 'session:delete'; sessionId: string; deleteDerivedMemories?: boolean }
  | { type: 'session:rename'; sessionId: string; title: string }
  | { type: 'session:setCwd'; sessionId: string; cwd: string }
  | { type: 'session:setThinking'; sessionId: string; thinking: boolean }
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:setPermissionMode'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'session:setForcePlan'; sessionId: string; forcePlan: boolean }
  | { type: 'session:setModel'; sessionId: string; llmProvider: string; model: string; baseURL?: string }
  | { type: 'config:setActiveModel'; providerID: string; modelID: string; baseURL: string }
  | {
      type: 'config:testProvider'
      requestId: string
      purpose: 'chat' | 'embedding' | 'rerank'
      providerID: string
      baseURL?: string
      modelID?: string
      /** Optional unsaved key; never persisted by the probe handler. */
      apiKey?: string
    }
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
  | { type: 'plugin:install:url'; url: string }
  | { type: 'plugin:install:github'; url: string }
  | { type: 'plugin:delete'; pluginId: string }
  | { type: 'git:worktree:create'; sessionId: string; branch: string }
  | { type: 'git:worktree:list'; sessionId: string }
  | { type: 'git:worktree:remove'; sessionId: string; worktreePath: string }
  | { type: 'workflow:run'; sessionId: string; def: WorkflowDef; runInputs?: { text: string; data?: unknown } }
  | { type: 'workflow:getActive'; sessionId: string }
  | { type: 'mcp:listResources'; serverId: string }
  | { type: 'mcp:readResource'; serverId: string; uri: string }
  | { type: 'mcp:listPrompts'; serverId: string }
  | { type: 'mcp:getPrompt'; serverId: string; name: string; arguments?: Record<string, string> }
  | { type: 'mcp:reconnect'; servers: McpServerConfig[] }
  | { type: 'plan:respond'; sessionId: string; action: 'approve' | 'reject' | 'amend'; amendContent?: string }
  /**
   * @deprecated Product path ignores orchMode for turn routing (agent-driven orchestration).
   * Still accepted and stored for old clients / session JSON compatibility.
   * Prefer explicit `pendingWorkflowDef` / `workflow:run` for DAG turns.
   */
  | { type: 'session:setOrchMode'; sessionId: string; orchMode: OrchestrationMode }
  | { type: 'agent:setProfile'; sessionId: string; id: string }
  | { type: 'subagent:background'; sessionId: string; taskId: string; description: string }
  | { type: 'subagent:resume'; sessionId: string; taskId: string; message: string }
  | { type: 'replay:session'; sessionId: string; turnIndex: number }
  | { type: 'message:compact'; sessionId: string; focus?: string }
  | { type: 'memory:list'; scope?: MemoryScope; projectKeyHash?: string; sessionId?: string; query?: string; limit?: number; status?: MemoryStatus }
  | { type: 'memory:get'; id: string }
  | { type: 'memory:upsert'; item: Partial<MemoryItem> & Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'> }
  | { type: 'memory:delete'; id: string; hard?: boolean }
  | { type: 'memory:deleteBySourceSession'; sessionId: string; soft?: boolean }
  | { type: 'memory:restore'; id: string }
  | { type: 'memory:emptyTrash' }
  | { type: 'memory:export'; format: 'jsonl' | 'markdown'; scope?: MemoryScope; projectKeyHash?: string }
  | { type: 'memory:import'; format: 'jsonl'; data: string; conflict?: 'keep' | 'overwrite' | 'merge' }
  | { type: 'memory:getConfig' }
  | { type: 'memory:setConfig'; config: Partial<MemoryFileConfig> }
  | { type: 'memory:consolidate'; projectKeyHash?: string }
  | { type: 'memory:reindex' }
  | { type: 'memory:indexStatus' }
  | { type: 'session:setMemoryFlags'; sessionId: string; useMemories?: boolean; generateMemories?: boolean; incognito?: boolean }

type AttachmentSendPayload = Attachment & { path: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'agent:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; parentAgentId?: string; taskInput?: string; taskId?: string }
  | { type: 'token:stream'; sessionId: string; turnId: string; agentId: string; delta: string }
  | { type: 'agent:finished'; sessionId: string; turnId: string; agentId: string }
  | { type: 'reasoning:delta'; sessionId: string; turnId: string; agentId: string; role: AgentRole; stepSeq: number; delta: string }
  | { type: 'tool:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; callId: string; name: string; input: string; seq: number; truncated?: boolean }
  | { type: 'tool:finished'; sessionId: string; turnId: string; agentId: string; callId: string; status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }
  | { type: 'session:thinking'; sessionId: string; thinking: boolean }
  | { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:permissionMode'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'session:forcePlan'; sessionId: string; forcePlan: boolean }
  | { type: 'session:model'; sessionId: string; llmProvider: string; model: string }
  /**
   * Echo of stored orchMode (compat). `ignoredForTurnRouting` is optional honesty:
   * when true (always set by current sidecar), product turn routing does not use orchMode.
   * Old clients may omit the field; presence does not change stored orchMode.
   */
  | {
      type: 'session:orchMode'
      sessionId: string
      orchMode: OrchestrationMode
      /** When true, orchMode is stored but ignored for turn routing. */
      ignoredForTurnRouting?: true
    }
  | { type: 'config:activeModel'; providerID: string; modelID: string; hasApiKey: boolean }
  | {
      type: 'config:testProvider:result'
      requestId: string
      ok: boolean
      code: KeyProbeCode
      /** English detail from sidecar; UI maps `code` → i18n primarily. */
      message: string
      latencyMs?: number
      checkedAt: number
      cached?: boolean
    }
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
  /** Emitted by the Guardian hook when a tool invocation exceeds the risk threshold. */
  | { type: 'guardian:risk'; sessionId: string; turnId: string; toolName: string; risk: 'low' | 'medium' | 'high'; category: string; reason: string }
  | { type: 'plugin:list:result'; plugins: PluginManifest[] }
  | { type: 'git:worktree:create:result'; sessionId: string; ok: boolean; path?: string; error?: string }
  | { type: 'git:worktree:list:result'; sessionId: string; worktrees: WorktreeInfo[] }
  | { type: 'git:worktree:remove:result'; sessionId: string; ok: boolean; error?: string }
  | { type: 'mcp:listResources:result'; serverId: string; resources: McpResource[]; resourceTemplates?: McpResourceTemplate[]; error?: string }
  | { type: 'mcp:readResource:result'; serverId: string; uri: string; contents: McpResourceContent[]; error?: string }
  | { type: 'mcp:listPrompts:result'; serverId: string; prompts: McpPrompt[]; error?: string }
  | { type: 'mcp:getPrompt:result'; serverId: string; name: string; messages: McpPromptMessage[]; error?: string }
  | { type: 'mcp:status'; servers: Array<{ id: string; name: string; status: 'connected' | 'connecting' | 'disconnected' | 'error'; toolCount: number; toolNames: string[]; lastError?: string }> }
  | { type: 'plan:delta'; sessionId: string; turnId: string; itemId: string; delta: string }
  | { type: 'plan:published'; sessionId: string; turnId: string; plan: PlanItem[] }
  | { type: 'agent:profiles'; sessionId: string; profiles: AgentProfileInfo[] }
  | { type: 'agent:notification'; sessionId: string; taskId: string; description: string; status: 'completed' | 'failed' | 'killed'; result?: string; error?: string }
  | { type: 'plugin:install:progress'; status: 'cloning' | 'scanning' | 'generating_manifest' | 'registering' | 'done' | 'error'; message: string; pluginId?: string; components?: { skills: number; mcpServers: number; agents: number; hooks: number } }
  | { type: 'plugin:install:result'; ok: boolean; pluginId?: string; error?: string }
  | { type: 'plugin:delete:result'; pluginId: string; ok: boolean; error?: string }
  | { type: 'replay:result'; sessionId: string; result: ReplayResult }
  | {
      type: 'compact:result'
      sessionId: string
      /** Transport / unexpected failure. No-op (nothing to compact) is ok:true + applied:false. */
      ok: boolean
      /** True only when the model context was actually rewritten. */
      applied: boolean
      reason?: 'nothing_to_compact' | 'session_busy' | 'session_not_found' | 'summarizer_failed' | string
      tokensBefore: number
      tokensAfter: number
      messagesBefore: number
      messagesAfter: number
      /** Present when applied — for UI status strip. */
      summary?: string
      error?: string
    }
  | { type: 'workflow:started'; sessionId: string; runId: string; def: WorkflowDef }
  | { type: 'workflow:event'; sessionId: string; runId: string; event: OrchestratorEvent }
  | { type: 'workflow:snapshot'; sessionId: string; runId: string; def: WorkflowDef; state: RunState }
  | { type: 'workflow:cleared'; sessionId: string }
  | { type: 'memory:list:result'; items: MemoryItem[]; error?: string }
  | { type: 'memory:get:result'; item?: MemoryItem; error?: string }
  | { type: 'memory:upsert:result'; item?: MemoryItem; error?: string }
  | { type: 'memory:delete:result'; id: string; ok: boolean; error?: string }
  | { type: 'memory:deleteBySourceSession:result'; sessionId: string; deleted: number; error?: string }
  | { type: 'memory:restore:result'; item?: MemoryItem; error?: string }
  | { type: 'memory:emptyTrash:result'; deleted: number; error?: string }
  | { type: 'memory:export:result'; format: string; data: string; error?: string }
  | { type: 'memory:import:result'; ok: boolean; imported: number; error?: string }
  | { type: 'memory:config'; config: MemoryFileConfig }
  | { type: 'memory:pipeline'; phase: 1 | 2; status: 'started' | 'succeeded' | 'failed' | 'noop'; detail?: string }
  | {
      type: 'memory:reindex:result'
      embedded: number
      total: number
      failed?: number
      modelKey?: string
      error?: string
    }
  | {
      type: 'memory:indexStatus:result'
      embedded: number
      total: number
      modelKey?: string
      vecEnabled?: boolean
      error?: string
    }
  | { type: 'session:memoryFlags'; sessionId: string; useMemories?: boolean; generateMemories?: boolean; incognito?: boolean }

/** Taxonomy for provider key usability probes (config:testProvider). */
export type KeyProbeCode =
  | 'OK'
  | 'MISSING_KEY'
  | 'MISSING_BASE_URL'
  | 'MISSING_MODEL'
  | 'PROVIDER_DISABLED'
  | 'INCOMPATIBLE_PROVIDER'
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'PROVIDER_ERROR'
  | 'PROBE_RATE_LIMITED'
  | 'PROBE_BUSY'
  | 'PROBE_UNSUPPORTED'
  | 'PROBE_DISABLED'
  | 'INVALID_RESPONSE'
  | 'INTERNAL'

