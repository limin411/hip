import { describe, it, expect } from 'vitest'
import { BUILTIN_TOOL_NAMES, grantedMcpServerIds } from './agentTools'

describe('BUILTIN_TOOL_NAMES', () => {
  it('lists every always-on built-in tool an internal agent has', () => {
    expect(BUILTIN_TOOL_NAMES).toEqual([
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'write_todos',
      'git_commit',
      'git_create_branch',
      'git_switch_branch',
      'run_script',
      'use_skill',
    ])
  })
})

describe('grantedMcpServerIds (legacy migration helper)', () => {
  it('parses granted server ids from a legacy allow-list', () => {
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__*', 'use_skill', 'mcp__db__*'])).toEqual(['fs', 'db'])
  })
  it('returns [] for undefined or no wildcard entries', () => {
    expect(grantedMcpServerIds(undefined)).toEqual([])
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__read'])).toEqual([])
  })
})
