import { describe, it, expect } from 'vitest'
import { TOOL_GROUPS, groupsToToolNames, toolNamesToGroups, DEFAULT_TOOL_GROUPS } from './agentTools'

describe('agentTools', () => {
  it('expands group booleans to the flat tool-name list', () => {
    expect(groupsToToolNames({ read: true, edit: false, plan: true, git: false }))
      .toEqual([...TOOL_GROUPS.read, ...TOOL_GROUPS.plan])
  })
  it('round-trips: a name present in a group turns that group on', () => {
    const names = [...TOOL_GROUPS.read, 'write_file']
    expect(toolNamesToGroups(names)).toEqual({ read: true, edit: true, plan: false, git: false })
  })
  it('treats undefined allowedTools as every group on (legacy-safe)', () => {
    expect(toolNamesToGroups(undefined)).toEqual({ read: true, edit: true, plan: true, git: true })
  })
  it('default groups are read+edit+plan, git off', () => {
    expect(DEFAULT_TOOL_GROUPS).toEqual({ read: true, edit: true, plan: true, git: false })
  })
})
