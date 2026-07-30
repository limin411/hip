import type { TFunction } from 'i18next'
import type { Message, ToolCall } from '@hip/protocol'
import type { PaletteIconName } from '@/components/command-palette/types'
import type { TurnAgent } from '@/lib/turnAgents'
import type { ActiveView, Surface } from '@/store/uiStore'
import type { WorkItemLinks, WorkItemStatus } from '@/domain/work-items'

export type ContextKind =
  | 'message'
  | 'codeBlock'
  | 'sessionHistory'
  | 'fileEntry'
  | 'filePreview'
  | 'toolCall'
  | 'subAgent'
  | 'diffFile'
  | 'diffHunk'
  | 'checkpoint'
  | 'commit'
  | 'terminal'
  /** Sidebar / chrome managed terminal (tm_* local or SSH). */
  | 'managedTerminal'
  /** Remote SFTP tree entry in managed SSH files panel. */
  | 'sftpEntry'
  /** Local managed-terminal tree entry (term_fs_ls, launch cwd root). */
  | 'termFsEntry'
  | 'agentConfig'
  | 'skillConfig'
  | 'mcpServer'
  | 'plugin'
  | 'chatEmpty'
  | 'artifactChrome'
  | 'knowledgeNode'
  | 'knowledgeSpace'
  | 'knowledgeTree'
  | 'worktree'
  /** Work-item list row / calendar bar / day-more row. */
  | 'workItem'
  /** Calendar day blank / list empty create. */
  | 'workItemBlank'
  /** Recycle bin unified row. */
  | 'trashEntry'

export type ContextGroupId =
  | 'primary'
  | 'edit'
  | 'clipboard'
  | 'agent'
  | 'navigation'
  | 'session'
  | 'workspace'
  | 'git'
  | 'debug'
  | 'danger'
  | 'extensions'
  | string

/** Closed icon set — reuse palette names; render via one map. */
export type ContextIconName = PaletteIconName

export type ContextPayloadMap = {
  message: {
    message: Message
    isLastAssistant: boolean
    sessionId: string | null
  }
  codeBlock: { code: string; language?: string }
  sessionHistory: { sessionId: string; title: string; surface: 'chat' | 'code' }
  /** Nested worktree row under a host project (not a top-level conversation). */
  worktree: {
    hostSessionId: string
    worktreePath: string
    label: string
    /** Git branch when known (shown in delete confirm Modal). */
    branch?: string
    slotSessionId?: string
    worktreeId?: string
  }
  fileEntry: {
    path: string
    name: string
    isDir: boolean
    scopeId: string
    isDraft: boolean
    cwd: string | null
  }
  filePreview: { path: string; content?: string; mimeType?: string; cwd: string | null }
  toolCall: { tool: ToolCall }
  /** Prefer full TurnAgent — matches SubAgentCard */
  subAgent: { agent: TurnAgent }
  diffFile: { path: string; status: string; sessionId: string; cwd: string | null }
  diffHunk: { path: string; header?: string; text: string }
  checkpoint: { checkpointId: string; sessionId: string }
  commit: { sha: string; shortSha: string; message: string; sessionId: string }
  /** `target` distinguishes chrome vs xterm canvas (ControlledContextMenu). */
  terminal: { sessionId: string; status: string; target?: 'chrome' | 'canvas' }
  /** Active managed terminal row (sidebar list / session chrome). */
  managedTerminal: {
    terminalId: string
    kind: 'local' | 'ssh'
    title: string
  }
  /** Remote SFTP tree entry (managed SSH files panel). */
  sftpEntry: {
    terminalId: string
    path: string
    name: string
    isDir: boolean
  }
  /** Local managed-terminal tree entry (launch cwd root). */
  termFsEntry: {
    terminalId: string
    path: string
    name: string
    isDir: boolean
    /** Launch cwd for open-containing-folder trust boundary. */
    rootCwd: string
  }
  /**
   * Settings agent row. Hosts supply onEdit/onDelete so menus reuse existing
   * editor / delete-dialog state (same as kebab actions).
   */
  agentConfig: {
    agentId: string
    onEdit: () => void
    onDelete: () => void
  }
  /**
   * Settings skill row. `canDelete` false for plugin-provided read-only skills
   * (kebab also hides delete). Hosts supply view/delete handlers.
   */
  skillConfig: {
    skillId: string
    name: string
    canDelete: boolean
    onView: () => void
    onDelete: () => void
  }
  /** Settings MCP server row (standalone, not plugin-owned). */
  mcpServer: {
    serverId: string
    onEdit: () => void
    onDelete: () => void
  }
  /** Settings plugin row — view (when available) + uninstall. */
  plugin: {
    pluginId: string
    onUninstall: () => void
    /** Local cards and market detail paths; omit when no view action. */
    onView?: () => void
  }
  chatEmpty: { sessionId: string | null }
  artifactChrome: { tab: string }
  /**
   * Knowledge tree node. Hosts supply callbacks so menus reuse Workspace modals
   * (same pattern as skillConfig / agentConfig).
   */
  knowledgeNode: {
    nodeId: string
    kind: 'folder' | 'doc' | 'board'
    spaceId: string
    onNewDoc: () => void
    onNewBoard: () => void
    onNewFolder: () => void
    onRename: () => void
    onDelete: () => void
    onReveal?: () => void
  }
  /** Sidebar knowledge-space row — rename / delete via KnowledgeSpaceDialogHost. */
  knowledgeSpace: {
    spaceId: string
    name: string
    icon?: string
  }
  /**
   * Knowledge tree blank area (root). Hosts supply create callbacks so menus
   * reuse Workspace create flows (same pattern as knowledgeNode).
   */
  knowledgeTree: {
    onNewDoc: () => void
    onNewBoard: () => void
    onNewFolder: () => void
  }
  /**
   * Work item row/bar. Identity-only payload; provider imports stores/dialogs
   * (sessionHistory pattern). No onSoftDelete — delete opens dialog store.
   */
  workItem: {
    itemId: string
    title: string
    status: WorkItemStatus
    archived: boolean
    links: WorkItemLinks
  }
  /** Blank area create; missing dates normalize to local today. */
  workItemBlank: {
    startOn?: string
    endOn?: string
  }
  /** Recycle bin row — host supplies restore / hard-delete openers. */
  trashEntry: {
    key: string
    source: 'session' | 'knowledge' | 'workItem' | 'automation'
    id: string
    title: string
    onRestore: () => void
    onHardDelete: () => void
  }
}

