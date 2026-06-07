import { describe, it, expect, beforeEach } from 'vitest'
import { useFsStore } from './fsStore'

beforeEach(() => useFsStore.setState({ bySession: {} }))

describe('fsStore', () => {
  it('setEntries stores entries per dir/session', () => {
    useFsStore.getState().setEntries('s1', '/root', [{ name: 'a', path: '/root/a', isDir: false }])
    expect(useFsStore.getState().bySession.s1.entriesByDir['/root']).toHaveLength(1)
  })
  it('toggleExpanded flips a directory', () => {
    useFsStore.getState().toggleExpanded('s1', '/root/src')
    expect(useFsStore.getState().bySession.s1.expanded['/root/src']).toBe(true)
    useFsStore.getState().toggleExpanded('s1', '/root/src')
    expect(useFsStore.getState().bySession.s1.expanded['/root/src']).toBe(false)
  })
  it('setPreview replaces the preview state', () => {
    useFsStore.getState().setPreview('s1', { status: 'loading', path: '/root/a.md' })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'loading' })
  })
  it('clearSession resets a session', () => {
    useFsStore.getState().setActive('s1', '/root/a')
    useFsStore.getState().clearSession('s1')
    expect(useFsStore.getState().bySession.s1.activePath).toBeNull()
  })
})
