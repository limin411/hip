import { describe, it, expect, beforeEach } from 'vitest'
import { useDiffStore, EMPTY_DIFF } from './diffStore'

const file = { path: 'a.ts', status: 'modified' as const, additions: 1, deletions: 0, hunks: [] }
const summary = { totalFiles: 1, totalAdditions: 1, totalDeletions: 0 }
beforeEach(() => { useDiffStore.setState({ bySession: {} }) })

describe('diffStore', () => {
  it('EMPTY_DIFF defaults base=session-start, no summary', () => {
    expect(EMPTY_DIFF).toMatchObject({ status: 'idle', files: [], base: 'session-start', hasSessionStart: false, initPending: false })
  })
  it('setLoading marks loading without clearing data', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    useDiffStore.getState().setLoading('s1')
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'loading', state: 'ok', files: [file] })
  })
  it('setResult stores files, summary, base, hasSessionStart', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: true })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', state: 'ok', files: [file], summary, base: 'head', hasSessionStart: true })
  })
  it('setResult defaults files to []', () => {
    useDiffStore.getState().setResult('s1', { state: 'not_a_repo', base: 'head', hasSessionStart: false })
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ status: 'ready', files: [] })
  })
  it('setSummary updates only the summary (badge) without touching files/status', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    useDiffStore.getState().setSummary('s1', { totalFiles: 3, totalAdditions: 9, totalDeletions: 2 }, 'head', false)
    const s = useDiffStore.getState().bySession['s1']
    expect(s.summary).toEqual({ totalFiles: 3, totalAdditions: 9, totalDeletions: 2 })
    expect(s.files).toEqual([file]); expect(s.status).toBe('ready')
  })
  it('setInitPending toggles the flag', () => {
    useDiffStore.getState().setInitPending('s1', true)
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ initPending: true })
  })
  it('clearSession resets to EMPTY_DIFF', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [], base: 'head', hasSessionStart: false })
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().bySession['s1']).toEqual(EMPTY_DIFF)
  })
  it('resetTransient unwedges loading and initPending', () => {
    useDiffStore.getState().setLoading('s1'); useDiffStore.getState().setInitPending('s2', true)
    useDiffStore.getState().resetTransient()
    expect(useDiffStore.getState().bySession['s1'].status).toBe('idle')
    expect(useDiffStore.getState().bySession['s2'].initPending).toBe(false)
  })
  it('setBase switches the requested base without clearing data', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'session-start', hasSessionStart: true })
    useDiffStore.getState().setBase('s1', 'head')
    expect(useDiffStore.getState().bySession['s1']).toMatchObject({ base: 'head', files: [file] })
  })
})
