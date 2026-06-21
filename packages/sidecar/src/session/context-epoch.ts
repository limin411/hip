// ── ContextEpoch: durable baseline with revision-based fencing ────────────────
//
// One row per session in `session_context_epoch`. The row holds the durable
// SystemContext baseline + snapshot, an agent identifier, and a monotonically
// increasing `revision`. Every mutation bumps revision and is guarded by
// `WHERE revision = expected`; a concurrent writer that read a stale revision
// affects 0 rows and surfaces a RevisionMismatchError so the caller can retry.
//
// Lifecycle:
//   initialize()         — first creation; inserts row at revision 0
//   prepare()            — turn-entry check; reconciles or replaces the baseline
//   current()            — fence: does (agent, revision) still match the row?
//   requestReplacement() — flag the next prepare() to do a full replace
//   reset()              — delete the row (session move / destroy)

import type { DatabaseSync } from '../persistence/sqlite.js'
import type { Generation, Snapshot, SystemContext } from './system-context.js'

// ── Errors ────────────────────────────────────────────────────────────────────

export class RevisionMismatchError extends Error {
  constructor(
    readonly sessionId: string,
    readonly expectedRevision: number,
  ) {
    super(
      `Revision mismatch for session ${sessionId}: expected revision ${expectedRevision}, but the epoch was modified by another caller`,
    )
    this.name = 'RevisionMismatchError'
  }
}

export class LocationMismatchError extends Error {
  constructor(
    readonly sessionId: string,
    readonly expectedCwd: string,
    readonly actualCwd: string,
  ) {
    super(
      `Location mismatch for session ${sessionId}: epoch is at "${expectedCwd}", but caller is at "${actualCwd}"`,
    )
    this.name = 'LocationMismatchError'
  }
}

export class EpochNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`No context epoch for session ${sessionId}; call initialize() first`)
    this.name = 'EpochNotFoundError'
  }
}

