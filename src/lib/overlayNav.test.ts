import { beforeEach, describe, expect, it } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { coerceUnderlyingFromEntry, coerceWorkSurfaceFromUi } from './overlayNav'

describe('coerceWorkSurfaceFromUi', () => {
  beforeEach(() => {
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
    } as never)
  })

  it('keeps non-special activeView', () => {
    expect(
      coerceWorkSurfaceFromUi({
        activeView: 'knowledge',
        sidebarSection: 'knowledge',
        chatSessionId: null,
        codeSessionId: null,
      }),
    ).toEqual({ view: 'knowledge', section: 'knowledge' })
  })

  it('falls back to chat when residual special with no session', () => {
    expect(
      coerceWorkSurfaceFromUi({
        activeView: 'history',
        sidebarSection: 'chats',
        chatSessionId: null,
        codeSessionId: null,
      }),
    ).toEqual({ view: 'chat', section: 'chats' })
  })

  it('uses domain active session surface', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 'c1',
          title: 't',
          preview: '',
          updatedAtMs: 1,
          config: { ...DEFAULT_CONFIG, surface: 'code' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'c1',
    } as never)
    expect(
      coerceWorkSurfaceFromUi({
        activeView: 'trash',
        sidebarSection: 'chats',
        chatSessionId: null,
        codeSessionId: null,
      }),
    ).toEqual({ view: 'code', section: 'projects' })
  })
})

describe('coerceUnderlyingFromEntry', () => {
  beforeEach(() => {
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
    } as never)
  })

  it('maps projects section to code', () => {
    expect(
      coerceUnderlyingFromEntry({
        activeView: 'history',
        sidebarSection: 'projects',
        sessionId: null,
        knowledgeSpaceId: null,
        settingsPage: 'general',
        managedTerminalId: null,
      }),
    ).toEqual({ view: 'code', section: 'projects' })
  })

  it('maps knowledge section', () => {
    expect(
      coerceUnderlyingFromEntry({
        activeView: 'history',
        sidebarSection: 'knowledge',
        sessionId: null,
        knowledgeSpaceId: 'sp1',
        settingsPage: 'general',
        managedTerminalId: null,
      }),
    ).toEqual({ view: 'knowledge', section: 'knowledge' })
  })
})
