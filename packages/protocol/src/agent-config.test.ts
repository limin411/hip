import { describe, it, expect } from 'vitest'
import type { AgentConfig } from './index.js'

describe('AgentConfig acp kind', () => {
  it('accepts an acp agent with authMode and quirks', () => {
    const a: AgentConfig = {
      id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'],
      transport: 'rich', acceptsModelConfig: true, authMode: 'opencode-self', quirks: 'opencode', enabled: true,
    }
    expect(a.kind).toBe('acp')
    expect(a.authMode).toBe('opencode-self')
  })
})
