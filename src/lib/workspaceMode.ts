/** Product workspace mode (spec §3.1). Legacy `surface` maps into this. */
export type WorkspaceMode = 'sandbox' | 'project'

/** Map legacy SessionConfig.surface → workspaceMode. Terminal sessions are non-sandbox. */
export function workspaceModeFromSurface(surface: 'chat' | 'code' | 'terminal' | undefined): WorkspaceMode {
  return surface === 'chat' ? 'sandbox' : 'project'
}

/** Map workspaceMode → wire surface for protocol compatibility. */
export function surfaceFromWorkspaceMode(mode: WorkspaceMode): 'chat' | 'code' {
  return mode === 'sandbox' ? 'chat' : 'code'
}

/**
 * Resolve effective workspace mode from config fields.
 * Prefer explicit workspaceMode when present; else surface; else cwd ⇒ project.
 */
export function workspaceModeOf(config: {
  surface?: 'chat' | 'code' | 'terminal'
  workspaceMode?: WorkspaceMode
  cwd?: string
}): WorkspaceMode {
  if (config.workspaceMode === 'sandbox' || config.workspaceMode === 'project') {
    return config.workspaceMode
  }
  if (config.surface === 'chat' || config.surface === 'code' || config.surface === 'terminal') {
    return workspaceModeFromSurface(config.surface)
  }
  return config.cwd ? 'project' : 'sandbox'
}
