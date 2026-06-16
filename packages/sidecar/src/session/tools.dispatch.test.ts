import { describe, it, expect } from 'vitest'
import { buildTools } from './tools.js'

describe('buildTools dispatch_agent', () => {
  it('omits dispatch_agent when no agents are available', () => {
    const tools = buildTools('/tmp', async () => '', '/tmp')
    expect(tools.find((t) => t.name === 'dispatch_agent')).toBeUndefined()
  })

  it('adds dispatch_agent listing the available agents and routes the call', async () => {
    const calls: Array<{ agent: string; task: string }> = []
    const tools = buildTools('/tmp', async () => '', '/tmp', {
      agents: [{ id: 'opencode', name: 'OpenCode', description: 'edits code' }],
      run: async (agent, task) => { calls.push({ agent, task }); return `done:${agent}` },
    })
    const dispatch = tools.find((t) => t.name === 'dispatch_agent')!
    expect(dispatch).toBeDefined()
    expect(dispatch.description).toContain('OpenCode')
    expect(dispatch.description).toContain('edits code')
    const out = await dispatch.invoke({ agent: 'opencode', task: 'fix bug' })
    expect(out).toBe('done:opencode')
    expect(calls).toEqual([{ agent: 'opencode', task: 'fix bug' }])
  })

  it('omits dispatch_agent on the depth-1 path (no spawnSubagent) even if dispatch is passed', () => {
    // A depth-1 worker calls buildTools without spawnSubagent; it must get neither task nor dispatch_agent.
    const tools = buildTools('/tmp', undefined, '/tmp', {
      agents: [{ id: 'opencode', name: 'OpenCode', description: 'edits code' }],
      run: async () => 'x',
    })
    expect(tools.find((t) => t.name === 'dispatch_agent')).toBeUndefined()
    expect(tools.find((t) => t.name === 'task')).toBeUndefined()
  })

  it('formats roster lines without a colon when an agent has no description', () => {
    const tools = buildTools('/tmp', async () => '', '/tmp', {
      agents: [{ id: 'plain', name: 'Plain' }],
      run: async () => 'x',
    })
    const dispatch = tools.find((t) => t.name === 'dispatch_agent')!
    expect(dispatch.description).toContain('- plain (Plain)')
    expect(dispatch.description).not.toContain('- plain (Plain):')
  })
})
