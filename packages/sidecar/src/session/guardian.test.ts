import { describe, it, expect, vi } from 'vitest'
import type { HookContext } from '@hip/protocol'
import { createGuardianHook, sanitizeToolInput, type GuardianModel } from './guardian.js'

// ── helpers ──────────────────────────────────────────────────────────

function ctx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    sessionId: 'sid-g',
    turnId: 'turn-1',
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /' },
    ...overrides,
  }
}

/** Stub model that responds with the given JSON assessment. */
function modelReturning(assessment: string): GuardianModel {
  return {
    invoke: vi.fn().mockResolvedValue({ content: assessment }),
  }
}

/** Stub model that throws. */
function modelThrowing(error = new Error('boom')): GuardianModel {
  return {
    invoke: vi.fn().mockRejectedValue(error),
  }
}

/** Convenience: create a hook + invoke it on a Bash tool, return the result. */
async function assess(
  model: GuardianModel,
  toolName = 'Bash',
  toolInput: Record<string, unknown> = { command: 'rm -rf /' },
): Promise<{ kind: string; reason?: string }> {
  const hook = createGuardianHook(model)
  return hook.handler(ctx({ toolName, toolInput }))
}

// ─── Hook shape ──────────────────────────────────────────────────────

describe('createGuardianHook — shape', () => {
  it('registers on PreToolUse event', () => {
    const hook = createGuardianHook(modelReturning('{"risk":"low","category":"none","reason":"ok"}'))
    expect(hook.event).toBe('PreToolUse')
  })

  it('has no matcher (fires on all tools)', () => {
    const hook = createGuardianHook(modelReturning('{"risk":"low","category":"none","reason":"ok"}'))
    expect(hook.matcher).toBeUndefined()
  })
})

// ─── Read-only tools ─────────────────────────────────────────────────

describe('Guardian — read-only tool bypass', () => {
  for (const tool of ['read_file', 'ls', 'glob', 'grep']) {
    it(`skips ${tool} without calling the model`, async () => {
      const model = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
      const hook = createGuardianHook(model)
      const result = await hook.handler(ctx({ toolName: tool }))
      expect(result.kind).toBe('allow')
      expect(model.invoke).not.toHaveBeenCalled()
    })
  }

  it('skips unknown tool (undefined toolName)', async () => {
    const model = modelReturning('{}')
    const hook = createGuardianHook(model)
    const result = await hook.handler(ctx({ toolName: undefined }))
    expect(result.kind).toBe('allow')
    expect(model.invoke).not.toHaveBeenCalled()
  })
})

// ─── Risk levels ─────────────────────────────────────────────────────

describe('Guardian — risk levels', () => {
  it('low risk → allow', async () => {
    const model = modelReturning('{"risk":"low","category":"none","reason":"safe"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'allow' })
  })

  it('medium risk → ask', async () => {
    const model = modelReturning('{"risk":"medium","category":"data_exfiltration","reason":"sends data out"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'ask', reason: '[Guardian] data_exfiltration: sends data out' })
  })

  it('high risk → deny', async () => {
    const model = modelReturning('{"risk":"high","category":"destructive","reason":"deletes everything"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] destructive: deletes everything' })
  })
})

// ─── Model call failure → fail-closed ────────────────────────────────

describe('Guardian — fail-closed', () => {
  it('model throws → deny', async () => {
    const model = modelThrowing()
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] Model call or parse failed — fail-closed' })
  })

  it('model returns non-JSON → deny', async () => {
    const model = modelReturning('not valid json at all')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] Model call or parse failed — fail-closed' })
  })

  it('model returns JSON without risk field → deny', async () => {
    const model = modelReturning('{"hello":"world"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] Model returned unrecognised assessment shape' })
  })

  it('model returns invalid risk value → deny', async () => {
    const model = modelReturning('{"risk":"critical","category":"none","reason":"boom"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] Model returned unrecognised assessment shape' })
  })

  it('model returns invalid category value → deny', async () => {
    const model = modelReturning('{"risk":"low","category":"bad_stuff","reason":"bad"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] Model returned unrecognised assessment shape' })
  })

  it('model returns missing reason → deny', async () => {
    const model = modelReturning('{"risk":"low","category":"none"}')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] Model returned unrecognised assessment shape' })
  })
})

