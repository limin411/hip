import { describe, expect, it } from 'vitest'
import { sidebarFooterActive } from './sidebarFooterActive'

describe('sidebarFooterActive', () => {
  it('returns history/trash overlay when set', () => {
    expect(sidebarFooterActive({ overlay: 'history' })).toBe('history')
    expect(sidebarFooterActive({ overlay: 'trash' })).toBe('trash')
  })

  it('returns null for settings (footer replaced by settings rail)', () => {
    expect(sidebarFooterActive({ overlay: 'settings' })).toBeNull()
  })

  it('returns null when no overlay', () => {
    expect(sidebarFooterActive({ overlay: null })).toBeNull()
  })
})
