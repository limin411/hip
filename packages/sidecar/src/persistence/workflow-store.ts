import type { DatabaseSync } from './sqlite.js'
import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'
import type { WorkflowStore } from '../orchestrator/ports.js'

export class SqliteWorkflowStore implements WorkflowStore {
  private insertDef: ReturnType<DatabaseSync['prepare']>
  private selectDef: ReturnType<DatabaseSync['prepare']>
  private upsertRun: ReturnType<DatabaseSync['prepare']>
  private selectRun: ReturnType<DatabaseSync['prepare']>
  private insertEvent: ReturnType<DatabaseSync['prepare']>
  private selectEvents: ReturnType<DatabaseSync['prepare']>

  constructor(private db: DatabaseSync) {
    this.insertDef = db.prepare(
      `INSERT OR REPLACE INTO workflow_defs (id, name, def_json) VALUES (?, ?, ?)`,
    )
    this.selectDef = db.prepare(
      `SELECT def_json FROM workflow_defs WHERE id = ?`,
    )
    this.upsertRun = db.prepare(
      `INSERT OR REPLACE INTO workflow_runs
       (run_id, workflow_id, status, state_json, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())`,
    )
    this.selectRun = db.prepare(
      `SELECT state_json, status FROM workflow_runs WHERE run_id = ?`,
    )
    this.insertEvent = db.prepare(
      `INSERT INTO workflow_events (run_id, event_json) VALUES (?, ?)`,
    )
    this.selectEvents = db.prepare(
      `SELECT event_json FROM workflow_events WHERE run_id = ? ORDER BY id`,
    )
  }

  async saveDef(def: WorkflowDef): Promise<void> {
    this.insertDef.run(def.id, def.name, JSON.stringify(def))
  }

  async loadDef(id: string): Promise<WorkflowDef | null> {
    const row = this.selectDef.get(id) as { def_json: string } | undefined
    return row ? (JSON.parse(row.def_json) as WorkflowDef) : null
  }

  async saveRun(run: RunState): Promise<void> {
    this.upsertRun.run(
      run.runId,
      run.workflowId,
      run.status,
      JSON.stringify(run),
    )
  }

  async loadRun(runId: string): Promise<RunState | null> {
    const row = this.selectRun.get(runId) as
      | { state_json: string; status: string }
      | undefined
    if (!row) return null
    return JSON.parse(row.state_json) as RunState
  }

  /** Append one event to the event log. Called after every reduce() transition. */
  appendEvent(runId: string, event: OrchestratorEvent): void {
    this.insertEvent.run(runId, JSON.stringify(event))
  }

  /** Replay all events for a run in insertion order. */
  replayEvents(runId: string): OrchestratorEvent[] {
    const rows = this.selectEvents.all(runId) as { event_json: string }[]
    return rows.map((r) => JSON.parse(r.event_json) as OrchestratorEvent)
  }

  /** Delete all data for a run (cleanup after finalization). */
  deleteRun(runId: string): void {
    this.db.prepare(`DELETE FROM workflow_events WHERE run_id = ?`).run(runId)
    this.db.prepare(`DELETE FROM workflow_runs WHERE run_id = ?`).run(runId)
  }
}