// ─── JSON parsing tolerance ─────────────────────────────────────────

describe('Guardian — JSON parsing tolerance', () => {
  it('parses JSON inside ```json fences', async () => {
    const model = modelReturning('```json\n{"risk":"low","category":"none","reason":"ok"}\n```')
    const result = await assess(model)
    expect(result.kind).toBe('allow')
  })

  it('parses JSON inside plain ``` fences', async () => {
    const model = modelReturning('Here is my assessment:\n```\n{"risk":"medium","category":"credential_probing","reason":"tries keys"}\n```\nThanks.')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'ask', reason: '[Guardian] credential_probing: tries keys' })
  })

  it('parses JSON object from surrounding prose', async () => {
    const model = modelReturning('I think this is {"risk":"high","category":"destructive","reason":"bad"} because reasons.')
    const result = await assess(model)
    expect(result).toEqual({ kind: 'deny', reason: '[Guardian] destructive: bad' })
  })
})

// ─── Array content extraction ────────────────────────────────────────

describe('Guardian — content extraction', () => {
  it('handles array-of-blocks content (LangChain multi-modal)', async () => {
    const model: GuardianModel = {
      invoke: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"risk":"low","category":"none","reason":"fine"}' }],
      }),
    }
    const result = await assess(model)
    expect(result.kind).toBe('allow')
  })

  it('skips non-text blocks in array content', async () => {
    const model: GuardianModel = {
      invoke: vi.fn().mockResolvedValue({
        content: [
          { type: 'image_url', image_url: { url: 'x' } },
          { type: 'text', text: '{"risk":"medium","category":"security_weakening","reason":"weak"}' },
        ],
      }),
    }
    const result = await assess(model)
    expect(result).toEqual({ kind: 'ask', reason: '[Guardian] security_weakening: weak' })
  })
})

// ─── Prompt construction ─────────────────────────────────────────────

