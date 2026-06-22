import { describe, it, expect } from 'vitest'
import type { Hook, HookContext } from '@hip/protocol'
import { HookRegistry } from './registry.js'

function ctx(toolName: string): HookContext {
  return { sessionId: 'sid-1', toolName }
}

describe('HookRegistry', () => {
  it('PreToolUse matcher "Bash" matches Bash tool', async () => {
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
    expect(result).toEqual({ kind: 'allow' })
  })

  it('PreToolUse matcher "Bash" skips Write tool', async () => {
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
    const result = await registry.fire('PreToolUse', ctx('Write'))
    expect(called).toBe(false)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('wildcard "mcp__*" matches mcp__github__create_pr', async () => {
    const registry = new HookRegistry()
    let called = false
    registry.register({
      event: 'PreToolUse',
      matcher: 'mcp__*',
      handler: async () => {
        called = true
        return { kind: 'allow' }
      },
    })
    const result = await registry.fire('PreToolUse', ctx('mcp__github__create_pr'))
    expect(called).toBe(true)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('no matcher fires on all tools', async () => {
    const registry = new HookRegistry()
    let called = false
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        called = true
        return { kind: 'allow' }
      },
    })
    // Fire with any tool name — handler should still be called
    const result = await registry.fire('PreToolUse', ctx('SomeRandomTool'))
    expect(called).toBe(true)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('multiple hooks fire in order', async () => {
    const order: string[] = []
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: async () => {
        order.push('first')
        return { kind: 'allow' }
      },
    })
    registry.register({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: async () => {
        order.push('second')
        return { kind: 'allow' }
      },
    })
    await registry.fire('PreToolUse', ctx('Bash'))
    expect(order).toEqual(['first', 'second'])
  })

  it('hook timeout → fail-closed deny', { timeout: 10000 }, async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        // Sleep longer than the 5s internal timeout
        await new Promise((resolve) => setTimeout(resolve, 6000))
        return { kind: 'allow' }
      },
    })
    const result = await registry.fire('PreToolUse', ctx('Bash'))
    expect(result).toEqual({ kind: 'deny', reason: 'Hook crashed or timed out' })
  })

  it('hook throws → fail-closed deny', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        throw new Error('boom')
      },
    })
    const result = await registry.fire('PreToolUse', ctx('Bash'))
    expect(result).toEqual({ kind: 'deny', reason: 'Hook crashed or timed out' })
  })

  it('re-entrancy detected and thrown', async () => {
    const registry = new HookRegistry()
    const hook: Hook = {
      event: 'PreToolUse',
      handler: async () => {
        // Re-entrant fire from within the handler
        await registry.fire('PreToolUse', ctx('Bash'))
        return { kind: 'allow' }
      },
    }
    registry.register(hook)
    await expect(
      registry.fire('PreToolUse', ctx('Bash')),
    ).rejects.toThrow('Hook re-entrancy detected')
  })

  it('empty registry returns allow', async () => {
    const registry = new HookRegistry()
    const result = await registry.fire('PreToolUse', ctx('Bash'))
    expect(result).toEqual({ kind: 'allow' })
  })

  it('clear() removes all registered hooks', () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => ({ kind: 'allow' }),
    })
    registry.register({
      event: 'TurnStart',
      handler: async () => ({ kind: 'allow' }),
    })
    expect(registry.hasMatchingHook('PreToolUse')).toBe(true)
    expect(registry.hasMatchingHook('TurnStart')).toBe(true)

    registry.clear()
    expect(registry.hasMatchingHook('PreToolUse')).toBe(false)
    expect(registry.hasMatchingHook('TurnStart')).toBe(false)
  })

  it('clear() on empty registry is idempotent', () => {
    const registry = new HookRegistry()
    registry.clear()
    registry.clear()
    expect(registry.hasMatchingHook('PreToolUse')).toBe(false)
  })
})
