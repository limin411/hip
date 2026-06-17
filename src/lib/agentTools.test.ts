import { describe, it, expect } from 'vitest'
import {
  TOOL_GROUPS,
  groupsToToolNames,
  toolNamesToGroups,
  DEFAULT_TOOL_GROUPS,
  mcpServerWildcard,
  grantedMcpServerIds,
} from './agentTools'

describe('agentTools', () => {
  it('expands group booleans to the flat tool-name list', () => {
    expect(groupsToToolNames({ read: true, edit: false, plan: true, git: false, skill: false, script: false }))
      .toEqual([...TOOL_GROUPS.read, ...TOOL_GROUPS.plan])
  })
  it('includes use_skill / run_script when their groups are on (stable order, after git)', () => {
    expect(groupsToToolNames({ read: false, edit: false, plan: false, git: false, skill: true, script: true }))
      .toEqual(['use_skill', 'run_script'])
  })
  it('round-trips: a name present in a group turns that group on', () => {
    const names = [...TOOL_GROUPS.read, 'write_file']
    expect(toolNamesToGroups(names)).toEqual({ read: true, edit: true, plan: false, git: false, skill: false, script: false })
  })
  it('detects use_skill / run_script', () => {
    expect(toolNamesToGroups(['use_skill'])).toEqual({ read: false, edit: false, plan: false, git: false, skill: true, script: false })
    expect(toolNamesToGroups(['run_script'])).toEqual({ read: false, edit: false, plan: false, git: false, skill: false, script: true })
  })
  it('treats undefined allowedTools as every group on (legacy-safe)', () => {
    expect(toolNamesToGroups(undefined)).toEqual({ read: true, edit: true, plan: true, git: true, skill: true, script: true })
  })
  it('default groups are read+edit+plan, git/skill/script off', () => {
    expect(DEFAULT_TOOL_GROUPS).toEqual({ read: true, edit: true, plan: true, git: false, skill: false, script: false })
  })
  it('ignores mcp wildcard entries when deriving static groups', () => {
    expect(toolNamesToGroups(['mcp__fs__*', 'mcp__db__*']))
      .toEqual({ read: false, edit: false, plan: false, git: false, skill: false, script: false })
  })
})

describe('mcp wildcard helpers', () => {
  it('builds a whole-server wildcard entry', () => {
    expect(mcpServerWildcard('fs')).toBe('mcp__fs__*')
  })
  it('parses granted server ids from an allow-list', () => {
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__*', 'use_skill', 'mcp__db__*'])).toEqual(['fs', 'db'])
  })
  it('returns [] for undefined or no wildcard entries', () => {
    expect(grantedMcpServerIds(undefined)).toEqual([])
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__read'])).toEqual([])
  })
})
