import { describe, it, expect, beforeEach } from 'vitest'
import { shouldApplyPreviewResult, useFsStore } from './fsStore'

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

  it('applyPreviewResult ignores stale in-flight reads for a different path', () => {
    useFsStore.getState().setActive('s1', '/page.html')
    useFsStore.getState().setPreview('s1', { status: 'loading', path: '/page.html' })
    // Late result for a previous selection must not overwrite.
    useFsStore.getState().applyPreviewResult('s1', {
      path: '/scripts/check.py',
      content: 'print(1)',
      encoding: 'utf8',
      mimeType: 'text/plain',
    })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({
      status: 'loading',
      path: '/page.html',
    })
    useFsStore.getState().applyPreviewResult('s1', {
      path: '/page.html',
      content: '<h1>ok</h1>',
      encoding: 'utf8',
      mimeType: 'text/html',
    })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({
      status: 'ready',
      path: '/page.html',
      content: '<h1>ok</h1>',
    })
  })
})

describe('shouldApplyPreviewResult', () => {
  it('accepts any result when idle', () => {
    expect(shouldApplyPreviewResult({ status: 'idle' }, null, '/a.md')).toBe(true)
  })
  it('while loading, only accepts the loading path', () => {
    expect(shouldApplyPreviewResult({ status: 'loading', path: '/b' }, '/b', '/b')).toBe(true)
    expect(shouldApplyPreviewResult({ status: 'loading', path: '/b' }, '/b', '/a')).toBe(false)
  })
  it('while ready, accepts same path or activePath refresh', () => {
    const ready = { status: 'ready' as const, path: '/a', content: 'x' }
    expect(shouldApplyPreviewResult(ready, '/a', '/a')).toBe(true)
    expect(shouldApplyPreviewResult(ready, '/b', '/b')).toBe(true)
    expect(shouldApplyPreviewResult(ready, '/b', '/c')).toBe(false)
  })
})
