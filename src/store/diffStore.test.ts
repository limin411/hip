import { describe, it, expect, beforeEach } from 'vitest'
import { useDiffStore, EMPTY_DIFF } from './diffStore'

beforeEach(() => { useDiffStore.setState({ bySession: {} }) })

describe('diffStore', () => {
  it('setLoading marks the session loading without clearing data', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], totalFiles: 0 })
    useDiffStore.getState().setLoading('s1')
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'loading', state: 'ok' })
  })

  it('setResult stores files, totalFiles and state', () => {
    const file = { path: 'a.ts', additions: 1, deletions: 0, lines: [] }
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], totalFiles: 5 })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', state: 'ok', files: [file], totalFiles: 5 })
  })

  it('setResult defaults files to [] and totalFiles to files length', () => {
    useDiffStore.getState().setResult('s1', { state: 'not_a_repo' })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', files: [], totalFiles: 0 })
    const file = { path: 'a.ts', additions: 1, deletions: 0, lines: [] }
    useDiffStore.getState().setResult('s2', { state: 'ok', files: [file, file] })
    expect(useDiffStore.getState().bySession['s2'].totalFiles).toBe(2)
  })

  it('setInitPending toggles the flag', () => {
    useDiffStore.getState().setInitPending('s1', true)
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'idle', files: [], totalFiles: 0, initPending: true })
  })

  it('clearSession resets to EMPTY_DIFF', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], totalFiles: 0 })
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().bySession['s1']).toEqual(EMPTY_DIFF)
  })

  it('resetTransient unwedges loading and initPending across sessions', () => {
    useDiffStore.getState().setLoading('s1')
    useDiffStore.getState().setInitPending('s2', true)
    useDiffStore.getState().setResult('s3', { state: 'ok', files: [], totalFiles: 0 })
    useDiffStore.getState().resetTransient()
    expect(useDiffStore.getState().bySession['s1'].status).toBe('idle')
    expect(useDiffStore.getState().bySession['s2'].initPending).toBe(false)
    expect(useDiffStore.getState().bySession['s3'].status).toBe('ready') // untouched
  })
})
