import { describe, it, expect } from 'vitest'
import type { AgentConfig } from './index.js'

describe('AgentConfig acp kind', () => {
  it('accepts an acp agent with quirks', () => {
    const a: AgentConfig = {
      id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'],
      quirks: 'opencode', enabled: true,
    }
    expect(a.kind).toBe('acp')
  })
})
