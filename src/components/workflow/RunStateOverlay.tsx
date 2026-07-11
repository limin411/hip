import type { RunState, NodeStatus } from '@hip/protocol'
import { cn } from '@/lib/utils'

// ── Props ──
export interface RunStateOverlayProps {
  /** The current run state snapshot, if a run is active. */
  runState?: RunState
  /** Map of node id → status, used to compute counts without scanning every node. */
  nodeStatuses?: Map<string, NodeStatus>
}

// ── Status config ──
interface StatusConfig {
  dotClass: string
  label: string
  color: string
}

const STATUS_CONFIG: Record<NodeStatus, StatusConfig> = {
  pending:   { dotClass: 'pending',   label: 'Pending',   color: 'bg-ink-tertiary' },
  ready:     { dotClass: 'pending',   label: 'Ready',     color: 'bg-ink-tertiary' },
  running:   { dotClass: 'running',   label: 'Running',   color: 'bg-accent' },
  succeeded: { dotClass: 'succeeded', label: 'Succeeded', color: 'bg-success' },
  failed:    { dotClass: 'failed',    label: 'Failed',    color: 'bg-danger' },
  skipped:   { dotClass: 'skipped',   label: 'Skipped',   color: 'bg-ink-tertiary' },
  cancelled: { dotClass: 'skipped',   label: 'Cancelled', color: 'bg-ink-tertiary' },
}

/** Statuses that should appear in the legend, in display order. */
const LEGEND_STATUSES: NodeStatus[] = ['running', 'succeeded', 'failed', 'skipped', 'pending']

// ── Component ──
export function RunStateOverlay({ runState, nodeStatuses }: RunStateOverlayProps) {
  if (!runState) return null

  // Count nodes by status
  const counts = new Map<NodeStatus, number>()
  if (nodeStatuses) {
    for (const [, status] of nodeStatuses) {
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
  }

  const runStatusLabel = (() => {
    switch (runState.status) {
      case 'running':   return 'Workflow Running…'
      case 'succeeded': return 'Workflow Complete'
      case 'failed':    return 'Workflow Failed'
      case 'cancelled': return 'Workflow Cancelled'
      default:          return 'Workflow Pending'
    }
  })()

  return (
    <div className="dag-legend" data-testid="runstate-overlay">
      <div className="dag-legend-title">{runStatusLabel}</div>

      {LEGEND_STATUSES.map((status) => {
        const cfg = STATUS_CONFIG[status]
        const count = counts.get(status) ?? 0
        return (
          <div key={status} className="dag-legend-item">
            <span className={cn('dag-status-dot', cfg.dotClass)} />
            <span>{cfg.label}</span>
            <span className="count">{count}</span>
          </div>
        )
      })}

      {runState.status === 'running' && (
        <div className="dag-legend-item" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          <span className={cn('dag-status-dot', 'running')} />
          <span>Run ID</span>
          <span className="count" style={{ fontSize: 10, fontFamily: 'monospace' }}>
            {runState.runId.slice(0, 8)}
          </span>
        </div>
      )}
    </div>
  )
}
