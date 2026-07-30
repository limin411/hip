import { describe, expect, it } from 'vitest'
import { sidebarFooterActive } from './sidebarFooterActive'

describe('sidebarFooterActive', () => {
  it('returns overlay when set', () => {
    expect(
      sidebarFooterActive({ overlay: 'history', activeView: 'chat' }),
    ).toBe('history')
    expect(
      sidebarFooterActive({ overlay: 'trash', activeView: 'settings' }),
    ).toBe('trash')
    expect(
      sidebarFooterActive({ overlay: 'settings', activeView: 'chat' }),
    ).toBe('settings')
  })

  it('falls back to special activeView mid-migration', () => {
    expect(
      sidebarFooterActive({ overlay: null, activeView: 'settings' }),
    ).toBe('settings')
    expect(
      sidebarFooterActive({ overlay: null, activeView: 'history' }),
    ).toBe('history')
    expect(
      sidebarFooterActive({ overlay: null, activeView: 'trash' }),
    ).toBe('trash')
  })

  it('returns null for work surfaces', () => {
    expect(
      sidebarFooterActive({ overlay: null, activeView: 'chat' }),
    ).toBeNull()
    expect(
      sidebarFooterActive({ overlay: null, activeView: 'knowledge' }),
    ).toBeNull()
  })
})