/** Discriminated union so `req.kind` narrows `req.payload` in providers. */
export type ContextRequest<K extends ContextKind = ContextKind> = {
  [P in K]: { kind: P; payload: ContextPayloadMap[P] }
}[K]

/** Serializable / settings-safe. No run(). */
export interface ContextMenuItemMeta {
  id: string
  /** i18n key, e.g. 'contextMenu.message.copy' */
  labelKey: string
  kind: ContextKind
  group: ContextGroupId
  danger?: boolean
  /** Only when a real GlobalCommand id exists today */
  commandId?: string
  /** Optional closed icon name */
  icon?: ContextIconName
}

/** Runtime row after provider + payload. */
export interface ContextMenuItemDef {
  id: string
  label: string
  group: ContextGroupId
  icon?: ContextIconName
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  disabledReason?: string
  separatorBefore?: boolean
  children?: ContextMenuItemDef[]
  checked?: boolean
  commandId?: string
  run: () => void | Promise<void>
}

/**
 * Snapshot + pure helpers passed into every provider.
 * Providers MAY import sessionService / domain/commands / ipc directly for run() closures.
 * Do not re-wrap every domain method on ctx.
 */
export interface ContextMenuBuildContext {
  t: TFunction
  isMac: boolean
  activeView: ActiveView
  /** chat | code when on a conversation surface */
  surface: Surface | null
  activeSessionId: string | null
  /** Domain session status for active session (or targeted session when payload has sessionId) */
  sessionStatus: 'idle' | 'running' | 'error' | string
  /** True when active session has interrupt pending (regenerate allowed while running) */
  sessionInterrupt: boolean
  /** Convenience: wraps ipc/clipboard.copyText */
  copyText: (text: string) => Promise<boolean>
}

export type ContextProvider = (
  req: ContextRequest,
  ctx: ContextMenuBuildContext,
) => ContextMenuItemDef[]

export type ContextMenuPrefs = {
  version: 1
  disabledIds: string[]
  /** PR-7+: kind → ordered item ids */
  orderByKind?: Partial<Record<ContextKind, string[]>>
}
