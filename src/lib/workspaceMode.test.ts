import { describe, expect, it } from 'vitest'
import {
  surfaceFromWorkspaceMode,
  workspaceModeFromSurface,
  workspaceModeOf,
} from './workspaceMode'

describe('workspaceMode mapping (P0)', () => {
  it('maps surface chat→sandbox and code→project', () => {
    expect(workspaceModeFromSurface('chat')).toBe('sandbox')
    expect(workspaceModeFromSurface('code')).toBe('project')
    expect(workspaceModeFromSurface(undefined)).toBe('project')
  })

  it('round-trips surface ↔ workspaceMode', () => {
    expect(surfaceFromWorkspaceMode('sandbox')).toBe('chat')
    expect(surfaceFromWorkspaceMode('project')).toBe('code')
    expect(workspaceModeFromSurface(surfaceFromWorkspaceMode('sandbox'))).toBe('sandbox')
  })

  it('prefers explicit workspaceMode over surface', () => {
    expect(workspaceModeOf({ surface: 'chat', workspaceMode: 'project' })).toBe('project')
    expect(workspaceModeOf({ surface: 'code', workspaceMode: 'sandbox' })).toBe('sandbox')
  })

  it('falls back to cwd when neither surface nor mode set', () => {
    expect(workspaceModeOf({ cwd: '/tmp/proj' })).toBe('project')
    expect(workspaceModeOf({})).toBe('sandbox')
  })
})
