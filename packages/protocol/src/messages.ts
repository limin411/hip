/** WebSocket ClientMessage / ServerMessage protocol unions. */
import type { SessionConfig, PermissionMode, PlanItem, AgentRole } from './session-core.js'
import type { ExecutionMode } from './execution-mode.js'
import type {
  Attachment,
  Message,
  ReplayResult,
  AcpConfigOption,
  PermissionRequestPayload,
  PermissionOption,
  AgentFrame,
  SessionSummary,
  TrashedSessionSummary,
  SearchHit,
} from './message-model.js'
import type {
  DiffBase,
  DiffState,
  DiffFile,
  DiffFileStatus,
  DiffSummary,
  Checkpoint,
  CommitLogEntry,
  Branch,
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
import type {
  MemoryItem,
  MemoryScope,
  MemoryStatus,
  MemoryFileConfig,
  MemoryPipelineStatus,
} from './memory-types.js'
import type {
  TaskKind,
  TaskSnapshot,
  TaskRunningCounts,
  TaskOutputPayload,
  TaskNotificationStatus,
} from './task-runtime.js'

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
  /**
   * Permanent session delete (HARD only).
   * UI soft-delete uses `session:softDelete`. CLI and recycle-bin "Delete forever" use this.
   * `reason` is an audit tag (user / clearAll / cli / trash-empty / trash-retention / …).
   */
  | {
      type: 'session:delete'
      sessionId: string
      deleteDerivedMemories?: boolean
      /** Why this delete was requested — optional for older clients. */
      reason?: string
    }
  /**
   * Soft-delete → product recycle bin. Does not purge SQLite messages, scratch, or checkpoints.
   * Live runtime is torn down; restore via `session:restore`.
   */
  | {
      type: 'session:softDelete'
      sessionId: string
      deleteDerivedMemories?: boolean
      reason?: string
    }
  /** Restore a soft-deleted session from the recycle bin. */
  | { type: 'session:restore'; sessionId: string }
  /** List soft-deleted sessions (newest trash first). */
  | { type: 'session:trash:list' }
  /** Hard-delete every soft-deleted session (Empty recycle bin for sessions). */
  | { type: 'session:trash:empty' }
  /**
   * Run session trash retention once (purge expired soft-deletes).
   * Optional `retentionDays` overrides config for this call; default from product policy (7 until Settings wired).
   */
  | { type: 'session:trash:purge'; retentionDays?: number }
  | { type: 'session:rename'; sessionId: string; title: string }
  | { type: 'session:setCwd'; sessionId: string; cwd: string }
  | { type: 'session:setThinking'; sessionId: string; thinking: boolean }
  | { type: 'session:setEffort'; sessionId: string; effort: string | null }
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:setPermissionMode'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'session:setForcePlan'; sessionId: string; forcePlan: boolean }
  | { type: 'session:setExecutionMode'; sessionId: string; executionMode: ExecutionMode }
  /**
   * Mid-session primary agent switch. `agentId` `'builtin'` or `''` clears external
   * primary (hip Supervisor). Otherwise an enabled ACP-capable agent id.
   * Rejected with BUSY while a turn is running.
   */
  | { type: 'session:setAgent'; sessionId: string; agentId: string }
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
  | { type: 'fs:diff'; sessionId: string; base?: DiffBase; ignoreWhitespace?: boolean }
  | { type: 'fs:diffSummary'; sessionId: string; base?: DiffBase }
  | { type: 'fs:diffFile'; sessionId: string; path: string; base?: DiffBase; context?: number | 'full' }
  | { type: 'fs:gitInit'; sessionId: string }
  | { type: 'git:checkpoint:list'; sessionId: string }
  | { type: 'git:commitLog'; sessionId: string }
  | { type: 'git:commitDiff'; sessionId: string; sha: string }
  | { type: 'git:discard'; sessionId: string; path: string; status: DiffFileStatus; oldPath?: string }
  | { type: 'git:branch:list'; sessionId: string }
  | { type: 'git:branch:switch'; sessionId: string; branch: string }
  | { type: 'permission:respond'; sessionId: string; requestId: string; optionId?: string; cancelled?: boolean }
  | { type: 'agent:setConfigOption'; sessionId: string; configId: string; value: string }
  | {
      type: 'plugin:install:url'
      url: string
      sha?: string
      ref?: string
      subpath?: string
      marketSourceId?: string
      marketPluginName?: string
      /** Default true for marketplace downloads. */
      runModelReview?: boolean
      /** When true (marketplace default), register with enabled=false. */
      startDisabled?: boolean
    }
  | { type: 'plugin:install:github'; url: string }
  | { type: 'plugin:delete'; pluginId: string }
  /** Reload plugin components in all sessions (after enable/disable or disk change). */
  | { type: 'plugin:reload' }
  /**
   * Inspect active extension registry for a project cwd (skills/MCP/conflicts).
   * `requestId` correlates the async result.
   */
  | { type: 'extension:inspect'; requestId: string; cwd?: string }
  /**
   * Preflight enabling a plugin (skill/MCP id + capability conflicts).
   * Pass absolute `pluginDir` (or installed plugin id resolved server-side when only pluginId is set).
   */
  | {
      type: 'extension:preflight'
      requestId: string
      cwd?: string
      pluginDir?: string
      pluginId?: string
    }
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
  | { type: 'memory:getStatus'; projectKeyHash?: string; contextWindowTokens?: number }
  | { type: 'memory:rewriteMirrors'; projectKeyHash?: string }
  | { type: 'memory:importMirror'; projectKeyHash?: string; conflict?: 'keep' | 'overwrite' }
  | { type: 'session:setMemoryFlags'; sessionId: string; useMemories?: boolean; generateMemories?: boolean; incognito?: boolean }
  /**
   * One-shot empty-state greeting generation (built-in model path only — no ACP/tools/session).
   * Uses the caller's last-used model when provided; otherwise sidecar active model.
   */
  | {
      type: 'ui:emptyGreeting:generate'
      requestId: string
      /** Optional pin to last-used model from the UI. */
      providerID?: string
      modelID?: string
      context: EmptyGreetingGenerateContext
    }
  /** Force-refresh Runtime task snapshot for a session (TaskRuntime). */
  | { type: 'task:list'; sessionId: string }
  /** Stop a runtime task (shell / agent / monitor / schedule). */
  | { type: 'task:stop'; sessionId: string; taskId: string; reason?: string }
  /** Fetch output for a runtime task (optional byte offset for tail/resume). */
  | { type: 'task:getOutput'; sessionId: string; taskId: string; offsetBytes?: number }
  /**
   * UI-mediated shared-PTY execution result (terminal surface). The sidecar's
   * `terminal_exec` tool resolves its pending promise with this payload.
   */
  | {
      type: 'session:uiToolResult'
      sessionId: string
      callId: string
      ok: boolean
      status: 'completed' | 'timed_out' | 'user_interleaved' | 'rejected' | 'error' | 'aborted'
      output?: string
      /** True when the command may still be running (timed_out/user_interleaved). */
      mayStillRun?: boolean
      exitCode?: number | null
      error?: string
    }
  /**
   * UI answer for the read-only short path (terminal_read / sftp_read).
   * Read requests never require HITL.
   */
  | {
      type: 'session:uiToolRead:result'
      sessionId: string
      callId: string
      ok: boolean
      output?: string
      cursor?: number
      error?: string
    }
  /**
   * UI answer for the write bridge (sftp_write). Writes always flow through
   * approval + overwrite confirmation in the UI.
   */
  | {
      type: 'session:uiToolWrite:result'
      sessionId: string
      callId: string
      ok: boolean
      error?: string
    }
  /** UI pushes ring tail / switch-context note into the sidecar context (D11). */
  | { type: 'session:terminalContext'; sessionId: string; note?: string; ringTail?: string }

/** UI answer for a `terminal_exec` bridge request (see session:uiToolResult). */
export type UiToolResultPayload = Extract<ClientMessage, { type: 'session:uiToolResult' }>

/** UI answer for a read-only bridge request (see session:uiToolRead:result). */
export type UiToolReadResultPayload = Extract<ClientMessage, { type: 'session:uiToolRead:result' }>

/** UI answer for a write bridge request (see session:uiToolWrite:result). */
export type UiToolWriteResultPayload = Extract<ClientMessage, { type: 'session:uiToolWrite:result' }>

/** Context for LLM empty-state title/sub generation (UI chrome only). */
export interface EmptyGreetingGenerateContext {
  language: 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
  surface: 'chat' | 'code'
  /**
   * Fine local time slot:
   * earlyMorning | morning | afternoon | evening | lateEvening | lateNight | deepNight
   */
  timeOfDay: string
  /** Local hour 0–23 in the user's timezone. */
  localHour?: number
  /** 0=Sunday … 6=Saturday */
  weekday?: number
  /**
   * Calendar-edge tone:
   * none | sunday-evening | sunday-late | monday-early
   */
  weekEdge?: string
  /** Short English tone brief for the model (optional). */
  toneHint?: string
  region: string
  tier: 'holiday' | 'weekend' | 'weekEdge' | 'timeOfDay' | 'default'
  /** Rule-based title already shown (inspiration + fallback). */
  baseTitle: string
  /** Rule-based subtitle already shown. */
  baseSub: string
  /** Optional holiday id when tier is holiday. */
  holidayId?: string
  /** Recent session titles (sanitized, short), most recent first. */
  recentSessionTitles?: string[]
  /**
   * Soft memory hints for warmer copy (sanitized one-liners only).
   * Prefer preferences / profile / light lessons — never raw secrets.
   */
  memoryHints?: string[]
}

type AttachmentSendPayload = Attachment & { path: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'agent:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; parentAgentId?: string; taskInput?: string; taskId?: string; name?: string }
  /**
   * Streaming assistant / subagent token. Builtin hub supervisor includes
   * `stepSeq` (TextBurstTracker) for interleaved text timeline steps; subagents
   * and ACP omit it (legacy content / run.output paths). Optional `role` helps
   * clients without agentRuns context.
   */
  | { type: 'token:stream'; sessionId: string; turnId: string; agentId: string; delta: string; stepSeq?: number; role?: AgentRole }
  | { type: 'agent:finished'; sessionId: string; turnId: string; agentId: string }
  | { type: 'reasoning:delta'; sessionId: string; turnId: string; agentId: string; role: AgentRole; stepSeq: number; delta: string }
  | { type: 'tool:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; callId: string; name: string; input: string; seq: number; truncated?: boolean }
  | { type: 'tool:finished'; sessionId: string; turnId: string; agentId: string; callId: string; status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }
  | { type: 'session:thinking'; sessionId: string; thinking: boolean }
  | { type: 'session:effort'; sessionId: string; effort: string | null }
  | { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:permissionMode'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'session:forcePlan'; sessionId: string; forcePlan: boolean }
  | { type: 'session:executionMode'; sessionId: string; executionMode: ExecutionMode }
  /**
   * Field-echo after session:setAgent. `agentId` is the resolved primary id, or `null`
   * when cleared to the built-in Supervisor (no full SessionConfig merge).
   */
  | { type: 'session:agentChanged'; sessionId: string; agentId: string | null }
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
  | {
      type: 'ready'
      hasApiKey: boolean
      /** Present when multi-client WS is enabled. */
      multiClient?: true
      connectionId?: string
      /** Snapshot of other connections at connect time (roles only). */
      clients?: Array<{ id: string; role: 'gui' | 'cli' | 'unknown' }>
    }
  | { type: 'session:list:result'; sessions: SessionSummary[] }
  | { type: 'session:loaded'; sessionId: string; messages: Message[]; config?: SessionConfig }
  | { type: 'session:search:result'; query: string; hits: SearchHit[] }
  /** Hard delete only. */
  | { type: 'session:deleted'; sessionId: string }
  /** Soft-delete landed in recycle bin. */
  | { type: 'session:trashed'; sessionId: string; deletedAt: number }
  /** Soft-delete restored; client merges summary into active list without auto-select. */
  | { type: 'session:restored'; sessionId: string; summary: SessionSummary }
  | { type: 'session:trash:list:result'; sessions: TrashedSessionSummary[] }
  | { type: 'session:trash:purge:result'; purgedIds: string[]; retentionDays: number }
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
  | { type: 'git:commitLog:result'; sessionId: string; commits: CommitLogEntry[]; state: DiffState; error?: string }
  | { type: 'git:commitDiff:result'; sessionId: string; sha: string; state: DiffState; files?: DiffFile[]; error?: string }
  | { type: 'git:discard:result'; sessionId: string; path: string; ok: boolean; error?: string }
  | { type: 'checkpoint:created'; sessionId: string; checkpoint: Checkpoint }
  | { type: 'git:branch:list:result'; sessionId: string; branches: Branch[]; currentBranch: string | null }
  | { type: 'git:branch:switch:result'; sessionId: string; branch: string; ok: boolean; currentBranch: string | null; error?: string }
  | { type: 'permission:request'; sessionId: string; turnId: string; requestId: string; tool: PermissionRequestPayload; options: PermissionOption[]; agentFrame?: AgentFrame }
  /**
   * Shared-PTY execution request (terminal surface). The UI must assert the
   * terminal is connected, write `command + "\n"` to the visible PTY, watch the
   * ring, and answer with `session:uiToolResult` (same callId).
   */
  | {
      type: 'session:terminalExec:request'
      sessionId: string
      callId: string
      command: string
      waitMs: number
      poll: boolean
      /** Opt-in __HIP_EC exit-code wrapper (P1). */
      wrapEc?: boolean
    }
  /**
   * Read-only tool bridge request (terminal_read / sftp_read). No HITL — the UI
   * answers with `session:uiToolRead:result` (same callId).
   */
  | {
      type: 'session:uiToolRead:request'
      sessionId: string
      callId: string
      kind: 'terminal_read' | 'sftp_read'
      cursor?: number
      path?: string
      maxBytes?: number
    }
  /**
   * SFTP write request (P2). The UI confirms overwrite of an existing path,
   * writes via the native SFTP channel, then answers session:uiToolWrite:result.
   */
  | {
      type: 'session:uiToolWrite:request'
      sessionId: string
      callId: string
      path: string
      content: string
      force: boolean
    }
  /** Multi-client: first accepted permission:respond wins; broadcast so other clients clear UI. */
  | { type: 'permission:resolved'; sessionId: string; requestId: string; source: 'gui' | 'cli' | 'unknown' }
  /** Multi-client: plan/interrupt pause cleared (response accepted or turn abandoned). */
  | {
      type: 'agent:interrupt:resolved'
      sessionId: string
      turnId: string
      source?: 'gui' | 'cli' | 'unknown'
    }
  /** Multi-client connection registry snapshot (roles only). */
  | { type: 'clients:changed'; clients: Array<{ id: string; role: 'gui' | 'cli' | 'unknown' }> }
  | { type: 'agent:configOptions'; sessionId: string; options: AcpConfigOption[] }
  /** Emitted by the Guardian hook when a tool invocation exceeds the risk threshold. */
  | { type: 'guardian:risk'; sessionId: string; turnId: string; toolName: string; risk: 'low' | 'medium' | 'high'; category: string; reason: string }
  | { type: 'plugin:list:result'; plugins: PluginManifest[] }
  | { type: 'mcp:listResources:result'; serverId: string; resources: McpResource[]; resourceTemplates?: McpResourceTemplate[]; error?: string }
  | { type: 'mcp:readResource:result'; serverId: string; uri: string; contents: McpResourceContent[]; error?: string }
  | { type: 'mcp:listPrompts:result'; serverId: string; prompts: McpPrompt[]; error?: string }
  | { type: 'mcp:getPrompt:result'; serverId: string; name: string; messages: McpPromptMessage[]; error?: string }
  | { type: 'mcp:status'; servers: Array<{ id: string; name: string; status: 'connected' | 'connecting' | 'disconnected' | 'error'; toolCount: number; toolNames: string[]; lastError?: string }> }
  | { type: 'plan:delta'; sessionId: string; turnId: string; itemId: string; delta: string }
  /** Incremental plan checklist update (e.g. after write_todos); may fire many times per turn. */
  | { type: 'plan:updated'; sessionId: string; turnId: string; plan: PlanItem[] }
  /** Authoritative plan snapshot at plan-approval boundary (ExitPlanMode / pause). */
  | {
      type: 'plan:published'
      sessionId: string
      turnId: string
      plan: PlanItem[]
      /** plan.md body at publish time; JS string.length units; clipped by sidecar. */
      markdown?: string
      planPath?: string
      markdownTruncated?: boolean
    }
  /**
   * Ack for every `plan:respond` path (KD-16 / D4e).
   * ok:false when not awaiting (`reason: 'not_awaiting'`) — FE rolls back optimistic UI.
   * Success paths emit ok:true before execute continues (persist/runTurn failures are separate).
   */
  | {
      type: 'plan:respond:result'
      sessionId: string
      ok: boolean
      action: 'approve' | 'reject' | 'amend'
      reason?: string
    }
  /**
   * Goal mode chrome (smoothness I1). Emitted when goal_create / goal_update changes state.
   * goal=null means cleared (completed or cancelled).
   */
  | {
      type: 'goal:updated'
      sessionId: string
      goal: null | {
        id: string
        description: string
        status: 'active' | 'paused' | 'blocked' | 'completed'
        turns: number
        maxTurns: number
        tokens: number
        maxTokens: number
      }
    }
  | { type: 'agent:profiles'; sessionId: string; profiles: AgentProfileInfo[] }
  | { type: 'agent:notification'; sessionId: string; taskId: string; description: string; status: 'completed' | 'failed' | 'killed'; result?: string; error?: string }
  | {
      type: 'plugin:install:progress'
      status:
        | 'cloning'
        | 'scanning'
        | 'generating_manifest'
        | 'reviewing_models'
        | 'registering'
        | 'done'
        | 'error'
      message: string
      pluginId?: string
      components?: { skills: number; mcpServers: number; agents: number; hooks: number }
    }
  | {
      type: 'plugin:install:result'
      ok: boolean
      pluginId?: string
      error?: string
      modelReview?: import('./marketplace.js').PluginModelReviewSummary
    }
  | { type: 'plugin:delete:result'; pluginId: string; ok: boolean; error?: string }
  | {
      type: 'extension:inspect:result'
      requestId: string
      ok: boolean
      error?: string
      snapshot?: import('./extension-registry.js').ExtensionRegistrySnapshot
      /** High-signal subset for Settings banners. */
      notableConflicts?: import('./extension-registry.js').ExtensionConflict[]
    }
  | {
      type: 'extension:preflight:result'
      requestId: string
      ok: boolean
      error?: string
      preflight?: {
        pluginId: string
        pluginDir: string
        skillConflicts: Array<{
          skillId: string
          existing: import('./extension-registry.js').ExtensionSourceRef
          incoming: import('./extension-registry.js').ExtensionSourceRef
        }>
        mcpIdConflicts: Array<{
          id: string
          existing: import('./extension-registry.js').ExtensionSourceRef
          incoming: import('./extension-registry.js').ExtensionSourceRef
        }>
        capabilityConflicts: Array<{
          fingerprint: string
          existingId: string
          incomingId: string
          existing: import('./extension-registry.js').ExtensionSourceRef
          incoming: import('./extension-registry.js').ExtensionSourceRef
        }>
        recommendations: string[]
        hasConflicts: boolean
      }
    }
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
      /** Message ids collapsed into the summary (applied only) — lets the UI
       *  trim its transcript so token meters reflect the compacted context. */
      replacedMessageIds?: string[]
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
  | { type: 'memory:status'; status: MemoryPipelineStatus; error?: string }
  | { type: 'memory:rewriteMirrors:result'; written: string[]; error?: string }
  | { type: 'memory:importMirror:result'; imported: number; skipped: number; error?: string }
  | { type: 'session:memoryFlags'; sessionId: string; useMemories?: boolean; generateMemories?: boolean; incognito?: boolean }
  | {
      type: 'ui:emptyGreeting:generate:result'
      requestId: string
      ok: boolean
      title?: string
      sub?: string
      error?: string
    }
  /** Full Runtime task list + running counts (session open / task:list). */
  | {
      type: 'task:snapshot'
      sessionId: string
      tasks: TaskSnapshot[]
      runningCounts: TaskRunningCounts
    }
  /** Incremental Runtime task upsert (status / metrics / logTail). */
  | { type: 'task:delta'; sessionId: string; task: TaskSnapshot }
  /** Monitor line event (UI/WS only; not auto-injected into the model). */
  | {
      type: 'task:event'
      sessionId: string
      taskId: string
      description: string
      line: string
      seq: number
    }
  /**
   * Terminal Runtime notification (all kinds).
   * Do not use for schedule "fired" — that is task:delta metrics + optional notice.
   * Agent kind may still also emit agent:notification for backward compat.
   */
  | {
      type: 'task:notification'
      sessionId: string
      taskId: string
      kind: TaskKind
      description: string
      status: TaskNotificationStatus
      result?: string
      error?: string
      originTurnId?: string | null
      originToolCallId?: string | null
    }
  /** RPC result for task:stop. */
  | {
      type: 'task:stop:result'
      sessionId: string
      taskId: string
      ok: boolean
      message?: string
      error?: string
    }
  /** RPC result for task:getOutput. */
  | {
      type: 'task:getOutput:result'
      sessionId: string
      taskId: string
      ok: boolean
      payload?: TaskOutputPayload
      error?: string
    }

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
