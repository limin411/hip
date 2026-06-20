import { describe, it, expect } from 'vitest'
import type { Hook, HookEvent, HookContext } from '@hip/protocol'
import { HookRegistry } from './registry.js'

const ALL_EVENTS: HookEvent[] = [
  'SessionStart',
  'TurnStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'TurnComplete',
]
const ALL_EVENT_COUNT = 7

function ctx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    sessionId: 'sid-test',
    turnId: 'turn-1',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    toolOutput: 'file1\nfile2',
    toolError: undefined,
    ...overrides,
  }
}

function makeAllowHook(event: HookEvent, matcher?: string | string[]): Hook {
  return {
    event,
    matcher,
    handler: async () => ({ kind: 'allow' }),
  }
}

function makeDenyHook(event: HookEvent, matcher?: string | string[]): Hook {
  return {
    event,
    matcher,
    handler: async () => ({ kind: 'deny', reason: 'blocked' }),
  }
}

// ─── 7 event types ──────────────────────────────────────────────────

describe('HookRegistry — all 7 event types', () => {
  for (const event of ALL_EVENTS) {
    it(`fires hook registered for "${event}"`, async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event,
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      const result = await registry.fire(event, ctx())
      expect(called).toBe(true)
      expect(result).toEqual({ kind: 'allow' })
    })

    it(`does NOT fire "${event}" hook when a different event is triggered`, async () => {
      const differentEvent = ALL_EVENTS.find((e) => e !== event)!
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event,
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire(differentEvent, ctx())
      expect(called).toBe(false)
    })
  }

  it('has exactly 7 event types', () => {
    expect(ALL_EVENTS).toHaveLength(ALL_EVENT_COUNT)
  })

  it('multiple hooks on different events do not cross-fire', async () => {
    const calls: HookEvent[] = []
    const registry = new HookRegistry()
    for (const event of ALL_EVENTS) {
      registry.register({
        event,
        handler: async () => {
          calls.push(event)
          return { kind: 'allow' }
        },
      })
    }

    await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(calls).toEqual(['PreToolUse'])
  })
})

// ─── Matcher resolution ────────────────────────────────────────────

