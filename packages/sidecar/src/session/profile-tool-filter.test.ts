import { describe, it, expect } from 'vitest'
import { buildTools } from './tools.js'
import { AgentProfileManager } from './agent-profile-manager.js'

describe('profile-based tool filtering', () => {
  it('permissionMode "chat" filters out write_file even if allowedTools includes it (PermissionMode wins)', () => {
    const tools = buildTools('/tmp', undefined, '/tmp', undefined, {
      permissionMode: 'chat',
      allowedTools: ['write_file', 'read_file', 'ls', 'glob', 'grep', 'write_todos'],
    })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('write_file')
    expect(names).toContain('read_file')
  })

  it('allowedTools restricts to only listed tools', () => {
    const tools = buildTools('/tmp', undefined, '/tmp', undefined, {
      permissionMode: 'edit',
      allowedTools: ['read_file', 'ls'],
    })
    const names = tools.map((t) => t.name)
    expect(names).toEqual(['read_file', 'ls'])
  })

  it('blockedTools excludes specified tools', () => {
    const tools = buildTools('/tmp', undefined, '/tmp', undefined, {
      permissionMode: 'edit',
      blockedTools: ['write_todos'],
    })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('write_todos')
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
  })

  it('worker profile tools exclude write_todos via blockedTools', () => {
    const mgr = new AgentProfileManager()
    mgr.setActiveProfile('worker')
    const profile = mgr.getActiveProfile()
    expect(profile.blockedTools).toContain('write_todos')

    const tools = buildTools('/tmp', undefined, '/tmp', undefined, {
      permissionMode: 'edit',
      allowedTools: profile.allowedTools,
      blockedTools: profile.blockedTools,
    })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('write_todos')
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })
})