describe('Guardian — prompt construction', () => {
  it('sends tool name and input in prompt', async () => {
    const model = modelReturning('{"risk":"low","category":"none","reason":"ok"}')
    await assess(model, 'Write', { path: '/tmp/x', content: 'hi' })
    const prompt = (model.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(prompt).toContain('Write')
    expect(prompt).toContain('/tmp/x')
    expect(prompt).toContain('hi')
  })
})

// ─── Circuit breaker ─────────────────────────────────────────────────

describe('Guardian — circuit breaker', () => {
  it('allows first high-risk denial', async () => {
    const model = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const hook = createGuardianHook(model)
    const r1 = await hook.handler(ctx({ toolName: 'Bash' }))
    expect(r1.kind).toBe('deny')
  })

  it('allows second high-risk denial (still normal mode)', async () => {
    const model = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const hook = createGuardianHook(model)
    await hook.handler(ctx({ toolName: 'Bash' }))
    const r2 = await hook.handler(ctx({ toolName: 'Bash' }))
    expect(r2.kind).toBe('deny')
    expect(r2.reason).not.toContain('Circuit breaker')
  })

  it('after 3rd consecutive denial switches to ask-all', async () => {
    const model = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const hook = createGuardianHook(model)
    await hook.handler(ctx({ toolName: 'Bash' })) // deny #1
    await hook.handler(ctx({ toolName: 'Bash' })) // deny #2
    const r3 = await hook.handler(ctx({ toolName: 'Bash' })) // deny #3 → ask-all
    expect(r3.kind).toBe('ask')
    expect(r3.reason).toContain('Circuit breaker')
    expect(r3.reason).toContain('switched to ask-all mode')
  })

  it('resets consecutive count on low (non-denial)', async () => {
    const modelHigh = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const modelLow = modelReturning('{"risk":"low","category":"none","reason":"fine"}')

    const hookHigh = createGuardianHook(modelHigh)
    await hookHigh.handler(ctx({ toolName: 'Bash' })) // deny #1
    await hookHigh.handler(ctx({ toolName: 'Bash' })) // deny #2

    // Low risk — counter resets
    const hookLow = createGuardianHook(modelLow)
    await hookLow.handler(ctx({ toolName: 'Bash' })) // allow, resets
    // ... but it's a different hook instance so this doesn't share state

    // Same hook instance: simulate deny → allow → deny → deny pattern
    const m = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const m2 = modelReturning('{"risk":"low","category":"none","reason":"fine"}')
    const hook = createGuardianHook(m)
    await hook.handler(ctx({ toolName: 'Bash1' })) // deny #1
    // Swap to low
    const rLow = await hook.handler(ctx({ toolName: 'Bash2', toolInput: { cmd: 'ls' } }))
    // But the handler used the same model that returns high... 

    // Better test: use a model that returns different assessments based on tool name
    const smartModel: GuardianModel = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"low","category":"none","reason":"fine"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' }),
    }

    const hookC = createGuardianHook(smartModel)
    // Denial #1
    expect((await hookC.handler(ctx({ toolName: 'A' }))).kind).toBe('deny')
    // Denial #2
    expect((await hookC.handler(ctx({ toolName: 'B' }))).kind).toBe('deny')
    // Low → counter resets to 0
    expect((await hookC.handler(ctx({ toolName: 'C' }))).kind).toBe('allow')
    // Denial #1 again (fresh)
    expect((await hookC.handler(ctx({ toolName: 'D' }))).kind).toBe('deny')
    // Denial #2
    expect((await hookC.handler(ctx({ toolName: 'E' }))).kind).toBe('deny')
    // Denial #3 → circuit breaker
    const r6 = await hookC.handler(ctx({ toolName: 'F' }))
    expect(r6.kind).toBe('ask')
    expect(r6.reason).toContain('Circuit breaker')
  })

  it('resets consecutive count on medium (ask)', async () => {
    const model: GuardianModel = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"medium","category":"data_exfiltration","reason":"sends"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' }),
    }

    const hook = createGuardianHook(model)
    expect((await hook.handler(ctx({ toolName: 'A' }))).kind).toBe('deny')
    expect((await hook.handler(ctx({ toolName: 'B' }))).kind).toBe('deny')
    // Medium → ask (counter resets)
    expect((await hook.handler(ctx({ toolName: 'C' }))).kind).toBe('ask')
    // Denial #1 fresh
    expect((await hook.handler(ctx({ toolName: 'D' }))).kind).toBe('deny')
    // Denial #2
    expect((await hook.handler(ctx({ toolName: 'E' }))).kind).toBe('deny')
    // Denial #3 → circuit breaker
    const r6 = await hook.handler(ctx({ toolName: 'F' }))
    expect(r6.kind).toBe('ask')
    expect(r6.reason).toContain('Circuit breaker')
  })
})

// ─── Ask-all mode ────────────────────────────────────────────────────