describe('HookRegistry — matcher resolution', () => {
  describe('single matcher', () => {
    it('matches exact tool name', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register(makeAllowHook('PreToolUse', 'Bash'))
      registry.register({
        event: 'PreToolUse',
        matcher: 'Bash',
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
      expect(called).toBe(true)
    })

    it('skips non-matching tool name', async () => {
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

      await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
      expect(called).toBe(false)
    })

    it('skips when toolName is undefined but matcher is set', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event: 'SessionStart',
        matcher: 'Bash',
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('SessionStart', ctx({ toolName: undefined }))
      expect(called).toBe(false)
      expect(true).toBe(true)
    })
  })

  describe('multiple matchers (string[])', () => {
    it('matches when tool name is in the array', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event: 'PreToolUse',
        matcher: ['Bash', 'Write', 'Read'],
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
      expect(called).toBe(true)
    })

    it('matches any of the listed tools', async () => {
      const registry = new HookRegistry()
      const calls: string[] = []
      registry.register({
        event: 'PreToolUse',
        matcher: ['Bash', 'Write'],
        handler: async (hCtx) => {
          calls.push(hCtx.toolName ?? 'unknown')
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
      await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
      expect(calls).toEqual(['Bash', 'Write'])
    })

    it('skips tool not in the array', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event: 'PreToolUse',
        matcher: ['Bash', 'Write'],
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Read' }))
      expect(called).toBe(false)
    })
  })

  describe('wildcard matcher', () => {
    it('"*" matches any tool name', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event: 'PreToolUse',
        matcher: '*',
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Anything' }))
      expect(called).toBe(true)
    })

    it('"mcp__*" matches all MCP tools', async () => {
      const registry = new HookRegistry()
      let called = 0
      registry.register({
        event: 'PreToolUse',
        matcher: 'mcp__*',
        handler: async () => {
          called++
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'mcp__github__create_pr' }))
      await registry.fire('PreToolUse', ctx({ toolName: 'mcp__filesystem__read' }))
      await registry.fire('PreToolUse', ctx({ toolName: 'mcp__' }))
      expect(called).toBe(3)
    })

    it('"mcp__*" does not match non-MCP tools', async () => {
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

      await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
      expect(called).toBe(false)
    })

    it('"*Bash*" matches tools containing Bash', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event: 'PreToolUse',
        matcher: '*Bash*',
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'myBashTool' }))
      expect(called).toBe(true)
    })

    it('prefix wildcard "*/Write" matches suffix', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register({
        event: 'PreToolUse',
        matcher: '*/Write',
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      // glob */Write matches anything ending in /Write, but tool names
      // don't typically have slashes. Test what actually works.
      await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
      // 'Write' does NOT match '*/Write' because the regex is ^.*\/Write$
      // which requires a slash before Write
      expect(called).toBe(false)
    })
  })

  describe('no matcher (undefined)', () => {
    it('fires on every tool regardless of name', async () => {
      const registry = new HookRegistry()
      const tools: string[] = []
      registry.register({
        event: 'PreToolUse',
        handler: async (hCtx) => {
          tools.push(hCtx.toolName ?? 'unknown')
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
      await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
      await registry.fire('PreToolUse', ctx({ toolName: 'Read' }))
      expect(tools).toEqual(['Bash', 'Write', 'Read'])
    })

    it('fires on tools that have matchers set on other hooks', async () => {
      const registry = new HookRegistry()
      let called = false
      registry.register(makeAllowHook('PreToolUse', 'Bash')) // matcher= Bash
      registry.register({
        event: 'PreToolUse',
        // no matcher → matches all
        handler: async () => {
          called = true
          return { kind: 'allow' }
        },
      })

      await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
      expect(called).toBe(true)
    })
  })
})

// ─── Handler ordering ──────────────────────────────────────────────

describe('HookRegistry — handler ordering', () => {
  it('fires hooks in registration order', async () => {
    const order: string[] = []
    const registry = new HookRegistry()
    for (let i = 0; i < 5; i++) {
      registry.register({
        event: 'PreToolUse',
        matcher: 'Bash',
        handler: async () => {
          order.push(`hook-${i}`)
          return { kind: 'allow' }
        },
      })
    }

    await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(order).toEqual(['hook-0', 'hook-1', 'hook-2', 'hook-3', 'hook-4'])
  })

  it('stops at first non-allow result (fail-closed chain)', async () => {
    const order: string[] = []
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        order.push('first')
        return { kind: 'allow' }
      },
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        order.push('deny-hook')
        return { kind: 'deny', reason: 'stopped' }
      },
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        order.push('SHOULD_NOT_FIRE')
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(order).toEqual(['first', 'deny-hook'])
    expect(result).toEqual({ kind: 'deny', reason: 'stopped' })
  })

  it('ask result also short-circuits', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => ({ kind: 'ask', reason: 'please confirm' }),
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => ({ kind: 'allow' }),
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result.kind).toBe('ask')
  })

  it('all allow → returns allow', async () => {
    const registry = new HookRegistry()
    registry.register(makeAllowHook('PreToolUse'))
    registry.register(makeAllowHook('PreToolUse'))
    registry.register(makeAllowHook('PreToolUse'))

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result).toEqual({ kind: 'allow' })
  })

  it('ordering respects both event and matcher filtering', async () => {
    const order: string[] = []
    const registry = new HookRegistry()
    // Hook A: TurnStart
    registry.register({
      event: 'TurnStart',
      handler: async () => {
        order.push('turn-start')
        return { kind: 'allow' }
      },
    })
    // Hook B: PreToolUse, matcher: Bash
    registry.register({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: async () => {
        order.push('pretool-bash')
        return { kind: 'allow' }
      },
    })
    // Hook C: PreToolUse, matcher: Write
    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async () => {
        order.push('pretool-write')
        return { kind: 'allow' }
      },
    })
    // Hook D: PreToolUse, no matcher
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        order.push('pretool-all')
        return { kind: 'allow' }
      },
    })

    await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    // Only B and D match (A is wrong event, C is wrong matcher)
    // B registered before D → B fires first
    expect(order).toEqual(['pretool-bash', 'pretool-all'])
  })
})

