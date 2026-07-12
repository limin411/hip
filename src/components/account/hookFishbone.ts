import type { Edge, Node } from '@xyflow/react'
import type { HookEvent } from '@hip/protocol'
import type { HookEventSource } from './hookCatalog'

/** Spine X and rib side offsets for the vertical fishbone (fixed, no dagre). */
const SPINE_X = 300
const RIB_LEFT = 12
const RIB_RIGHT = 420
const NODE_W = 168
const HEAD_W = 136
const JOINT_W = 76

export type HookFishboneNodeData = {
  kind: 'head' | 'joint' | 'event'
  label: string
  event?: HookEvent
  configured?: boolean
  sourceCount?: number
  expanded?: boolean
  phase?: string
  side?: 'left' | 'right'
} & Record<string, unknown>

export type HookFishboneNode = Node<HookFishboneNodeData>

type RibSpec = {
  event: HookEvent
  /** Parent spine joint id */
  joint: string
  /** 'left' | 'right' rib side */
  side: 'left' | 'right'
  /** Y offset from joint center */
  dy?: number
}

/** Lifecycle fishbone: head (top) → joints → ribs (events left/right). */
const JOINTS: Array<{ id: string; y: number; label: string; phase: string }> = [
  { id: 'j-session', y: 118, label: 'Session', phase: 'session' },
  { id: 'j-turn', y: 248, label: 'Turn', phase: 'turn' },
  { id: 'j-tool', y: 400, label: 'Tool', phase: 'tool' },
  { id: 'j-wrap', y: 560, label: 'Wrap', phase: 'turnEnd' },
  { id: 'j-activity', y: 720, label: 'Activity', phase: 'activity' },
]

const RIBS: RibSpec[] = [
  { event: 'SessionStart', joint: 'j-session', side: 'left' },
  { event: 'UserPromptSubmit', joint: 'j-turn', side: 'left' },
  { event: 'TurnStart', joint: 'j-turn', side: 'right' },
  { event: 'PreToolUse', joint: 'j-tool', side: 'left', dy: -36 },
  { event: 'PermissionRequest', joint: 'j-tool', side: 'right', dy: -36 },
  { event: 'PostToolUse', joint: 'j-tool', side: 'left', dy: 44 },
  { event: 'PostToolUseFailure', joint: 'j-tool', side: 'right', dy: 44 },
  { event: 'Stop', joint: 'j-wrap', side: 'left' },
  { event: 'TurnComplete', joint: 'j-wrap', side: 'right' },
  { event: 'ActivityStart', joint: 'j-activity', side: 'left', dy: -32 },
  { event: 'ActivityBudgetRequest', joint: 'j-activity', side: 'right' },
  { event: 'ActivityEnd', joint: 'j-activity', side: 'left', dy: 48 },
]

const HEAD_Y = 20
const TAIL_Y = 850

function jointY(id: string): number {
  return JOINTS.find((j) => j.id === id)?.y ?? 0
}

/**
 * Build React Flow nodes/edges for the vertical hooks fishbone diagram.
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
    position: { x: SPINE_X - HEAD_W / 2, y: HEAD_Y },
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
      position: { x: SPINE_X - JOINT_W / 2, y: j.y },
      data: {
        kind: 'joint',
        label: j.label,
        phase: j.phase,
      },
      draggable: false,
      selectable: false,
      style: { width: JOINT_W },
    })
  }

  nodes.push({
    id: 'tail',
    type: 'spine',
    position: { x: SPINE_X - 18, y: TAIL_Y },
    data: {
      kind: 'joint',
      label: '…',
      phase: 'activity',
    },
    draggable: false,
    selectable: false,
    style: { width: 36 },
  })

  // Spine chain (top → bottom)
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
    const jy = jointY(rib.joint)
    const dy = rib.dy ?? 0
    const x = rib.side === 'left' ? RIB_LEFT : RIB_RIGHT
    const expanded = expandedEvent === rib.event

    nodes.push({
      id: `event-${rib.event}`,
      type: 'hookEvent',
      position: { x, y: jy + dy },
      data: {
        kind: 'event',
        label: rib.event,
        event: rib.event,
        configured,
        sourceCount: sources.length,
        expanded,
        side: rib.side,
      },
      draggable: false,
      selectable: true,
      style: { width: NODE_W },
    })

    edges.push({
      id: `rib-${rib.joint}-${rib.event}`,
      source: rib.joint,
      sourceHandle: rib.side === 'left' ? 'rib-left' : 'rib-right',
      target: `event-${rib.event}`,
      targetHandle: rib.side === 'left' ? 'from-spine-right' : 'from-spine-left',
      type: 'smoothstep',
      className: configured ? 'hook-fishbone-rib-on' : 'hook-fishbone-rib',
      selectable: false,
      focusable: false,
    })
  }

  return { nodes, edges }
}

export const FISHBONE_EVENT_IDS = RIBS.map((r) => r.event)
