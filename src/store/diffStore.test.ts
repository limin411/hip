import { describe, it, expect, beforeEach } from 'vitest'
import type { CommitLogEntry } from '@hip/protocol'
import { useDiffStore, EMPTY_DIFF } from './diffStore'

const file = { path: 'a.ts', status: 'modified' as const, additions: 1, deletions: 0, hunks: [] }
const summary = { totalFiles: 1, totalAdditions: 1, totalDeletions: 0 }
const commit = (sha: string): CommitLogEntry => ({ sha, shortSha: sha.slice(0, 7), message: `msg ${sha}`, author: 'me', timestamp: 0 })
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
  it('setFileExpanded and collapseFile round-trip', () => {
    const expandedFile = { ...file, hunks: [{ oldStart: 1, oldLines: 30, newStart: 1, newLines: 30, lines: [] }] }
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    useDiffStore.getState().setFileExpanded('s1', 'a.ts', expandedFile)
    expect(useDiffStore.getState().bySession['s1'].expanded['a.ts']).toEqual(expandedFile)
    useDiffStore.getState().collapseFile('s1', 'a.ts')
    expect(useDiffStore.getState().bySession['s1'].expanded['a.ts']).toBeUndefined()
  })
  it('setResult resets expanded to {}', () => {
    const expandedFile = { ...file, hunks: [] }
    useDiffStore.getState().setFileExpanded('s1', 'a.ts', expandedFile)
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    expect(useDiffStore.getState().bySession['s1'].expanded).toEqual({})
  })
  it('toggleCollapsed flips per-file collapse', () => {
    useDiffStore.getState().toggleCollapsed('s1', 'a.ts')
    expect(useDiffStore.getState().bySession['s1'].collapsed['a.ts']).toBe(true)
    useDiffStore.getState().toggleCollapsed('s1', 'a.ts')
    expect(useDiffStore.getState().bySession['s1'].collapsed['a.ts']).toBe(false)
  })

  // --- git-panel additions (A1) ---
  it('EMPTY_DIFF defaults the git fields', () => {
    expect(EMPTY_DIFF).toMatchObject({
      isGitRepo: false, currentBranch: null, commitLog: { status: 'idle', commits: [] },
      viewingCommitSha: null, commitDiff: { status: 'idle', files: [] }, discardPending: {},
    })
  })
  it('setGitState stores isGitRepo + currentBranch', () => {
    useDiffStore.getState().setGitState('s1', true, 'feature')
    const s = useDiffStore.getState().bySession['s1']
    expect(s.isGitRepo).toBe(true)
    expect(s.currentBranch).toBe('feature')
  })
  it('commitLog loading→ready transitions and stores commits', () => {
    useDiffStore.getState().setCommitLogLoading('s1')
    expect(useDiffStore.getState().bySession['s1'].commitLog).toMatchObject({ status: 'loading', commits: [] })
    useDiffStore.getState().setCommitLogResult('s1', { state: 'ok', commits: [commit('abc1234')] })
    expect(useDiffStore.getState().bySession['s1'].commitLog).toEqual({ status: 'ready', state: 'ok', commits: [commit('abc1234')], error: undefined })
  })
  it('setCommitLogResult carries an error', () => {
    useDiffStore.getState().setCommitLogResult('s1', { state: 'error', commits: [], error: 'nope' })
    expect(useDiffStore.getState().bySession['s1'].commitLog).toEqual({ status: 'ready', state: 'error', commits: [], error: 'nope' })
  })
  it('clearSession wipes git state back to EMPTY_DIFF', () => {
    useDiffStore.getState().setGitState('s1', true, 'main')
    useDiffStore.getState().setCommitLogLoading('s1')
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().bySession['s1']).toEqual(EMPTY_DIFF)
  })

  it('setCollapsed replaces the whole collapsed map', () => {
    useDiffStore.getState().setResult('s1', { state: 'ok', files: [file], summary, base: 'head', hasSessionStart: false })
    useDiffStore.getState().setCollapsed('s1', { 'a.ts': true, 'b.ts': false })
    expect(useDiffStore.getState().bySession['s1'].collapsed).toEqual({ 'a.ts': true, 'b.ts': false })
  })

  it('viewingCommit + commitDiff loading→ready round-trip', () => {
    useDiffStore.getState().setViewingCommit('s1', 'abc1234')
    expect(useDiffStore.getState().bySession['s1'].viewingCommitSha).toBe('abc1234')
    useDiffStore.getState().setCommitDiffLoading('s1')
    expect(useDiffStore.getState().bySession['s1'].commitDiff.status).toBe('loading')
    useDiffStore.getState().setCommitDiffResult('s1', { state: 'ok', files: [file] })
    expect(useDiffStore.getState().bySession['s1'].commitDiff).toEqual({ status: 'ready', state: 'ok', files: [file], error: undefined })
    useDiffStore.getState().setViewingCommit('s1', null)
    expect(useDiffStore.getState().bySession['s1'].viewingCommitSha).toBeNull()
  })

  it('setCommitDiffResult carries an error', () => {
    useDiffStore.getState().setCommitDiffResult('s1', { state: 'error', error: 'nope' })
    expect(useDiffStore.getState().bySession['s1'].commitDiff).toEqual({ status: 'ready', state: 'error', files: [], error: 'nope' })
  })

  it('setDiscardPending flips per-path flags', () => {
    useDiffStore.getState().setDiscardPending('s1', 'a.ts', true)
    expect(useDiffStore.getState().bySession['s1'].discardPending['a.ts']).toBe(true)
    useDiffStore.getState().setDiscardPending('s1', 'a.ts', false)
    expect(useDiffStore.getState().bySession['s1'].discardPending['a.ts']).toBe(false)
  })
})
