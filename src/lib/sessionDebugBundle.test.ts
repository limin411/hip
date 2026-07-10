import { describe, it, expect } from 'vitest'
import { buildSessionDebugBundle, redactObject, sessionDebugBundleJson } from './sessionDebugBundle'

describe('sessionDebugBundle', () => {
  it('redacts sensitive keys deeply', () => {
    const out = redactObject({
      model: 'x',
      apiKey: 'sk-secret',
      nested: { token: 'abc', ok: 1 },
    })
    expect(out.apiKey).toBe('[redacted]')
    expect((out.nested as { token: string }).token).toBe('[redacted]')
    expect((out.nested as { ok: number }).ok).toBe(1)
  })

  it('builds a versioned bundle with clipped content', () => {
    const bundle = buildSessionDebugBundle({
      sessionId: 's1',
      title: 'T',
      config: { llmProvider: 'deepseek', model: 'm', apiKey: 'nope', surface: 'code', cwd: '/p' } as never,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          timestamp: 1,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'x'.repeat(5000),
          timestamp: 2,
          stopped: true,
          agentId: 'supervisor',
        },
      ],
      now: () => '2026-07-10T00:00:00.000Z',
    })
    expect(bundle.version).toBe(1)
    expect(bundle.exportedAt).toBe('2026-07-10T00:00:00.000Z')
    expect(bundle.session.config.apiKey).toBeUndefined()
    expect(bundle.session.surface).toBe('code')
    expect(bundle.messages[1]!.content).toContain('truncated')
    expect(bundle.messages[1]!.stopped).toBe(true)
    expect(sessionDebugBundleJson({
      sessionId: 's1',
      title: 'T',
      messages: [],
      now: () => 't',
    })).toContain('"version": 1')
  })
})
