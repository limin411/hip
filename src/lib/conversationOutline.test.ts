import { describe, expect, it } from 'vitest'
import { collectUserTurns, userTurnLabel } from './conversationOutline'
import { buildRoundtableOutbound } from '@/lib/roundtable'
import type { Message } from '@hip/protocol'

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return {
    content: '',
    timestamp: 0,
    ...partial,
  }
}

describe('userTurnLabel', () => {
  it('uses first non-empty line and truncates', () => {
    expect(userTurnLabel({ content: 'hello\nworld' }, 0)).toBe('hello')
    const long = 'x'.repeat(80)
    expect(userTurnLabel({ content: long }, 0)).toBe(`${'x'.repeat(72)}…`)
  })

  it('falls back to attachment names then Turn N', () => {
    expect(
      userTurnLabel({ content: '', attachments: [{ id: 'a', name: 'a.png', mimeType: 'image/png' }] }, 0),
    ).toBe('a.png')
    expect(userTurnLabel({ content: '  ' }, 2)).toBe('Turn 3')
  })

  it('strips roundtable wire frame so label is the user text', () => {
    const wire = buildRoundtableOutbound('Should we rewrite the API?', 'en')
    expect(userTurnLabel({ content: wire }, 0)).toBe('Should we rewrite the API?')
  })
})

describe('collectUserTurns', () => {
  it('keeps only user messages in order', () => {
    const turns = collectUserTurns([
      msg({ id: 'u1', role: 'user', content: 'first' }),
      msg({ id: 'a1', role: 'assistant', content: 'reply' }),
      msg({ id: 'u2', role: 'user', content: 'second' }),
    ])
    expect(turns.map((t) => t.id)).toEqual(['u1', 'u2'])
    expect(turns[0].label).toBe('first')
    expect(turns[1].index).toBe(1)
  })
})
