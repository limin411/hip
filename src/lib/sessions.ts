import type { SessionConfig } from '@hip/protocol'
import { surfaceFromWorkspaceMode, workspaceModeOf, type WorkspaceMode } from './workspaceMode'

export type { WorkspaceMode }
export { workspaceModeOf, surfaceFromWorkspaceMode, workspaceModeFromSurface } from './workspaceMode'

export type SessionSurface = 'chat' | 'code' | 'terminal'

/** True for SSH managed-terminal agent conversations (excluded from Chats/Projects). */
export function isTerminalSession(
  config: Pick<SessionConfig, 'surface' | 'managedTerminalId'>,
): boolean {
  return config.surface === 'terminal'
}

/** The surface a session belongs to. Explicit 'terminal' always wins; else prefer
 *  workspaceMode when set; else config.surface; missing value is treated as 'code',
 *  the fuller surface (legacy back-compat). */
export function surfaceOf(
  config: Pick<SessionConfig, 'surface' | 'workspaceMode' | 'cwd'>,
): SessionSurface {
  if (config.surface === 'terminal') return 'terminal'
  if (config.workspaceMode === 'sandbox' || config.workspaceMode === 'project') {
    return surfaceFromWorkspaceMode(config.workspaceMode)
  }
  return config.surface === 'chat' || config.surface === 'code' ? config.surface : 'code'
}

/** Product workspace mode for UI (sandbox | project). */
export function sessionWorkspaceMode(
  config: Pick<SessionConfig, 'surface' | 'workspaceMode' | 'cwd'>,
): WorkspaceMode {
  return workspaceModeOf(config)
}