describe('Guardian — ask-all mode', () => {
  async function enterAskAll(hook: ReturnType<typeof createGuardianHook>['handler'], model: GuardianModel) {
    // 3 consecutive high → ask-all
    await hook(ctx({ toolName: 'A' })) // deny
    await hook(ctx({ toolName: 'B' })) // deny
    const r3 = await hook(ctx({ toolName: 'C' })) // ask (circuit breaker)
    expect(r3.kind).toBe('ask')
  }

  it('in ask-all mode: high → deny', async () => {
    const model = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const hook = createGuardianHook(model).handler
    await enterAskAll(hook, model)
    const r = await hook(ctx({ toolName: 'D' }))
    expect(r).toEqual({ kind: 'deny', reason: '[Guardian] destructive: bad' })
  })

  it('in ask-all mode: medium → ask', async () => {
    const highModel = modelReturning('{"risk":"high","category":"destructive","reason":"bad"}')
    const medModel = modelReturning('{"risk":"medium","category":"data_exfiltration","reason":"sends"}')

    const hookForHigh = createGuardianHook(highModel).handler
    await enterAskAll(hookForHigh, highModel)

    // Now in ask-all mode — use the same hook instance but the handler captures model by closure
    // We need a single model that returns high 3x then medium...
    const comboModel: GuardianModel = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"medium","category":"data_exfiltration","reason":"sends"}' }),
    }

    const hook2 = createGuardianHook(comboModel).handler
    await hook2(ctx({ toolName: 'A' })) // deny
    await hook2(ctx({ toolName: 'B' })) // deny
    const r3 = await hook2(ctx({ toolName: 'C' })) // → ask-all
    expect(r3.kind).toBe('ask')

    // Medium in ask-all → ask
    const r4 = await hook2(ctx({ toolName: 'D' }))
    expect(r4).toEqual({ kind: 'ask', reason: '[Guardian] data_exfiltration: sends' })
  })

  it('in ask-all mode: low → allow', async () => {
    const comboModel: GuardianModel = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"low","category":"none","reason":"fine"}' }),
    }

    const hook = createGuardianHook(comboModel).handler
    await hook(ctx({ toolName: 'A' })) // deny
    await hook(ctx({ toolName: 'B' })) // deny
    const r3 = await hook(ctx({ toolName: 'C' })) // → ask-all
    expect(r3.kind).toBe('ask')

    const r4 = await hook(ctx({ toolName: 'D' }))
    expect(r4).toEqual({ kind: 'allow' })
  })

  it('ask-all mode persists (does not revert)', async () => {
    const model: GuardianModel = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad"}' })
        .mockResolvedValueOnce({ content: '{"risk":"low","category":"none","reason":"ok"}' })
        .mockResolvedValueOnce({ content: '{"risk":"high","category":"destructive","reason":"bad again"}' }),
    }

    const hook = createGuardianHook(model).handler
    await hook(ctx({ toolName: 'A' })) // deny 1
    await hook(ctx({ toolName: 'B' })) // deny 2
    const r3 = await hook(ctx({ toolName: 'C' })) // deny 3 → ask-all
    expect(r3.kind).toBe('ask')
    expect(r3.reason).toContain('Circuit breaker')

    // Low → allow (still in ask-all)
    const r4 = await hook(ctx({ toolName: 'D' }))
    expect(r4.kind).toBe('allow')

    // High → deny (still in ask-all, NOT back to normal)
    const r5 = await hook(ctx({ toolName: 'E' }))
    expect(r5).toEqual({ kind: 'deny', reason: '[Guardian] destructive: bad again' })
  })
})

// ─── All 5 categories ───────────────────────────────────────────────

describe('Guardian — all risk categories', () => {
  const categories = ['data_exfiltration', 'credential_probing', 'security_weakening', 'destructive', 'none'] as const

  for (const cat of categories) {
    it(`accepts category "${cat}"`, async () => {
      const model = modelReturning(`{"risk":"low","category":"${cat}","reason":"test"}`)
      const result = await assess(model)
      expect(result.kind).toBe('allow')
    })
  }
})

// ─── Edge cases ──────────────────────────────────────────────────────

