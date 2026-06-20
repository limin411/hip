import type { ServerMessage, DiffBase, DiffState, DiffFile, Checkpoint, CommitLogEntry, CheckpointMode, Branch } from '@hip/protocol'
import type { SessionStore } from '../persistence/store.js'
import * as workspaceGit from './workspace-git.js'

type SendFn = (msg: ServerMessage) => void

export class GitOperations {
  private _diffBaseSha: string | null = null
  private _lastCheckpointCommit: string | null = null

  constructor(
    private readonly sessionId: string,
    private readonly store: SessionStore | undefined,
  ) {}

  /** Resolve the session-start snapshot SHA: prefer memory cache, fall back to DB. */
  resolvedDiffBaseSha(): string | null {
    return this._diffBaseSha ?? this.store?.getSession(this.sessionId)?.diff_base_sha ?? null
  }

  get diffBaseSha(): string | null { return this._diffBaseSha }
  set diffBaseSha(sha: string | null) { this._diffBaseSha = sha }

  get lastCheckpointCommit(): string | null { return this._lastCheckpointCommit }
  set lastCheckpointCommit(sha: string | null) { this._lastCheckpointCommit = sha }

  /** Re-seed _lastCheckpointCommit from the store on lazy resume. */
  reseedLastCheckpoint(): void {
    if (this._lastCheckpointCommit) return
    this._lastCheckpointCommit =
      this.store?.listCheckpoints(this.sessionId)[0]?.commitSha ??
      this.store?.getSessionGitMeta(this.sessionId).sessionStartCommit ??
      null
  }

  /** Session-start snapshot capture + checkpoint #0 (fire-and-forget). */
  async captureSnapshot(cwd: string | undefined): Promise<void> {
    if (!cwd) return
    const sha = await workspaceGit.captureSessionSnapshot(cwd)
    this._diffBaseSha = sha
    this.store?.setDiffBaseSha(this.sessionId, sha)

    const branch = await workspaceGit.getCurrentBranch(cwd)
    this.store?.setSessionBranch(this.sessionId, branch)
    let startCommit: string | null = null
    try { startCommit = (await workspaceGit.collectCommitLog(cwd, null)).commits?.[0]?.sha ?? null } catch { startCommit = null }
    this.store?.setSessionStartCommit(this.sessionId, startCommit)

    const r = await workspaceGit.captureCheckpoint(cwd, { sessionId: this.sessionId, turnId: 'start', label: null, prevCommit: startCommit })
    if (r.ok && !r.skipped && r.commitSha) {
      this._lastCheckpointCommit = r.commitSha
      this.store?.insertCheckpoint({ id: `${this.sessionId}:start`, sessionId: this.sessionId, turnId: null, kind: 'start', label: null, treeSha: r.treeSha!, commitSha: r.commitSha, branch: r.branch ?? branch, createdAt: Date.now() })
    } else {
      this._lastCheckpointCommit = startCommit
    }
  }

  private resolveBase(cwd: string | undefined, base: DiffBase): { base: DiffBase; baseSha: string | null; hasSessionStart: boolean } {
    if (!cwd) return { base: 'head', baseSha: null, hasSessionStart: false }
    const snap = this.resolvedDiffBaseSha()
    const hasSessionStart = snap != null
    const effective: DiffBase = base === 'session-start' && hasSessionStart ? 'session-start' : 'head'
    return { base: effective, baseSha: effective === 'session-start' ? snap : null, hasSessionStart }
  }

