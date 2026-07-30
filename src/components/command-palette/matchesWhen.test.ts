import { describe, it, expect } from 'vitest'
import { matchesWhen, resolvePaletteSurface } from './matchesWhen'
import type { SessionVM } from '@/domain'

function session(partial: {
  id: string
  surface?: 'chat' | 'code'
}): SessionVM {
  return {
    id: partial.id,
    config: {
      llmProvider: 'openai',
      model: 'gpt-4o',
      tools: [],
      surface: partial.surface ?? 'chat',
    },
    title: '',
    preview: '',
    updatedAtMs: 0,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
  }
}

describe('resolvePaletteSurface', () => {
  it('maps chat and code views directly', () => {
    expect(resolvePaletteSurface({ activeView: 'chat', sessionId: null, sessions: [] })).toBe(
      'chat',
    )
    expect(resolvePaletteSurface({ activeView: 'code', sessionId: null, sessions: [] })).toBe(
      'code',
    )
  })

  it('uses session surface on non-chat/code work surfaces', () => {
    expect(
      resolvePaletteSurface({
        activeView: 'knowledge',
        sessionId: 's1',
        sessions: [session({ id: 's1', surface: 'code' })],
      }),
    ).toBe('code')
  })
})

describe('matchesWhen surfaces', () => {
  it('hides code-only commands on chat', () => {
    expect(
      matchesWhen(
        { surfaces: ['code'], requiresSession: true },
        { activeView: 'chat', sessionId: 's1', sessions: [session({ id: 's1', surface: 'chat' })] },
      ),
    ).toBe(false)
  })

  it('shows code-only commands on code with session', () => {
    expect(
      matchesWhen(
        { surfaces: ['code'], requiresSession: true },
        { activeView: 'code', sessionId: 's1', sessions: [session({ id: 's1', surface: 'code' })] },
      ),
    ).toBe(true)
  })
})
