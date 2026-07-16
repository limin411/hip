import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message } from '@hip/protocol'
import { toast } from 'sonner'
import {
  registerComposerHandlers,
  registerComposerInserter,
  setComposerQuote,
} from '@/components/command-palette/composerBridge'
import { sessionService, useDomainStore } from '@/domain'
import {
  formatQuoteForComposer,
  messageCopyText,
  messageProvider,
} from './message'
import type { ContextMenuBuildContext } from '../types'

vi.mock('sonner', () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

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
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('messageCopyText / formatQuoteForComposer', () => {
  it('uses raw content for user messages', () => {
    expect(messageCopyText(makeMessage({ id: 'u1', role: 'user', content: 'hello' }))).toBe('hello')
  })

  it('normalizes assistant content for copy (CJK line collapse)', () => {
    const msg = makeMessage({
      id: 'a1',
      role: 'assistant',
      content: '让\n我\n先\n看\n看\n项\n目\n。',
    })
    expect(messageCopyText(msg)).toBe('让我先看看项目。')
    expect(formatQuoteForComposer(messageCopyText(msg))).toBe('> 让我先看看项目。\n\n')
  })

  it('quotes each line for composer insert', () => {
    expect(formatQuoteForComposer('a\nb')).toBe('> a\n> b\n\n')
  })
})

describe('messageProvider', () => {
  beforeEach(() => {
    registerComposerInserter(null)
    vi.mocked(toast.message).mockClear()
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

  it('quote sets pending quote chip via setComposerQuote (does not dump into draft)', () => {
    let quote: string | null = null
    let draft = 'existing draft'
    registerComposerHandlers({
      insert: (text) => {
        draft = draft + text
      },
      replace: (text) => {
        draft = text
      },
      setQuote: (text) => {
        quote = text
      },
    })
    const msg = makeMessage({ id: 'm1', role: 'user', content: 'quoted body' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'message.quote')!.run()
    expect(quote).toBe('quoted body')
    expect(draft).toBe('existing draft')
    expect(toast.message).not.toHaveBeenCalled()
    expect(setComposerQuote(null)).toBe(true)
    expect(quote).toBe(null)
  })

  it('toasts when quote has no composer quote handler', () => {
    registerComposerInserter(null)
    const msg = makeMessage({ id: 'm1', role: 'user', content: 'quoted' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'message.quote')!.run()
    expect(toast.message).toHaveBeenCalledWith('contextMenu.message.quoteNoComposer')
  })

  it('toasts when composer only has insert/replace (no setQuote)', () => {
    registerComposerInserter((text) => {
      void text
    })
    const msg = makeMessage({ id: 'm1', role: 'user', content: 'quoted' })
    const items = messageProvider(
      { kind: 'message', payload: { message: msg, isLastAssistant: false, sessionId: 's1' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'message.quote')!.run()
    expect(toast.message).toHaveBeenCalledWith('contextMenu.message.quoteNoComposer')
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

  it('offers debug bundle when active session matches without serializing on build', () => {
    const spy = vi.spyOn(sessionService, 'getSessionDebugBundleJson')
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
    // Visibility must not serialize the full bundle.
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
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

  it('omits debug bundle when payload session differs from active', () => {
    const items = messageProvider(
      {
        kind: 'message',
        payload: {
          message: makeMessage({ id: 'm1', role: 'user', content: 'x' }),
          isLastAssistant: false,
          sessionId: 'other',
        },
      },
      makeCtx({ activeSessionId: 's1' }),
    )
    expect(items.some((i) => i.id === 'session.copyDebugBundle')).toBe(false)
  })
})