// ─── Fail-closed ────────────────────────────────────────────────────

describe('HookRegistry — fail-closed', () => {
  it('handler crash → denies with fail-closed reason', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        throw new Error('unexpected crash')
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result).toEqual({ kind: 'deny', reason: 'Hook crashed or timed out' })
  })

  it('handler throwing non-Error still fail-closed', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        throw 'string error' // eslint-disable-line no-throw-literal
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result.kind).toBe('deny')
  })

  it('timeout → fail-closed deny', { timeout: 10000 }, async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 6000))
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result).toEqual({ kind: 'deny', reason: 'Hook crashed or timed out' })
  })

  it('subsequent hooks do not fire after a crash', async () => {
    const registry = new HookRegistry()
    let secondCalled = false
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        throw new Error('crash')
      },
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        secondCalled = true
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result.kind).toBe('deny')
    expect(secondCalled).toBe(false)
  })

  it('subsequent hooks do not fire after timeout', { timeout: 10000 }, async () => {
    const registry = new HookRegistry()
    let secondCalled = false
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 6000))
        return { kind: 'allow' }
      },
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        secondCalled = true
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(result.kind).toBe('deny')
    expect(secondCalled).toBe(false)
  })

  it('fail-closed result has correct typings', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        throw new Error('crash')
      },
    })

    const result = await registry.fire('PreToolUse', ctx())
    // Type-narrowing check: result.kind should be 'deny'
    if (result.kind === 'deny') {
      expect(typeof result.reason).toBe('string')
    } else {
      // Should not reach here
      expect.unreachable('expected deny')
    }
  })

  it('many hooks crash → only first runs, fail-closed', async () => {
    const registry = new HookRegistry()
    const calls: string[] = []
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        calls.push('first')
        throw new Error('crash')
      },
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        calls.push('second-never')
        return { kind: 'allow' }
      },
    })

    await registry.fire('PreToolUse', ctx())
    expect(calls).toEqual(['first'])
  })
})

// ─── Re-entrancy ───────────────────────────────────────────────────

