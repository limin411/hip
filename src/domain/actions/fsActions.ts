// src/domain/actions/fsActions.ts
// Workspace diff / git / file-browsing wire actions, extracted from
// SessionService (P3, spec docs/design/2026-08-07-session-service-decomposition-spec.md).
import type { DiffBase, DiffFileStatus } from '@hip/protocol'
import type { Transport } from '../transport'
import { useDiffStore } from '@/store/diffStore'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'

export class FsActions {
  constructor(private readonly transport: Transport) {}

  requestDiff(sessionId: string, base?: DiffBase, ignoreWhitespace?: boolean): 'sent' | 'deduped' {
    const cur = useDiffStore.getState().bySession[sessionId]
    if (cur?.status === 'loading') return 'deduped'
    const b = base ?? cur?.base ?? 'session-start'
    const ig = ignoreWhitespace ?? useUiStore.getState().ignoreWhitespace
    useDiffStore.getState().setLoading(sessionId)
    useDiffStore.getState().setRefreshing(sessionId, true)
    this.transport.send({ type: 'fs:diff', sessionId, base: b, ...(ig ? { ignoreWhitespace: true } : {}) })
    return 'sent'
  }

  /** Request a single file's full diff (for on-demand show-full). */
  requestDiffFile(sessionId: string, p: string, context: number | 'full' = 'full'): void {
    const base = useDiffStore.getState().bySession[sessionId]?.base ?? 'session-start'
    this.transport.send({ type: 'fs:diffFile', sessionId, path: p, base, context })
  }

  /** One-click `git init` for a non-repo cwd; a successful result chains a fresh diff. */
  gitInitWorkspace(sessionId: string): void {
    useDiffStore.getState().setInitPending(sessionId, true)
    this.transport.send({ type: 'fs:gitInit', sessionId })
  }

  /** Pull the checkpoint list result meta (isGitRepo / current branch) for the Changes tab gating. */
  requestCheckpoints(sessionId: string): void {
    this.transport.send({ type: 'git:checkpoint:list', sessionId })
  }

  /** Pull the recent repo commit log (capped) for the 更改 tab. */
  requestCommitLog(sessionId: string): void {
    useDiffStore.getState().setCommitLogLoading(sessionId)
    this.transport.send({ type: 'git:commitLog', sessionId })
  }

  /** Load the diff introduced by one commit; the Changes panel swaps into commit mode. */
  requestCommitDiff(sessionId: string, sha: string): void {
    useDiffStore.getState().setViewingCommit(sessionId, sha)
    useDiffStore.getState().setCommitDiffLoading(sessionId)
    this.transport.send({ type: 'git:commitDiff', sessionId, sha })
  }

  /** Discard one working-tree change (restore to HEAD; sidecar keeps a trash copy). */
  discardFile(sessionId: string, path: string, status: DiffFileStatus, oldPath?: string): void {
    useDiffStore.getState().setDiscardPending(sessionId, path, true)
    this.transport.send({
      type: 'git:discard',
      sessionId,
      path,
      status,
      ...(oldPath ? { oldPath } : {}),
    })
  }

  /** Pull the branch list (+ current) for the BranchSwitcher. */
  requestBranches(sessionId: string): void {
    this.transport.send({ type: 'git:branch:list', sessionId })
  }

  /** Switch the checkout to a branch. The :result re-pulls branches + diff. */
  switchBranch(sessionId: string, branch: string): void {
    this.transport.send({ type: 'git:branch:switch', sessionId, branch })
  }

  lsDir(sessionId: string, path: string): void {
    this.transport.send({ type: 'fs:ls', sessionId, path })
  }

  readFile(sessionId: string, path: string): void {
    useFsStore.getState().setPreview(sessionId, { status: 'loading', path })
    this.transport.send({ type: 'fs:read', sessionId, path })
  }

  lsDraft(cwd: string, path: string): void {
    this.transport.send({ type: 'fs:lsCwd', cwd, path })
  }

  /** Read a file for an un-committed draft (cwd-keyed). Preview is keyed by cwd. */
  readDraftFile(cwd: string, path: string): void {
    useFsStore.getState().setPreview(cwd, { status: 'loading', path })
    this.transport.send({ type: 'fs:readCwd', cwd, path })
  }
}
