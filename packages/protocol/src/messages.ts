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
  | { type: 'session:delete'; sessionId: string }
  | { type: 'session:rename'; sessionId: string; title: string }
  | { type: 'session:setCwd'; sessionId: string; cwd: string }
  | { type: 'session:setThinking'; sessionId: string; thinking: boolean }
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
  | { type: 'session:setPermissionMode'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'session:setModel'; sessionId: string; llmProvider: string; model: string; baseURL?: string }
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
  | { type: 'session:setOrchMode'; sessionId: string; orchMode: OrchestrationMode }
  | { type: 'agent:setProfile'; sessionId: string; id: string }
  | { type: 'subagent:background'; sessionId: string; taskId: string; description: string }
  | { type: 'subagent:resume'; sessionId: string; taskId: string; message: string }
  | { type: 'replay:session'; sessionId: string; turnIndex: number }
  | { type: 'message:compact'; sessionId: string }

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
  | { type: 'session:model'; sessionId: string; llmProvider: string; model: string }
  | { type: 'session:orchMode'; sessionId: string; orchMode: OrchestrationMode }
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
  | { type: 'agent:notification'; sessionId: string; taskId: string; description: string; status: 'completed' | 'failed'; result?: string; error?: string }
  | { type: 'plugin:install:progress'; status: 'cloning' | 'scanning' | 'generating_manifest' | 'registering' | 'done' | 'error'; message: string; pluginId?: string; components?: { skills: number; mcpServers: number; agents: number; hooks: number } }
  | { type: 'plugin:install:result'; ok: boolean; pluginId?: string; error?: string }
  | { type: 'plugin:delete:result'; pluginId: string; ok: boolean; error?: string }
  | { type: 'replay:result'; sessionId: string; result: ReplayResult }
  | { type: 'compact:result'; sessionId: string; ok: boolean; inputTokens: number; outputTokens: number; messagesBefore: number; messagesAfter: number; error?: string }
  | { type: 'workflow:started'; sessionId: string; runId: string; def: WorkflowDef }
  | { type: 'workflow:event'; sessionId: string; runId: string; event: OrchestratorEvent }
  | { type: 'workflow:snapshot'; sessionId: string; runId: string; def: WorkflowDef; state: RunState }
  | { type: 'workflow:cleared'; sessionId: string }

