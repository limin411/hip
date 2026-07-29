// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  navEntriesEqual,
  useNavHistoryStore,
  type NavEntry,
} from './navHistoryStore'

function entry(partial: Partial<NavEntry> & Pick<NavEntry, 'activeView'>): NavEntry {
  return {
    sidebarSection: 'chats',
    sessionId: null,
    knowledgeSpaceId: null,
    settingsPage: 'general',
    managedTerminalId: null,
    ...partial,
  }
}

describe('navHistoryStore', () => {
  beforeEach(() => {
    useNavHistoryStore.setState({ stack: [], index: -1, applying: false })
  })

  it('reset seeds a single entry', () => {
    const a = entry({ activeView: 'chat', sidebarSection: 'chats' })
    useNavHistoryStore.getState().reset(a)
    expect(useNavHistoryStore.getState().stack).toEqual([a])
    expect(useNavHistoryStore.getState().index).toBe(0)
    expect(useNavHistoryStore.getState().canGoBack()).toBe(false)
    expect(useNavHistoryStore.getState().canGoForward()).toBe(false)
  })

  it('push truncates forward branch and enables back', () => {
    const a = entry({ activeView: 'chat', sidebarSection: 'chats' })
    const b = entry({ activeView: 'chat', sessionId: 's1' })
    const c = entry({ activeView: 'chat', sessionId: 's2' })
    const d = entry({ activeView: 'code', sessionId: 's3', sidebarSection: 'projects' })
    useNavHistoryStore.getState().reset(a)
    useNavHistoryStore.getState().push(b)
    useNavHistoryStore.getState().push(c)
    expect(useNavHistoryStore.getState().canGoBack()).toBe(true)
    // go back to b
    const backTo = useNavHistoryStore.getState().back()
    expect(backTo).toEqual(b)
    expect(useNavHistoryStore.getState().canGoForward()).toBe(true)
    // navigate to d — drop c
    useNavHistoryStore.getState().push(d)
    expect(useNavHistoryStore.getState().stack.map((e) => e.sessionId)).toEqual([
      null,
      's1',
      's3',
    ])
    expect(useNavHistoryStore.getState().canGoForward()).toBe(false)
  })

  it('push ignores duplicate of current entry', () => {
    const a = entry({ activeView: 'chat', sessionId: 's1' })
    useNavHistoryStore.getState().reset(a)
    useNavHistoryStore.getState().push({ ...a })
    expect(useNavHistoryStore.getState().stack).toHaveLength(1)
  })

  it('push is no-op while applying', () => {
    const a = entry({ activeView: 'chat', sidebarSection: 'chats' })
    const b = entry({ activeView: 'chat', sessionId: 's1' })
    useNavHistoryStore.getState().reset(a)
    useNavHistoryStore.getState().setApplying(true)
    useNavHistoryStore.getState().push(b)
    expect(useNavHistoryStore.getState().stack).toHaveLength(1)
  })

  it('back/forward move index and return entries', () => {
    const a = entry({ activeView: 'chat', sidebarSection: 'chats' })
    const b = entry({ activeView: 'chat', sessionId: 's1' })
    useNavHistoryStore.getState().reset(a)
    useNavHistoryStore.getState().push(b)
    expect(useNavHistoryStore.getState().back()).toEqual(a)
    expect(useNavHistoryStore.getState().back()).toBeNull()
    expect(useNavHistoryStore.getState().forward()).toEqual(b)
    expect(useNavHistoryStore.getState().forward()).toBeNull()
  })

  it('navEntriesEqual compares all fields', () => {
    const a = entry({ activeView: 'chat', sessionId: 's1' })
    expect(navEntriesEqual(a, { ...a })).toBe(true)
    expect(navEntriesEqual(a, { ...a, sessionId: 's2' })).toBe(false)
  })
})
