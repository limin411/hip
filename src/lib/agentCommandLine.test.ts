import { describe, it, expect } from 'vitest'
import { agentCommandLine } from './agentCommandLine.js'

describe('agentCommandLine', () => {
  it('joins command and args', () => {
    expect(agentCommandLine({ command: 'opencode', args: ['acp', '--pure'] })).toBe('opencode acp --pure')
  })

  it('does not throw when args is undefined', () => {
    // Empty arrays are dropped by the Rust→JSON boundary (skip_serializing_if = Vec::is_empty),
    // so an agent with no args arrives with `args` omitted (undefined), not [].
    expect(agentCommandLine({ command: 'opencode' })).toBe('opencode')
  })

  it('handles an empty command with no args', () => {
    expect(agentCommandLine({ command: '' })).toBe('')
  })
})