describe('Guardian — edge cases', () => {
  it('empty toolInput defaults to {}', async () => {
    const model: GuardianModel = {
      invoke: vi.fn().mockResolvedValue({ content: '{"risk":"low","category":"none","reason":"ok"}' }),
    }
    const hook = createGuardianHook(model)
    const result = await hook.handler(ctx({ toolName: 'Bash', toolInput: undefined }))
    expect(result.kind).toBe('allow')
    const prompt = (model.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(prompt).toContain('{}')
  })

  it('null toolInput defaults to {}', async () => {
    const model: GuardianModel = {
      invoke: vi.fn().mockResolvedValue({ content: '{"risk":"low","category":"none","reason":"ok"}' }),
    }
    const hook = createGuardianHook(model)
    const result = await hook.handler(ctx({ toolName: 'Bash', toolInput: null as unknown as undefined }))
    expect(result.kind).toBe('allow')
  })

  it('toolInput with nested objects is serialized', async () => {
    const model: GuardianModel = {
      invoke: vi.fn().mockResolvedValue({ content: '{"risk":"low","category":"none","reason":"ok"}' }),
    }
    const hook = createGuardianHook(model)
    await hook.handler(ctx({ toolName: 'Write', toolInput: { path: '/x', content: 'hello world\nmulti\nline' } }))
    const prompt = (model.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(prompt).toContain('hello world')
    expect(prompt).toContain('multi')
  })

  it('detects read_only (underscore variant) — does NOT skip it', async () => {
    // Only exact names 'read_file', 'ls', 'glob', 'grep' are skipped.
    // 'read_only' must still be assessed.
    const model = modelReturning('{"risk":"low","category":"none","reason":"safe"}')
    const result = await assess(model, 'read_only')
    expect(result.kind).toBe('allow')
    expect(model.invoke).toHaveBeenCalled()
  })

  it('case-sensitive tool name matching', async () => {
    // 'LS' is NOT in the skip set
    const model = modelReturning('{"risk":"low","category":"none","reason":"safe"}')
    const result = await assess(model, 'LS')
    expect(result.kind).toBe('allow')
    expect(model.invoke).toHaveBeenCalled()
  })
})

// ─── Data sanitization ─────────────────────────────────────────────────

describe('sanitizeToolInput', () => {
  it('preserves normal key-value pairs unchanged', () => {
    const input = { path: '/tmp/test', query: 'hello world', count: 42 }
    const result = sanitizeToolInput(input)
    expect(result).toEqual({ path: '/tmp/test', query: 'hello world', count: 42 })
  })

  it('truncates string values over 500 characters', () => {
    const long = 'x'.repeat(600)
    const result = sanitizeToolInput({ content: long })
    expect(result.content).toBe('x'.repeat(500) + '…(truncated)')
    expect((result.content as string).length).toBe(512)
  })

  it('does not truncate values at exactly 500 characters', () => {
    const exact = 'y'.repeat(500)
    const result = sanitizeToolInput({ content: exact })
    expect(result.content).toBe(exact)
  })

  it('redacts values whose key matches api_key pattern', () => {
    const result = sanitizeToolInput({ api_key: 'sk-abc123' })
    expect(result.api_key).toBe('[REDACTED]')
  })

  it('redacts values whose key matches token pattern', () => {
    const result = sanitizeToolInput({ token: 'ghp_secret123' })
    expect(result.token).toBe('[REDACTED]')
  })

  it('redacts values whose key matches secret pattern', () => {
    const result = sanitizeToolInput({ secret: 'my-password' })
    expect(result.secret).toBe('[REDACTED]')
  })

  it('redacts values whose key matches password pattern', () => {
    const result = sanitizeToolInput({ password: 'hunter2' })
    expect(result.password).toBe('[REDACTED]')
  })

  it('redacts values whose key matches auth pattern', () => {
    const result = sanitizeToolInput({ authorization: 'Bearer xyz' })
    expect(result.authorization).toBe('[REDACTED]')
  })

  it('redacts AWS access key values (AKIA…)', () => {
    const result = sanitizeToolInput({ key: 'AKIAIOSFODNN7EXAMPLE' })
    expect(result.key).toBe('[REDACTED]')
  })

  it('redacts JWT token values (eyJ…)', () => {
    const result = sanitizeToolInput({ credentials: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' })
    expect(result.credentials).toBe('[REDACTED]')
  })

  it('redacts GitHub token values (ghp_…)', () => {
    const result = sanitizeToolInput({ gh_token: 'ghp_1234567890abcdef1234567890abcdef12345678' })
    expect(result.gh_token).toBe('[REDACTED]')
  })

  it('does not redact normal-looking string values', () => {
    const result = sanitizeToolInput({ command: 'ls -la', path: '/tmp', content: 'hello' })
    expect(result).toEqual({ command: 'ls -la', path: '/tmp', content: 'hello' })
  })

  it('redacts override truncation when value is credential (security-first)', () => {
    const longJwt = 'eyJhbGciOiJSUzI1NiJ9.' + 'x'.repeat(600) + '.signature'
    const result = sanitizeToolInput({ token: longJwt })
    expect(result.token).toBe('[REDACTED]')
  })

  it('handles empty input', () => {
    const result = sanitizeToolInput({})
    expect(result).toEqual({})
  })

  it('preserves non-string values', () => {
    const result = sanitizeToolInput({ enabled: true, port: 8080, data: null })
    expect(result).toEqual({ enabled: true, port: 8080, data: null })
  })
})