export class EpochAlreadyExistsError extends Error {
  constructor(readonly sessionId: string) {
    super(
      `Context epoch already exists for session ${sessionId}; call reset() before re-initializing`,
    )
    this.name = 'EpochAlreadyExistsError'
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Location {
  readonly cwd: string
}

export type PrepareResult =
  | { readonly action: 'unchanged' }
  | {
      readonly action: 'updated'
      readonly messages: readonly string[]
      readonly revision: number
    }
  | { readonly action: 'replace'; readonly generation: Generation }

// ── DB row shape ──────────────────────────────────────────────────────────────

interface EpochRow {
  readonly session_id: string
  readonly baseline: string
  readonly agent: string
  readonly snapshot: string
  readonly baseline_seq: number
  readonly replacement_seq: number | null
  readonly revision: number
  readonly location: string
}

type EpochColumn = 'baseline' | 'agent' | 'snapshot' | 'baseline_seq' | 'replacement_seq'
type EpochValue = string | number | null
type EpochUpdate = Readonly<Partial<Record<EpochColumn, EpochValue>>>

// ── ContextEpoch ──────────────────────────────────────────────────────────────

export class ContextEpoch {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Create the initial epoch row at revision 0. Throws `EpochAlreadyExistsError`
   * if a row is already present — call `reset()` first (e.g., after a session move).
   */
  initialize(
    sessionId: string,
    agent: string,
    location: Location,
    baseline: string,
    snapshot: Snapshot,
    baselineSeq: number,
  ): void {
    if (this.loadRow(sessionId) !== null) {
      throw new EpochAlreadyExistsError(sessionId)
    }
    this.db
      .prepare(
        `INSERT INTO session_context_epoch
           (session_id, baseline, agent, snapshot, baseline_seq, replacement_seq, revision, location)
         VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`,
      )
      .run(
        sessionId,
        baseline,
        agent,
        JSON.stringify(snapshot),
        baselineSeq,
        location.cwd,
      )
  }

  /**
   * Turn-entry preparation. Loads the epoch, validates location, then either
   * reconciles (same agent, no pending replacement) or replaces (agent changed
   * or `replacement_seq` was set). Returns `unchanged`, `updated` (revision+
   * snapshot persisted), or `replace` (full baseline rebuilt). Throws
   * `RevisionMismatchError` on a lost race.
   */
  async prepare(
    sessionId: string,
    agent: string,
    systemContext: SystemContext,
    location: Location,
  ): Promise<PrepareResult> {
    const row = this.requireRow(sessionId)

    if (row.location !== location.cwd) {
      throw new LocationMismatchError(sessionId, row.location, location.cwd)
    }

    const expectedRevision = row.revision
    const storedSnapshot: Snapshot = JSON.parse(row.snapshot) as Snapshot
    const needsReplace = row.agent !== agent || row.replacement_seq !== null

    if (needsReplace) {
      return this.doReplace(row, agent, systemContext)
    }

    const result = await systemContext.reconcile(storedSnapshot)

    if (result._tag === 'Replace') {
      return this.doReplace(row, agent, systemContext)
    }

    if (result._tag === 'Unchanged') {
      return { action: 'unchanged' }
    }

    // Updated: persist fresh snapshot so the next reconcile compares against
    // current values. Baseline stays; returned messages carry the diff.
    const fresh = await systemContext.initialize()
    this.optimisticUpdate(sessionId, expectedRevision, {
      snapshot: JSON.stringify(fresh.snapshot),
    })
    return {
      action: 'updated',
      messages: result.messages,
      revision: expectedRevision + 1,
    }
  }

  /**
   * Fence check: returns true only if the row exists and both the agent and
   * revision match. Callers use this to validate a cached baseline before use.
   */
  current(sessionId: string, agent: string, revision: number): boolean {
    const row = this.loadRow(sessionId)
    if (row === null) return false
    return row.agent === agent && row.revision === revision
  }

  /**
   * Flag the epoch for full replacement on the next `prepare()` call.
   * Triggers: agent switch, model switch, compaction.
   */
  requestReplacement(sessionId: string, seq: number): void {
    this.db
      .prepare(
        'UPDATE session_context_epoch SET replacement_seq = ? WHERE session_id = ?',
      )
      .run(seq, sessionId)
  }

  /**
   * Delete the epoch row entirely (session move or destroy). The next
   * `initialize()` starts a fresh epoch.
   */
  reset(sessionId: string): void {
    this.db
      .prepare('DELETE FROM session_context_epoch WHERE session_id = ?')
      .run(sessionId)
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async doReplace(
    row: EpochRow,
    agent: string,
    systemContext: SystemContext,
  ): Promise<PrepareResult> {
    const storedSnapshot: Snapshot = JSON.parse(row.snapshot) as Snapshot
    const result = await systemContext.replace(storedSnapshot)
    if (result._tag === 'ReplacementBlocked') {
      // Source unavailable — keep old baseline; pending flag stays for retry.
      return { action: 'unchanged' }
    }
    this.optimisticUpdate(row.session_id, row.revision, {
      baseline: result.generation.baseline,
      snapshot: JSON.stringify(result.generation.snapshot),
      agent,
      baseline_seq: row.replacement_seq ?? row.baseline_seq,
      replacement_seq: null,
    })
    return { action: 'replace', generation: result.generation }
  }

  private loadRow(sessionId: string): EpochRow | null {
    const row = this.db
      .prepare(
        `SELECT session_id, baseline, agent, snapshot, baseline_seq, replacement_seq, revision, location
         FROM session_context_epoch WHERE session_id = ?`,
      )
      .get(sessionId) as EpochRow | undefined
    return row ?? null
  }

  private requireRow(sessionId: string): EpochRow {
    const row = this.loadRow(sessionId)
    if (row === null) throw new EpochNotFoundError(sessionId)
    return row
  }

  /**
   * Optimistic update guarded by `WHERE revision = expectedRevision`. Bumps
   * revision by 1. Throws `RevisionMismatchError` if 0 rows match (lost race).
   */
  private optimisticUpdate(
    sessionId: string,
    expectedRevision: number,
    fields: EpochUpdate,
  ): void {
    const columns = Object.keys(fields) as EpochColumn[]
    if (columns.length === 0) return
    const setClause = columns.map((c) => `${c} = ?`).join(', ')
    const params: EpochValue[] = [
      ...columns.map((c) => fields[c] as EpochValue),
      sessionId,
      expectedRevision,
    ]
    const result = this.db
      .prepare(
        `UPDATE session_context_epoch
           SET ${setClause}, revision = revision + 1
         WHERE session_id = ? AND revision = ?`,
      )
      .run(...params)
    if (result.changes === 0) {
      throw new RevisionMismatchError(sessionId, expectedRevision)
    }
  }
}