describe('HookRegistry — re-entrancy', () => {
  it('throws ReentrancyError on self-call from handler', async () => {
    const registry = new HookRegistry()
    const hook: Hook = {
      event: 'PreToolUse',
      handler: async () => {
        await registry.fire('PreToolUse', ctx())
        return { kind: 'allow' }
      },
    }
    registry.register(hook)

    await expect(
      registry.fire('PreToolUse', ctx()),
    ).rejects.toThrow('Hook re-entrancy detected')
  })

  it('throws ReentrancyError on cross-hook re-entrancy', async () => {
    const registry = new HookRegistry()
    const hookA: Hook = {
      event: 'PreToolUse',
      handler: async () => {
        await registry.fire('PreToolUse', ctx())
        return { kind: 'allow' }
      },
    }
    registry.register(hookA)
    // Register a second hook (won't trigger since re-entrancy is on first)
    registry.register(makeAllowHook('PreToolUse'))

    await expect(
      registry.fire('PreToolUse', ctx()),
    ).rejects.toThrow('Hook re-entrancy detected')
  })

  it('re-entrancy is per-hook-object — different hook objects with same handler do not trigger', async () => {
    const registry = new HookRegistry()
    const hookA: Hook = {
      event: 'PreToolUse',
      handler: async () => {
        await registry.fire('PostToolUse', ctx())
        return { kind: 'allow' as const }
      },
    }
    const hookB: Hook = {
      event: 'PostToolUse',
      handler: async () => ({ kind: 'allow' as const }),
    }
    registry.register(hookA)
    registry.register(hookB)

    await expect(
      registry.fire('PreToolUse', ctx()),
    ).resolves.toEqual({ kind: 'allow' })
  })

  it('re-entrancy: same event fired recursively from handler is caught', async () => {
    const registry = new HookRegistry()
    const hook: Hook = {
      event: 'PreToolUse',
      handler: async () => {
        await registry.fire('PreToolUse', ctx())
        return { kind: 'allow' }
      },
    }
    registry.register(hook)

    await expect(
      registry.fire('PreToolUse', ctx()),
    ).rejects.toThrow('Hook re-entrancy detected')
  })

  it('re-entrancy via same hook registered twice', async () => {
    const registry = new HookRegistry()
    const hook: Hook = {
      event: 'PreToolUse',
      handler: async () => {
        await registry.fire('PreToolUse', ctx())
        return { kind: 'allow' }
      },
    }
    registry.register(hook)
    // Same hook object registered again (referential equality matters for activeHooks Set)
    registry.register(hook)

    // The first matching instance will detect re-entrancy and throw
    await expect(
      registry.fire('PreToolUse', ctx()),
    ).rejects.toThrow('Hook re-entrancy detected')
  })
})

// ─── Empty registry pass-through ───────────────────────────────────

describe('HookRegistry — empty registry pass-through', () => {
  it('returns allow for every event type with empty registry', async () => {
    for (const event of ALL_EVENTS) {
      const registry = new HookRegistry()
      const result = await registry.fire(event, ctx())
      expect(result).toEqual({ kind: 'allow' })
    }
  })

  it('returns allow for any tool name with empty registry', async () => {
    const registry = new HookRegistry()
    const result = await registry.fire('PreToolUse', ctx({ toolName: 'NonExistentTool' }))
    expect(result).toEqual({ kind: 'allow' })
  })

  it('returns allow even with undefined context fields', async () => {
    const registry = new HookRegistry()
    const result = await registry.fire('PreToolUse', {
      sessionId: 'sid-1',
      toolName: undefined,
    })
    expect(result).toEqual({ kind: 'allow' })
  })

  it('returns allow when no hooks match event', async () => {
    const registry = new HookRegistry()
    registry.register(makeDenyHook('PreToolUse'))
    // Fire a different event — no hooks match
    const result = await registry.fire('TurnComplete', ctx())
    expect(result).toEqual({ kind: 'allow' })
  })

  it('returns allow when hooks exist but matchers do not match', async () => {
    const registry = new HookRegistry()
    registry.register(makeDenyHook('PreToolUse', 'Bash'))
    registry.register(makeDenyHook('PreToolUse', 'Write'))
    // Fire with a tool that matches neither matcher
    const result = await registry.fire('PreToolUse', ctx({ toolName: 'Read' }))
    expect(result).toEqual({ kind: 'allow' })
  })
})

// ─── Edge cases ────────────────────────────────────────────────────

