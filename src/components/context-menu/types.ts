import type { TFunction } from 'i18next'
import type { Message, ToolCall } from '@hip/protocol'
import type { PaletteIconName } from '@/components/command-palette/types'
import type { TurnAgent } from '@/lib/turnAgents'
import type { ActiveView, Surface } from '@/store/uiStore'

export type ContextKind =
  | 'message'
  | 'codeBlock'
  | 'sessionTab'
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
  | 'agentConfig'
  | 'skillConfig'
  | 'mcpServer'
  | 'plugin'
  | 'chatEmpty'
  | 'artifactChrome'

export type ContextGroupId =
  | 'primary'
  | 'edit'
  | 'clipboard'
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
  sessionTab: { sessionId: string; title: string; surface: 'chat' | 'code' }
  sessionHistory: { sessionId: string; title: string; surface: 'chat' | 'code' }
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
  terminal: { sessionId: string; status: string }
  agentConfig: { agentId: string }
  skillConfig: { skillId: string; name: string }
  mcpServer: { serverId: string }
  plugin: { pluginId: string }
  chatEmpty: { sessionId: string | null }
  artifactChrome: { tab: string }
}

export type ContextRequest<K extends ContextKind = ContextKind> = {
  kind: K
  payload: ContextPayloadMap[K]
}

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
  sessionInterrupt: boolean | undefined
  openSessionIds: string[]
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
