import { describe, it, expect, beforeEach } from 'vitest'
import type { Checkpoint, CommitLogEntry } from '@hip/protocol'
import { useDiffStore, EMPTY_DIFF } from './diffStore'

const file = { path: 'a.ts', status: 'modified' as const, additions: 1, deletions: 0, hunks: [] }
const summary = { totalFiles: 1, totalAdditions: 1, totalDeletions: 0 }
const cp = (id: string, overrides: Partial<Checkpoint> = {}): Checkpoint => ({
  id, sessionId: 's1', turnId: id === 's1:start' ? null : id, kind: id === 's1:start' ? 'start' : 'turn',
  label: null, treeSha: `tree-${id}`, commitSha: `commit-${id}`, branch: 'main', createdAt: 0, ...overrides,
})
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

  // --- checkpoint / git-panel additions (A1) ---
  it('EMPTY_DIFF defaults the checkpoint/git fields', () => {
    expect(EMPTY_DIFF).toMatchObject({
      isGitRepo: false, currentBranch: null, checkpoints: [], activeCheckpointId: null,
      checkpointDiff: {}, commitLog: { status: 'idle', commits: [] },
      lastRevertResult: null, revertError: null,
    })
  })
  it('setLastRevertResult records ok/fail and clears to null', () => {
    useDiffStore.getState().setLastRevertResult('s1', { checkpointId: 's1:t1', ok: true, safetyCheckpointId: 's1:pre' })
    const r = useDiffStore.getState().bySession['s1'].lastRevertResult
    expect(r).toMatchObject({ checkpointId: 's1:t1', ok: true, safetyCheckpointId: 's1:pre' })
    expect(typeof r?.at).toBe('number')
    useDiffStore.getState().setLastRevertResult('s1', null)
    expect(useDiffStore.getState().bySession['s1'].lastRevertResult).toBeNull()
  })
  it('setCheckpoints replaces the list and stores git meta', () => {
    useDiffStore.getState().setCheckpoints('s1', [cp('s1:start'), cp('s1:t1')], true, 'feature')
    const s = useDiffStore.getState().bySession['s1']
    expect(s.checkpoints).toHaveLength(2)
    expect(s.isGitRepo).toBe(true)
    expect(s.currentBranch).toBe('feature')
  })
  it('addCheckpoint prepends newest-first', () => {
    useDiffStore.getState().setCheckpoints('s1', [cp('s1:start')], true, 'main')
    useDiffStore.getState().addCheckpoint('s1', cp('s1:t1'))
    expect(useDiffStore.getState().bySession['s1'].checkpoints.map((c) => c.id)).toEqual(['s1:t1', 's1:start'])
  })
  it('addCheckpoint dedupes by id (no-op + same reference)', () => {
    useDiffStore.getState().setCheckpoints('s1', [cp('s1:t1')], true, 'main')
    const before = useDiffStore.getState().bySession['s1']
    useDiffStore.getState().addCheckpoint('s1', cp('s1:t1', { label: 'dupe' }))
    const after = useDiffStore.getState().bySession['s1']
    expect(after.checkpoints).toHaveLength(1)
    expect(after.checkpoints[0].label).toBeNull()
    expect(after).toBe(before)
  })
  it('addCheckpoint on an unknown session seeds from EMPTY_DIFF', () => {
    useDiffStore.getState().addCheckpoint('s1', cp('s1:t1'))
    expect(useDiffStore.getState().bySession['s1'].checkpoints.map((c) => c.id)).toEqual(['s1:t1'])
  })
  it('setActiveCheckpoint sets and clears the active id', () => {
    useDiffStore.getState().setActiveCheckpoint('s1', 's1:t1')
    expect(useDiffStore.getState().bySession['s1'].activeCheckpointId).toBe('s1:t1')
    useDiffStore.getState().setActiveCheckpoint('s1', null)
    expect(useDiffStore.getState().bySession['s1'].activeCheckpointId).toBeNull()
  })
  it('checkpointDiff loading→ready transitions on a keyed cache entry', () => {
    const key = 's1:t1|this-turn'
    useDiffStore.getState().setCheckpointDiffLoading('s1', key)
    expect(useDiffStore.getState().bySession['s1'].checkpointDiff[key]).toEqual({ status: 'loading' })
    useDiffStore.getState().setCheckpointDiffResult('s1', key, { state: 'ok', files: [file], summary })
    expect(useDiffStore.getState().bySession['s1'].checkpointDiff[key]).toEqual({ status: 'ready', state: 'ok', files: [file], summary, error: undefined })
  })
  it('checkpointDiff keys are independent', () => {
    useDiffStore.getState().setCheckpointDiffLoading('s1', 's1:t1|this-turn')
    useDiffStore.getState().setCheckpointDiffResult('s1', 's1:t1|since-start', { state: 'ok', files: [file], summary })
    const cd = useDiffStore.getState().bySession['s1'].checkpointDiff
    expect(cd['s1:t1|this-turn']).toEqual({ status: 'loading' })
    expect(cd['s1:t1|since-start']).toMatchObject({ status: 'ready', state: 'ok' })
  })
  it('setCheckpointDiffResult carries an error', () => {
    const key = 's1:t1|this-turn'
    useDiffStore.getState().setCheckpointDiffResult('s1', key, { state: 'error', error: 'boom' })
    expect(useDiffStore.getState().bySession['s1'].checkpointDiff[key]).toEqual({ status: 'ready', state: 'error', files: undefined, summary: undefined, error: 'boom' })
  })
  it('clearCheckpointDiffCache drops only the live-tree (since-then/since-start) entries', () => {
    useDiffStore.getState().setCheckpointDiffResult('s1', 's1:t1|this-turn', { state: 'ok', files: [file], summary })
    useDiffStore.getState().setCheckpointDiffResult('s1', 's1:t1|since-then', { state: 'ok', files: [file], summary })
    useDiffStore.getState().setCheckpointDiffResult('s1', 's1:t1|since-start', { state: 'ok', files: [file], summary })
    useDiffStore.getState().clearCheckpointDiffCache('s1')
    const cd = useDiffStore.getState().bySession['s1'].checkpointDiff
    expect(Object.keys(cd)).toEqual(['s1:t1|this-turn'])
    expect(cd['s1:t1|this-turn']).toMatchObject({ status: 'ready', state: 'ok' })
    expect(cd['s1:t1|since-then']).toBeUndefined()
    expect(cd['s1:t1|since-start']).toBeUndefined()
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
  it('clearSession also wipes checkpoint/git state back to EMPTY_DIFF', () => {
    useDiffStore.getState().setCheckpoints('s1', [cp('s1:t1')], true, 'main')
    useDiffStore.getState().setCheckpointDiffLoading('s1', 's1:t1|this-turn')
    useDiffStore.getState().setCommitLogLoading('s1')
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().bySession['s1']).toEqual(EMPTY_DIFF)
  })
})
