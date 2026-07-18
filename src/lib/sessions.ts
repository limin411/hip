import type { SessionConfig } from '@hip/protocol'
import { surfaceFromWorkspaceMode, workspaceModeOf, type WorkspaceMode } from './workspaceMode'

export type { WorkspaceMode }
export { workspaceModeOf, surfaceFromWorkspaceMode, workspaceModeFromSurface } from './workspaceMode'

/** The surface a session belongs to. Prefer workspaceMode when set; else config.surface;
 *  missing value is treated as 'code', the fuller surface. */
export function surfaceOf(
  config: Pick<SessionConfig, 'surface' | 'workspaceMode' | 'cwd'>,
): 'chat' | 'code' {
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
