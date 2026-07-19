import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import {
  runtimeModeOf,
  isExternalPrimary,
  isAcpCapableAgent,
  resolveValidAcpAgentId,
} from './sessionAgent'

const agent = (
  id: string,
  kind: AgentConfig['kind'],
  enabled = true,
): Pick<AgentConfig, 'id' | 'kind' | 'enabled'> => ({ id, kind, enabled })

describe('runtimeModeOf', () => {
  it('treats undefined / empty / whitespace / builtin as builtin', () => {
    expect(runtimeModeOf(undefined)).toBe('builtin')
    expect(runtimeModeOf(null)).toBe('builtin')
    expect(runtimeModeOf('')).toBe('builtin')
    expect(runtimeModeOf('   ')).toBe('builtin')
    expect(runtimeModeOf('builtin')).toBe('builtin')
  })
  it('treats any other id as acp_primary', () => {
    expect(runtimeModeOf('acp-1')).toBe('acp_primary')
    expect(runtimeModeOf('opencode')).toBe('acp_primary')
  })
})

describe('isExternalPrimary', () => {
  it('mirrors runtimeModeOf', () => {
    expect(isExternalPrimary(undefined)).toBe(false)
    expect(isExternalPrimary('builtin')).toBe(false)
    expect(isExternalPrimary('x')).toBe(true)
  })
})

describe('isAcpCapableAgent', () => {
  it('requires enabled acp or opencode', () => {
    expect(isAcpCapableAgent(undefined)).toBe(false)
    expect(isAcpCapableAgent(agent('a', 'acp'))).toBe(true)
    expect(isAcpCapableAgent(agent('o', 'opencode'))).toBe(true)
    expect(isAcpCapableAgent(agent('a', 'acp', false))).toBe(false)
    expect(isAcpCapableAgent(agent('i', 'internal'))).toBe(false)
    expect(isAcpCapableAgent(agent('c', 'custom'))).toBe(false)
  })
})

describe('resolveValidAcpAgentId', () => {
  const agents = [
    agent('acp-1', 'acp'),
    agent('legacy', 'opencode'),
    agent('off', 'acp', false),
    agent('coder', 'internal'),
  ]
  it('returns id for enabled acp/opencode', () => {
    expect(resolveValidAcpAgentId('acp-1', agents)).toBe('acp-1')
    expect(resolveValidAcpAgentId('legacy', agents)).toBe('legacy')
  })
  it('omits builtin / empty / whitespace / unknown / disabled / wrong kind', () => {
    expect(resolveValidAcpAgentId(undefined, agents)).toBeUndefined()
    expect(resolveValidAcpAgentId('', agents)).toBeUndefined()
    expect(resolveValidAcpAgentId('  ', agents)).toBeUndefined()
    expect(resolveValidAcpAgentId('builtin', agents)).toBeUndefined()
    expect(resolveValidAcpAgentId('gone', agents)).toBeUndefined()
    expect(resolveValidAcpAgentId('off', agents)).toBeUndefined()
    expect(resolveValidAcpAgentId('coder', agents)).toBeUndefined()
  })
})
