import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message } from '@hip/protocol'
import { insertComposerText, registerComposerInserter } from '@/components/command-palette/composerBridge'
import { sessionService, useDomainStore } from '@/domain'
import {
  formatQuoteForComposer,
  messageCopyText,
  messageProvider,
} from './message'
import type { ContextMenuBuildContext } from '../types'

function makeMessage(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    timestamp: Date.now(),
    ...partial,
  } as Message
}

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: ['s1'],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('messageCopyText / formatQuoteForComposer', () => {
  it('uses raw content for user messages', () => {
    expect(messageCopyText(makeMessage({ id: 'u1', role: 'user', content: 'hello' }))).toBe('hello')
  })

  it('quotes each line for composer insert', () => {
    expect(formatQuoteForComposer('a\nb')).toBe('> a\n> b\n\n')
  })
})

describe('messageProvider', () => {
  beforeEach(() => {
    registerComposerInserter(null)
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { llmProvider: 'x', model: '', tools: [], surface: 'chat' } as never,
          title: 't',
          preview: '',
          updatedAtMs: 1,
          loaded: true,
          messages: [makeMessage({ id: 'm1', role: 'assistant', content: 'hi' })],
          status: 'idle',
          error: null,
          interrupt: null,
        },
      ],
      activeSessionId: 's1',
    })
  })

  it('returns [] for non-message kinds', () => {
    expect(
      messageProvider({ kind: 'codeBlock', payload: { code: 'x' } }, makeCtx()),
    ).toEqual([])
  })

  it('emits copy, quote, copyId for any message', () => {
    const msg = makeMessage({ id: 'm1', role: 'user', content: 'hello' })
    const ids = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx(),
    ).map((i) => i.id)
    expect(ids).toContain('message.copy')
    expect(ids).toContain('message.quote')
    expect(ids).toContain('message.copyId')
    expect(ids).not.toContain('message.regenerate')
  })

  it('includes regenerate only for last assistant', () => {
    const msg = makeMessage({ id: 'a1', role: 'assistant', content: 'ok' })
    const withRegen = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: true, sessionId: 's1' } },
      makeCtx(),
    )
    expect(withRegen.some((i) => i.id === 'message.regenerate')).toBe(true)

    const without = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx(),
    )
    expect(without.some((i) => i.id === 'message.regenerate')).toBe(false)
  })

  it('disables regenerate while running without interrupt', () => {
    const msg = makeMessage({ id: 'a1', role: 'assistant', content: 'ok' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: true, sessionId: 's1' } },
      makeCtx({ sessionStatus: 'running', sessionInterrupt: false }),
    )
    const regen = items.find((i) => i.id === 'message.regenerate')
    expect(regen?.disabled).toBe(true)
    expect(regen?.disabledReason).toBe('contextMenu.message.regenerateDisabled')
  })

  it('enables regenerate when running with interrupt pending', () => {
    const msg = makeMessage({ id: 'a1', role: 'assistant', content: 'ok' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: true, sessionId: 's1' } },
      makeCtx({ sessionStatus: 'running', sessionInterrupt: true }),
    )
    const regen = items.find((i) => i.id === 'message.regenerate')
    expect(regen?.disabled).toBeFalsy()
  })

  it('enables regenerate when idle', () => {
    const msg = makeMessage({ id: 'a1', role: 'assistant', content: 'ok' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: true, sessionId: 's1' } },
      makeCtx({ sessionStatus: 'idle', sessionInterrupt: false }),
    )
    expect(items.find((i) => i.id === 'message.regenerate')?.disabled).toBeFalsy()
  })

  it('copy uses ctx.copyText with message content', async () => {
    const copyText = vi.fn(async () => true)
    const msg = makeMessage({ id: 'm1', role: 'user', content: 'hello world' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'message.copy')!.run()
    expect(copyText).toHaveBeenCalledWith('hello world')
  })

  it('quote inserts via insertComposerText (does not replace via domain)', () => {
    const inserted: string[] = []
    registerComposerInserter((text) => {
      inserted.push(text)
    })
    const msg = makeMessage({ id: 'm1', role: 'user', content: 'quoted' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'message.quote')!.run()
    expect(inserted).toEqual(['> quoted\n\n'])
    // Sanity: bridge still works
    expect(insertComposerText('x')).toBe(true)
  })

  it('copyId copies message.id', async () => {
    const copyText = vi.fn(async () => true)
    const msg = makeMessage({ id: 'msg-42', role: 'user', content: 'x' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'message.copyId')!.run()
    expect(copyText).toHaveBeenCalledWith('msg-42')
  })

  it('regenerate calls sessionService.regenerate', () => {
    const spy = vi.spyOn(sessionService, 'regenerate').mockImplementation(() => {})
    const msg = makeMessage({ id: 'a1', role: 'assistant', content: 'ok' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: true, sessionId: 's1' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'message.regenerate')!.run()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('offers debug bundle when active session can produce JSON', () => {
    const items = messageProvider(
      {
        kind: 'message',
        payload: {
          message: makeMessage({ id: 'm1', role: 'user', content: 'x' }),
          isLastAssistant: false,
          sessionId: 's1',
        },
      },
      makeCtx({ activeSessionId: 's1' }),
    )
    expect(items.some((i) => i.id === 'session.copyDebugBundle')).toBe(true)
  })

  it('omits debug bundle when no active session', () => {
    useDomainStore.setState({ sessions: [], activeSessionId: null })
    const items = messageProvider(
      {
        kind: 'message',
        payload: {
          message: makeMessage({ id: 'm1', role: 'user', content: 'x' }),
          isLastAssistant: false,
          sessionId: null,
        },
      },
      makeCtx({ activeSessionId: null }),
    )
    expect(items.some((i) => i.id === 'session.copyDebugBundle')).toBe(false)
  })
})
