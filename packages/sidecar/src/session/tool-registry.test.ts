import { describe, it, expect, vi } from 'vitest'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { ToolRegistry, createScope } from './tool-registry.js'
import type { Scope } from './tool-registry.js'

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Build a mock LangChain tool returning a known string. */
function mockTool(
  name: string,
  fn?: (args: Record<string, unknown>) => string,
): StructuredToolInterface {
  return tool(
    async (args: { message?: string }) => {
      const result = fn ? fn(args as Record<string, unknown>) : `${name}: ok`
      return result
    },
    {
      name,
      description: `Mock tool: ${name}`,
      schema: z.object({ message: z.string().optional() }),
    },
  )
}

/** Build a mock tool that throws. */
function throwingTool(name: string, errorMessage: string): StructuredToolInterface {
  return tool(
    async () => {
      throw new Error(errorMessage)
    },
    {
      name,
      description: `Throwing mock: ${name}`,
      schema: z.object({}),
    },
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ToolRegistry', () => {
  // ── 1. register 3 tools → materialize returns 3 definitions ─────────────
  it('register 3 tools → materialize returns 3 definitions', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('alpha'))
    registry.register(mockTool('beta'))
    registry.register(mockTool('gamma'))

    const { definitions } = registry.materialize()

    expect(definitions).toHaveLength(3)
    const names = definitions.map((d) => d.name).sort()
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
    expect(registry.size).toBe(3)
  })

  // ── 2. close scope → only scoped tools removed, others survive ──────────
  it('close scope → only scoped tools removed, others survive', () => {
    const registry = new ToolRegistry()
    // Application-scope (no scope) tools survive scope close.
    registry.register(mockTool('app_tool'))
    // Session-scope tools are removed when the scope is closed.
    const sessionScope = createScope()
    registry.register(mockTool('session_tool_a'), sessionScope)
    registry.register(mockTool('session_tool_b'), sessionScope)
    expect(registry.size).toBe(3)

    registry.unregisterScope(sessionScope)

    expect(registry.size).toBe(1)
    expect(registry.lookup('app_tool')).toBeDefined()
    expect(registry.lookup('session_tool_a')).toBeUndefined()
    expect(registry.lookup('session_tool_b')).toBeUndefined()
  })

  // ── 3. materialize then unregister a tool → settle returns stale error ──
  it('materialize then unregister a tool → settle returns stale error', async () => {
    const registry = new ToolRegistry()
    const unregister = registry.register(mockTool('ephemeral'))

    const materialization = registry.materialize()
    expect(materialization.definitions).toHaveLength(1)

    // Mutation after materialization bumps the registry generation.
    unregister()

    const result = await materialization.settle({
      name: 'ephemeral',
      callId: 'call-1',
      args: {},
    })

    expect(result.content).toBe('Tool registration changed after materialization')
    expect(result.tool_call_id).toBe('call-1')
    expect(result.name).toBe('ephemeral')
  })

  // ── 4. duplicate registration (same name, different scope) → latest wins
  it('duplicate registration (same name, different scope) → latest wins', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('shared', () => 'first'))
    const sessionScope = createScope()
    registry.register(mockTool('shared', () => 'second'), sessionScope)

    expect(registry.size).toBe(1)
    const latest = registry.lookup('shared')
    expect(latest).toBeDefined()

    const { definitions } = registry.materialize()
    expect(definitions).toHaveLength(1)
    expect(definitions[0]!.name).toBe('shared')

    // Closing the session scope should fall back to the application registration.
    registry.unregisterScope(sessionScope)
    expect(registry.size).toBe(1)
    const fallback = registry.lookup('shared')
    expect(fallback).toBeDefined()
  })

  // ── 5. allowed/blocked permissions filtering in materialize ─────────────
  it('allowed/blocked permissions filtering in materialize', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('read_file'))
    registry.register(mockTool('write_file'))
    registry.register(mockTool('edit_file'))
    registry.register(mockTool('run_script'))

    // allowed → keep only these.
    const allowed = registry.materialize({ allowed: ['read_file', 'edit_file'] })
    expect(allowed.definitions.map((d) => d.name).sort()).toEqual(['edit_file', 'read_file'])

    // blocked → drop these.
    const blocked = registry.materialize({ blocked: ['write_file'] })
    expect(blocked.definitions.map((d) => d.name).sort()).toEqual(['edit_file', 'read_file', 'run_script'])

    // allowed + blocked combined → allowed minus blocked.
    const combined = registry.materialize({
      allowed: ['read_file', 'edit_file', 'write_file'],
      blocked: ['write_file'],
    })
    expect(combined.definitions.map((d) => d.name).sort()).toEqual(['edit_file', 'read_file'])

    // empty allowed → all tools (treated as no filter).
    const emptyAllowed = registry.materialize({ allowed: [] })
    expect(emptyAllowed.definitions).toHaveLength(4)

    // empty blocked → all tools (treated as no filter).
    const emptyBlocked = registry.materialize({ blocked: [] })
    expect(emptyBlocked.definitions).toHaveLength(4)
  })

  // ── 6. settle calls the underlying tool and returns result ──────────────
  it('settle calls the underlying tool and returns result', async () => {
    const registry = new ToolRegistry()
    const spy = vi.fn((_args: Record<string, unknown>) => 'spy-result')
    registry.register(mockTool('echo', spy))

    const materialization = registry.materialize()
    const result = await materialization.settle({
      name: 'echo',
      callId: 'call-42',
      args: { message: 'hello' },
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello' }))
    expect(result.content).toBe('spy-result')
    expect(result.tool_call_id).toBe('call-42')
    expect(result.name).toBe('echo')
  })

  // ── 7. empty registry → materialize returns empty definitions ───────────
  it('empty registry → materialize returns empty definitions', () => {
    const registry = new ToolRegistry()
    const materialization = registry.materialize()

    expect(materialization.definitions).toEqual([])
    expect(materialization.generation).toBe(0)
    expect(registry.size).toBe(0)
  })

  // ── Adversarial: settle on unknown tool after no mutation returns error
  it('settle on unknown tool returns error (not stale) without invoking anything', async () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('known'))

    const materialization = registry.materialize()
    // No mutation between materialize and settle → must NOT be a stale error.
    const result = await materialization.settle({
      name: 'unknown_tool',
      callId: 'call-9',
      args: {},
    })

    expect(result.content).toBe('Error: unknown tool: unknown_tool')
    expect(result.tool_call_id).toBe('call-9')
    expect(result.name).toBe('unknown_tool')
  })

  // ── Adversarial: throwing tool propagates error string ──────────────────
  it('settle wraps thrown tool error into result.content', async () => {
    const registry = new ToolRegistry()
    registry.register(throwingTool('boom', 'kaboom'))

    const materialization = registry.materialize()
    const result = await materialization.settle({
      name: 'boom',
      callId: 'call-7',
      args: {},
    })

    expect(result.content).toContain('kaboom')
    expect(result.content.startsWith('Error:')).toBe(true)
    expect(result.tool_call_id).toBe('call-7')
    expect(result.name).toBe('boom')
  })

  // ── Adversarial: register returns unregister that is idempotent ─────────
  it('register returns an idempotent unregister function', () => {
    const registry = new ToolRegistry()
    const unregister = registry.register(mockTool('idem'))
    expect(registry.size).toBe(1)

    unregister()
    expect(registry.size).toBe(0)
    expect(registry.lookup('idem')).toBeUndefined()

    // Calling unregister again does not throw and does not affect other tools.
    expect(() => unregister()).not.toThrow()
    expect(registry.size).toBe(0)

    registry.register(mockTool('other'))
    expect(() => unregister()).not.toThrow()
    expect(registry.size).toBe(1)
  })

  // ── Adversarial: unregisterScope is a no-op on unknown scope ─────────────
  it('unregisterScope on an unknown scope is a no-op', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('app_tool'))

    const unknownScope: Scope = createScope()
    registry.unregisterScope(unknownScope)

    expect(registry.size).toBe(1)
    expect(registry.lookup('app_tool')).toBeDefined()
  })

  // ── Adversarial: multiple scopes do not interfere ───────────────────────
  it('closing one session scope leaves another session scope intact', () => {
    const registry = new ToolRegistry()
    const scopeA = createScope()
    const scopeB = createScope()
    registry.register(mockTool('app'))
    registry.register(mockTool('a1'), scopeA)
    registry.register(mockTool('a2'), scopeA)
    registry.register(mockTool('b1'), scopeB)
    expect(registry.size).toBe(4)

    registry.unregisterScope(scopeA)
    expect(registry.size).toBe(2)
    expect(registry.lookup('app')).toBeDefined()
    expect(registry.lookup('b1')).toBeDefined()
    expect(registry.lookup('a1')).toBeUndefined()
    expect(registry.lookup('a2')).toBeUndefined()

    // Closing scopeB afterward clears the rest of the scoped tools.
    registry.unregisterScope(scopeB)
    expect(registry.size).toBe(1)
    expect(registry.lookup('b1')).toBeUndefined()
  })

  // ── Adversarial: two materializations at different generations are independent
  it('two materializations are independent — only stale one reports stale', async () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('alpha'))

    const m1 = registry.materialize()
    // Mutation after m1.
    registry.register(mockTool('beta'))
    const m2 = registry.materialize()

    expect(m1.generation).toBeLessThan(m2.generation)
    expect(m1.definitions).toHaveLength(1)
    expect(m2.definitions).toHaveLength(2)

    // m1 is stale (registry mutated after m1 was captured).
    const r1 = await m1.settle({ name: 'alpha', callId: 'c1', args: {} })
    expect(r1.content).toBe('Tool registration changed after materialization')

    // m2 is fresh — should invoke the tool normally.
    const r2 = await m2.settle({ name: 'alpha', callId: 'c2', args: {} })
    expect(r2.content).toBe('alpha: ok')
  })
})
