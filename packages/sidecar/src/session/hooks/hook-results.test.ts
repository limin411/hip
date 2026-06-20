import { describe, it, expect } from 'vitest'
import type { HookContext } from '@hip/protocol'
import { HookRegistry } from './registry.js'

function ctx(toolName?: string, toolInput?: Record<string, unknown>): HookContext {
  return { sessionId: 'sid-1', toolName, toolInput }
}

describe('HookResult: modify (PreToolUse)', () => {
  it('modify result modifies tool input for subsequent hooks and final output', async () => {
    const registry = new HookRegistry()
    const order: string[] = []

    // First hook: sees original input, returns modify with new input
    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async (c) => {
        order.push(`first-saw:${JSON.stringify(c.toolInput)}`)
        return {
          kind: 'modify',
          modifiedInput: { path: '/modified/path', content: 'modified content' },
        }
      },
    })

    // Second hook: should receive the modified input
    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async (c) => {
        order.push(`second-saw:${JSON.stringify(c.toolInput)}`)
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx('Write', { path: '/orig', content: 'orig' }))
    expect(result.kind).toBe('modify')
    expect(result.modifiedInput).toEqual({ path: '/modified/path', content: 'modified content' })
    expect(order).toEqual([
      'first-saw:{"path":"/orig","content":"orig"}',
      'second-saw:{"path":"/modified/path","content":"modified content"}',
    ])
  })

  it('last modify wins when multiple hooks return modify', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async () => ({
        kind: 'modify',
        modifiedInput: { a: 1 },
      }),
    })

    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async () => ({
        kind: 'modify',
        modifiedInput: { a: 2, b: 3 },
      }),
    })

    const result = await registry.fire('PreToolUse', ctx('Write', { original: true }))
    expect(result.kind).toBe('modify')
    expect(result.modifiedInput).toEqual({ a: 2, b: 3 })
  })

  it('deny still short-circuits even after modify', async () => {
    const registry = new HookRegistry()
    let secondCalled = false

    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async () => ({ kind: 'modify', modifiedInput: { safe: true } }),
    })

    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async () => {
        secondCalled = true
        return { kind: 'deny', reason: 'blocked' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx('Write', { original: true }))
    expect(result.kind).toBe('deny')
    expect(result.reason).toBe('blocked')
    // Second hook was called (deny is terminal after it runs)
    expect(secondCalled).toBe(true)
  })
})

describe('HookResult: continue (Stop)', () => {
  it('Stop continue returns prompt and additionalContexts', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'Stop',
      handler: async () => ({
        kind: 'continue',
        prompt: 'Please also check the edge case',
        additionalContexts: ['Context: running in CI mode'],
      }),
    })

    const result = await registry.fire('Stop', { sessionId: 'sid-1' })
    expect(result.kind).toBe('continue')
    expect(result.prompt).toBe('Please also check the edge case')
    expect(result.additionalContexts).toEqual(['Context: running in CI mode'])
  })

  it('Stop allow returns allow (not continue)', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'Stop',
      handler: async () => ({ kind: 'allow' }),
    })

    const result = await registry.fire('Stop', { sessionId: 'sid-1' })
    expect(result.kind).toBe('allow')
  })

  it('Stop without prompt returns continue but no prompt', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'Stop',
      handler: async () => ({ kind: 'continue' }),
    })

    const result = await registry.fire('Stop', { sessionId: 'sid-1' })
    expect(result.kind).toBe('continue')
    expect(result.prompt).toBeUndefined()
  })
})

describe('HookResult: additionalContexts aggregation', () => {
  it('multiple hooks aggregate additionalContexts', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'TurnStart',
      handler: async () => ({
        kind: 'allow',
        additionalContexts: ['ctx-a'],
      }),
    })

    registry.register({
      event: 'TurnStart',
      handler: async () => ({
        kind: 'allow',
        additionalContexts: ['ctx-b', 'ctx-c'],
      }),
    })

    const result = await registry.fire('TurnStart', { sessionId: 'sid-1' })
    expect(result.kind).toBe('allow')
    expect(result.additionalContexts).toEqual(['ctx-a', 'ctx-b', 'ctx-c'])
  })

  it('additionalContexts aggregate across allow, modify, and continue', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'Stop',
      handler: async () => ({
        kind: 'allow',
        additionalContexts: ['allow-ctx'],
      }),
    })

    registry.register({
      event: 'Stop',
      handler: async () => ({
        kind: 'continue',
        prompt: 'keep going',
        additionalContexts: ['continue-ctx'],
      }),
    })

    const result = await registry.fire('Stop', { sessionId: 'sid-1' })
    expect(result.kind).toBe('continue')
    expect(result.prompt).toBe('keep going')
    expect(result.additionalContexts).toEqual(['allow-ctx', 'continue-ctx'])
  })

  it('empty hooks list returns allow with no additionalContexts', async () => {
    const registry = new HookRegistry()
    const result = await registry.fire('TurnStart', { sessionId: 'sid-1' })
    expect(result.kind).toBe('allow')
    expect(result.additionalContexts).toBeUndefined()
  })
})

describe('HookResult: backward compatibility', () => {
  it('existing hooks returning { kind: "allow" } still work', async () => {
    const registry = new HookRegistry()
    let called = false

    registry.register({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: async () => {
        called = true
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx('Bash'))
    expect(called).toBe(true)
    expect(result.kind).toBe('allow')
  })

  it('updatedInput on allow — registry aggregates but updatedInput is not forwarded (use modify kind instead)', async () => {
    const registry = new HookRegistry()

    registry.register({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: async () => ({
        kind: 'allow',
        updatedInput: { command: 'ls -la' },
      }),
    })

    const result = await registry.fire('PreToolUse', ctx('Bash'))
    // The registry aggregates non-terminal results; updatedInput on allow
    // hooks is not forwarded (use { kind: 'modify', modifiedInput } instead).
    expect(result.kind).toBe('allow')
    expect(result.updatedInput).toBeUndefined()
  })
})
