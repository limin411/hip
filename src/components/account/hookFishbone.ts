import type { Edge, Node } from '@xyflow/react'
import type { HookEvent } from '@hip/protocol'
import type { HookEventSource } from './hookCatalog'

/** Spine Y and rib offsets for the fishbone layout (fixed, no dagre). */
const SPINE_Y = 210
const RIB_UP = 48
const RIB_DOWN = 340
const NODE_W = 148
const HEAD_W = 120

export type HookFishboneNodeData = {
  kind: 'head' | 'joint' | 'event'
  label: string
  event?: HookEvent
  configured?: boolean
  sourceCount?: number
  expanded?: boolean
  phase?: string
} & Record<string, unknown>

export type HookFishboneNode = Node<HookFishboneNodeData>

type RibSpec = {
  event: HookEvent
  /** Parent spine joint id */
  joint: string
  /** 'up' | 'down' rib side */
  side: 'up' | 'down'
  /** X offset from joint center */
  dx?: number
}

/** Lifecycle fishbone: head (left) → joints → ribs (events). */
const JOINTS: Array<{ id: string; x: number; label: string; phase: string }> = [
  { id: 'j-session', x: 200, label: 'Session', phase: 'session' },
  { id: 'j-turn', x: 380, label: 'Turn', phase: 'turn' },
  { id: 'j-tool', x: 580, label: 'Tool', phase: 'tool' },
  { id: 'j-wrap', x: 800, label: 'Wrap', phase: 'turnEnd' },
  { id: 'j-activity', x: 1000, label: 'Activity', phase: 'activity' },
]

const RIBS: RibSpec[] = [
  { event: 'SessionStart', joint: 'j-session', side: 'up' },
  { event: 'UserPromptSubmit', joint: 'j-turn', side: 'up' },
  { event: 'TurnStart', joint: 'j-turn', side: 'down' },
  { event: 'PreToolUse', joint: 'j-tool', side: 'up', dx: -48 },
  { event: 'PermissionRequest', joint: 'j-tool', side: 'down', dx: -48 },
  { event: 'PostToolUse', joint: 'j-tool', side: 'up', dx: 64 },
  { event: 'PostToolUseFailure', joint: 'j-tool', side: 'down', dx: 64 },
  { event: 'Stop', joint: 'j-wrap', side: 'up' },
  { event: 'TurnComplete', joint: 'j-wrap', side: 'down' },
  { event: 'ActivityStart', joint: 'j-activity', side: 'up', dx: -40 },
  { event: 'ActivityBudgetRequest', joint: 'j-activity', side: 'down' },
  { event: 'ActivityEnd', joint: 'j-activity', side: 'up', dx: 72 },
]

const HEAD_X = 24
const TAIL_X = 1160

function jointX(id: string): number {
  return JOINTS.find((j) => j.id === id)?.x ?? 0
}

/**
 * Build React Flow nodes/edges for the hooks fishbone diagram.
 * Pure + deterministic for tests.
 */
export function buildHookFishboneGraph(input: {
  configuredEvents: ReadonlySet<string>
  sourcesByEvent: ReadonlyMap<string, HookEventSource[]>
  expandedEvent: HookEvent | null
}): { nodes: HookFishboneNode[]; edges: Edge[] } {
  const { configuredEvents, sourcesByEvent, expandedEvent } = input
  const nodes: HookFishboneNode[] = []
  const edges: Edge[] = []

  nodes.push({
    id: 'head',
    type: 'spine',
    position: { x: HEAD_X, y: SPINE_Y - 18 },
    data: {
      kind: 'head',
      label: 'Agent loop',
      phase: 'session',
    },
    draggable: false,
    selectable: false,
    style: { width: HEAD_W },
  })

  for (const j of JOINTS) {
    nodes.push({
      id: j.id,
      type: 'spine',
      position: { x: j.x - 28, y: SPINE_Y - 12 },
      data: {
        kind: 'joint',
        label: j.label,
        phase: j.phase,
      },
      draggable: false,
      selectable: false,
      style: { width: 56 },
    })
  }

  nodes.push({
    id: 'tail',
    type: 'spine',
    position: { x: TAIL_X, y: SPINE_Y - 12 },
    data: {
      kind: 'joint',
      label: '…',
      phase: 'activity',
    },
    draggable: false,
    selectable: false,
    style: { width: 40 },
  })

  // Spine chain
  const spineIds = ['head', ...JOINTS.map((j) => j.id), 'tail']
  for (let i = 0; i < spineIds.length - 1; i++) {
    edges.push({
      id: `spine-${spineIds[i]}-${spineIds[i + 1]}`,
      source: spineIds[i],
      sourceHandle: 'spine-out',
      target: spineIds[i + 1],
      targetHandle: 'spine-in',
      type: 'smoothstep',
      className: 'hook-fishbone-spine',
      selectable: false,
      focusable: false,
    })
  }

  for (const rib of RIBS) {
    const configured = configuredEvents.has(rib.event)
    const sources = sourcesByEvent.get(rib.event) ?? []
    const jx = jointX(rib.joint)
    const dx = rib.dx ?? 0
    const y = rib.side === 'up' ? RIB_UP : RIB_DOWN
    const expanded = expandedEvent === rib.event

    nodes.push({
      id: `event-${rib.event}`,
      type: 'hookEvent',
      position: { x: jx + dx - NODE_W / 2, y },
      data: {
        kind: 'event',
        label: rib.event,
        event: rib.event,
        configured,
        sourceCount: sources.length,
        expanded,
      },
      draggable: false,
      selectable: true,
      style: { width: NODE_W },
    })

    edges.push({
      id: `rib-${rib.joint}-${rib.event}`,
      source: rib.joint,
      sourceHandle: rib.side === 'up' ? 'rib-up' : 'rib-down',
      target: `event-${rib.event}`,
      targetHandle: rib.side === 'up' ? 'from-spine' : 'from-spine-top',
      type: 'smoothstep',
      className: configured ? 'hook-fishbone-rib-on' : 'hook-fishbone-rib',
      selectable: false,
      focusable: false,
    })
  }

  return { nodes, edges }
}

export const FISHBONE_EVENT_IDS = RIBS.map((r) => r.event)