  /** Worktree-vs-HEAD diff of the bound cwd subtree. Never throws. */
  async workspaceDiff(cwd: string | undefined, base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
    if (!cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
    const b = this.resolveBase(cwd, base)
    const r = await workspaceGit.collectWorkspaceDiff(cwd, { base: b.base, baseSha: b.baseSha })
    return { ...r, base: b.base, hasSessionStart: b.hasSessionStart }
  }

  /** Summary-only diff (feeds the badge). Never throws. */
  async workspaceDiffSummary(cwd: string | undefined, base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
    if (!cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
    const b = this.resolveBase(cwd, base)
    const r = await workspaceGit.collectWorkspaceDiffSummary(cwd, { base: b.base, baseSha: b.baseSha })
    return { ...r, base: b.base, hasSessionStart: b.hasSessionStart }
  }

  /** Single-file diff with custom context. */
  async workspaceDiffFile(cwd: string | undefined, filePath: string, base: DiffBase = 'head', context?: number | 'full'): Promise<{ state: DiffState; file?: DiffFile; error?: string }> {
    if (!cwd) return { state: 'no_cwd' }
    const b = this.resolveBase(cwd, base)
    return workspaceGit.collectWorkspaceDiffFile(cwd, filePath, { base: b.base, baseSha: b.baseSha, context })
  }

  /** One-click `git init` + baseline commit in the bound cwd. */
  async workspaceGitInit(cwd: string | undefined): Promise<{ ok: boolean; error?: string }> {
    if (!cwd) return { ok: false, error: 'no_workspace' }
    return workspaceGit.gitInit(cwd)
  }

  /** Capture a per-turn checkpoint (fire-and-forget after finalize). */
  async captureCheckpoint(cwd: string | undefined, turnId: string, label: string | null, send: SendFn): Promise<void> {
    if (!cwd) return
    const prev = this._lastCheckpointCommit
    const r = await workspaceGit.captureCheckpoint(cwd, { sessionId: this.sessionId, turnId, label, prevCommit: prev })
    if (!r.ok || r.skipped || !r.commitSha) return
    this._lastCheckpointCommit = r.commitSha
    const checkpoint = { id: `${this.sessionId}:${turnId}`, sessionId: this.sessionId, turnId, kind: 'turn' as const, label, treeSha: r.treeSha!, commitSha: r.commitSha, branch: r.branch ?? null, createdAt: Date.now() }
    this.store?.insertCheckpoint(checkpoint)
    if (r.branch) this.store?.setSessionBranch(this.sessionId, r.branch)
    send({ type: 'checkpoint:created', sessionId: this.sessionId, checkpoint })
  }

  /** List checkpoints (newest-first) + live repo state. */
  async listCheckpoints(cwd: string | undefined): Promise<{ checkpoints: Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }> {
    const checkpoints = this.store?.listCheckpoints(this.sessionId) ?? []
    const isGitRepo = cwd ? (await workspaceGit.getCurrentBranch(cwd)) !== null || (await workspaceGit.collectCommitLog(cwd, null)).state === 'ok' : false
    const currentBranch = cwd ? await workspaceGit.getCurrentBranch(cwd) : null
    return { checkpoints, isGitRepo, currentBranch }
  }

  /** Diff for a timeline checkpoint in one of the three modes. */
  async checkpointDiff(cwd: string | undefined, checkpointId: string, mode: CheckpointMode): Promise<workspaceGit.WorkspaceDiff> {
    if (!cwd) return { state: 'no_cwd' }
    const all = this.store?.listCheckpoints(this.sessionId) ?? []
    const cp = all.find((c) => c.id === checkpointId)
    if (!cp) return { state: 'error', error: 'checkpoint not found' }
    const startCp = all.find((c) => c.kind === 'start')
    if (mode === 'since-then') {
      return workspaceGit.collectWorkspaceDiff(cwd, { base: 'session-start', baseSha: cp.treeSha })
    }
    if (mode === 'since-start') {
      const baseSha = startCp?.treeSha ?? this._diffBaseSha
      return workspaceGit.collectWorkspaceDiff(cwd, { base: 'session-start', baseSha })
    }
    const idx = all.findIndex((c) => c.id === cp.id)
    const prev = all[idx + 1]
    const baseSha = prev?.treeSha ?? startCp?.treeSha ?? this._diffBaseSha
    return workspaceGit.collectWorkspaceDiff(cwd, { base: 'session-start', baseSha, headSha: cp.treeSha })
  }

  /** Commit log session-start..HEAD. */
  async commitLog(cwd: string | undefined): Promise<{ state: DiffState; commits?: CommitLogEntry[]; error?: string }> {
    if (!cwd) return { state: 'no_cwd' }
    const start = this.store?.getSessionGitMeta(this.sessionId).sessionStartCommit ?? null
    return workspaceGit.collectCommitLog(cwd, start)
  }

  /** Revert the worktree to a checkpoint's tree (worktree-only; HEAD untouched). */
  async revertCheckpoint(cwd: string | undefined, checkpointId: string, send: SendFn): Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }> {
    if (!cwd) return { ok: false, error: 'no_workspace' }
    const all = this.store?.listCheckpoints(this.sessionId) ?? []
    const cp = all.find((c) => c.id === checkpointId)
    if (!cp) return { ok: false, error: 'checkpoint not found' }
    const r = await workspaceGit.revertToCheckpoint(cwd, {
      sessionId: this.sessionId, targetTree: cp.treeSha, prevCommit: this._lastCheckpointCommit ?? cp.commitSha,
    })
    if (!r.ok) return r
    if (r.safetyCheckpointId) {
      const turnId = r.safetyCheckpointId.split(':').slice(1).join(':')
      const meta = await workspaceGit.checkpointRefMeta(cwd, this.sessionId, turnId)
      if (meta) {
        const safety = { id: r.safetyCheckpointId, sessionId: this.sessionId, turnId, kind: 'pre-revert' as const, label: 'pre-revert safety', treeSha: meta.treeSha, commitSha: meta.commitSha, branch: meta.branch, createdAt: Date.now() }
        this.store?.insertCheckpoint(safety)
        this._lastCheckpointCommit = meta.commitSha
        send({ type: 'checkpoint:created', sessionId: this.sessionId, checkpoint: safety })
      }
    }
    const postTurnId = `post-revert-${Date.now()}`
    await this.captureCheckpoint(cwd, postTurnId, 'post-revert', send)
    return r
  }

  /** List branches (+ current). */
  async listBranches(cwd: string | undefined): Promise<{ branches: Branch[]; currentBranch: string | null }> {
    if (!cwd) return { branches: [], currentBranch: null }
    const r = await workspaceGit.listBranches(cwd)
    const currentBranch = await workspaceGit.getCurrentBranch(cwd)
    return { branches: r.branches ?? [], currentBranch }
  }

  /** Switch the checkout to a branch. */
  async switchBranch(cwd: string | undefined, branch: string): Promise<{ ok: boolean; currentBranch: string | null; error?: string }> {
    if (!cwd) return { ok: false, currentBranch: null, error: 'no_workspace' }
    const r = await workspaceGit.switchBranch(cwd, branch)
    const currentBranch = await workspaceGit.getCurrentBranch(cwd)
    if (r.ok) this.store?.setSessionBranch(this.sessionId, currentBranch)
    return { ok: r.ok, currentBranch, error: r.error }
  }
}