describe('HookRegistry — edge cases', () => {
  it('handler returning async "allow" works correctly', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { kind: 'allow' }
      },
    })

    const result = await registry.fire('PreToolUse', ctx())
    expect(result).toEqual({ kind: 'allow' })
  })

  it('hook can read ctx and return allow with updatedInput (final result strips updatedInput)', async () => {
    const registry = new HookRegistry()
    let capturedInput: Record<string, unknown> | undefined
    registry.register({
      event: 'PreToolUse',
      handler: async (hCtx) => {
        capturedInput = hCtx.toolInput
        return { kind: 'allow', updatedInput: { command: 'ls -la' } }
      },
    })

    const result = await registry.fire('PreToolUse', ctx({ toolInput: { command: 'ls' } }))
    expect(capturedInput).toEqual({ command: 'ls' })
    expect(result).toEqual({ kind: 'allow' })
  })

  it('matcher array with duplicates still works', async () => {
    const registry = new HookRegistry()
    let called = false
    registry.register({
      event: 'PreToolUse',
      matcher: ['Bash', 'Bash', 'Bash'],
      handler: async () => {
        called = true
        return { kind: 'allow' }
      },
    })

    await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(called).toBe(true)
  })

  it('empty matcher array matches nothing (no patterns to match)', async () => {
    const registry = new HookRegistry()
    let called = false
    registry.register({
      event: 'PreToolUse',
      matcher: [],
      handler: async () => {
        called = true
        return { kind: 'allow' }
      },
    })

    await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    // Empty array → 0 patterns → .some() returns false → never matches
    expect(called).toBe(false)
  })

  it('register is additive — hooks accumulate', async () => {
    const registry = new HookRegistry()
    const calls: string[] = []
    registry.register({
      event: 'PreToolUse',
      matcher: 'Bash',
      handler: async () => { calls.push('bash-matcher'); return { kind: 'allow' } },
    })
    registry.register({
      event: 'PreToolUse',
      matcher: 'Write',
      handler: async () => { calls.push('write-matcher'); return { kind: 'allow' } },
    })
    registry.register({
      event: 'PreToolUse',
      handler: async () => { calls.push('no-matcher'); return { kind: 'allow' } },
    })

    await registry.fire('PreToolUse', ctx({ toolName: 'Bash' }))
    expect(calls).toEqual(['bash-matcher', 'no-matcher'])

    calls.length = 0
    await registry.fire('PreToolUse', ctx({ toolName: 'Write' }))
    expect(calls).toEqual(['write-matcher', 'no-matcher'])
  })

  it('allow hook with reason field — final result preserves reason', async () => {
    const registry = new HookRegistry()
    registry.register({
      event: 'PreToolUse',
      handler: async () => ({ kind: 'allow', reason: 'looks fine' }),
    })

    const result = await registry.fire('PreToolUse', ctx())
    expect(result).toEqual({ kind: 'allow', reason: 'looks fine' })
  })

  it('deny with reason propagates reason', async () => {
    const registry = new HookRegistry()
    registry.register(makeDenyHook('PreToolUse'))

    const result = await registry.fire('PreToolUse', ctx())
    expect(result).toEqual({ kind: 'deny', reason: 'blocked' })
  })
})

// ─── Context propagation ───────────────────────────────────────────

describe('HookRegistry — context propagation', () => {
  it('passes full context to handler', async () => {
    const registry = new HookRegistry()
    let captured: HookContext | null = null
    registry.register({
      event: 'PreToolUse',
      handler: async (hCtx) => {
        captured = hCtx
        return { kind: 'allow' }
      },
    })

    const testCtx = ctx({
      sessionId: 'sid-42',
      turnId: 'turn-99',
      toolName: 'Write',
      toolInput: { path: '/tmp/test', content: 'hello' },
    })
    await registry.fire('PreToolUse', testCtx)
    expect(captured).toEqual(testCtx)
  })

  it('PostToolUse receives toolOutput', async () => {
    const registry = new HookRegistry()
    let output: string | undefined
    registry.register({
      event: 'PostToolUse',
      handler: async (hCtx) => {
        output = hCtx.toolOutput
        return { kind: 'allow' }
      },
    })

    await registry.fire('PostToolUse', ctx({ toolOutput: 'success output' }))
    expect(output).toBe('success output')
  })

  it('PostToolUseFailure receives toolError', async () => {
    const registry = new HookRegistry()
    let error: string | undefined
    registry.register({
      event: 'PostToolUseFailure',
      handler: async (hCtx) => {
        error = hCtx.toolError
        return { kind: 'allow' }
      },
    })

    await registry.fire('PostToolUseFailure', ctx({ toolError: 'permission denied' }))
    expect(error).toBe('permission denied')
  })
})
