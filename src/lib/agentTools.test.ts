import { describe, it, expect } from 'vitest'
import { grantedMcpServerIds } from './agentTools'

describe('grantedMcpServerIds (legacy migration helper)', () => {
  it('parses granted server ids from a legacy allow-list, ignoring non-wildcard entries', () => {
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__*', 'use_skill', 'mcp__db__*'])).toEqual(['fs', 'db'])
  })
  it('returns [] for undefined', () => {
    expect(grantedMcpServerIds(undefined)).toEqual([])
  })
  it('returns [] when no whole-server wildcard entries are present', () => {
    // A scoped `mcp__fs__read` (single tool, not the `__*` whole-server grant) is NOT a server grant.
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__read'])).toEqual([])
  })
  it('preserves server-id order and keeps dashes/underscores inside the id', () => {
    expect(grantedMcpServerIds(['mcp__srv-1__*', 'mcp__my_server__*'])).toEqual(['srv-1', 'my_server'])
  })
})
