import { describe, expect, it } from 'vitest'
import { sidebarFooterActive } from './sidebarFooterActive'

describe('sidebarFooterActive', () => {
  it('returns overlay when set', () => {
    expect(sidebarFooterActive({ overlay: 'history' })).toBe('history')
    expect(sidebarFooterActive({ overlay: 'trash' })).toBe('trash')
    expect(sidebarFooterActive({ overlay: 'settings' })).toBe('settings')
  })

  it('returns null when no overlay', () => {
    expect(sidebarFooterActive({ overlay: null })).toBeNull()
  })
})
