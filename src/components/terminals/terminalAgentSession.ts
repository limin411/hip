import type { SessionConfig } from '@hip/protocol'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useHipConfigStore } from '@/store/hipConfigStore'

/**
 * Create a terminal agent session under `terminalId` (spec §3.5.5) and make it the
 * per-terminal active session without stealing the domain chat/code active pointer.
 * Returns the new session id (null when the terminal is not an SSH record).
 * Terminal ops assistant always runs the built-in hip agent (no external ACP primary).
 */
export async function startTerminalAgentChat(
  terminalId: string,
  opts?: { permissionMode?: 'chat' | 'edit' | 'full' },
): Promise<string | null> {
  // Lazy import keeps context-menu / HostLibrary tests free of the i18n chain.
  const { sessionService } = await import('@/domain')
  const term = useManagedTerminalStore.getState().getTerminal(terminalId)
  if (!term || term.kind !== 'ssh') return null
  // New terminal chats use the user's active model (falls back to defaults).
  const activeModel = useHipConfigStore.getState().config.activeModel
  const config: SessionConfig = {
    ...DEFAULT_CONFIG,
    ...(activeModel
      ? {
          llmProvider: activeModel.providerID,
          model: activeModel.modelID,
          ...(activeModel.baseURL ? { baseURL: activeModel.baseURL } : {}),
        }
      : {}),
    surface: 'terminal',
    managedTerminalId: terminalId,
    hostId: term.hostId,
    ...(term.remotePath ? { remotePathHint: term.remotePath } : {}),
    ...(opts?.permissionMode ? { permissionMode: opts.permissionMode } : {}),
    workspaceMode: 'sandbox',
    cwd: undefined,
  }
  const id = sessionService.createSession(config, { activate: false })
  useTerminalAgentStore.getState().setActiveSession(terminalId, id)
  useUiStore.getState().setTerminalPanelTab(terminalId, 'agent')
  useUiStore.getState().setTerminalPanelOpen(true)
  return id
}
