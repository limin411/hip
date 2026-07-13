import { useMemo, useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  WorkflowDef,
  RunState,
  WorkflowNode,
  AgentNode,
  ToolNode,
  GateNode,
  ParallelNode,
  HumanNode,
  NodeId,
  NodeStatus,
  NodeOutput,
  EdgeCondition,
} from '@hip/protocol'
import { cn } from '@/lib/utils'
import './DagEditor.css'
import { RunStateOverlay } from './RunStateOverlay'

// ── Constants ──
const NODE_W = 220
const NODE_H_SMALL = 70
const NODE_H_LARGE = 90
const H_GAP = 80
const V_GAP = 50
const PARALLEL_W = 280
const PARALLEL_H = 160

/**
 * Node types offered by the DagEditor authoring palette.
 * `tool` / `human` are intentionally excluded: C-validate rejects them at run,
 * protocol marks them `@deprecated`, and C-shrink may hard-delete them later.
 * Render cards for tool/human remain for read-only projection of legacy defs.
 */
export const DAG_PALETTE_NODE_TYPES = ['agent', 'gate', 'parallel'] as const
export type DagPaletteNodeType = (typeof DAG_PALETTE_NODE_TYPES)[number]

/** Deprecated leaf types — not authorable via palette (still projectable). */
export const DAG_DEPRECATED_NODE_TYPES = ['tool', 'human'] as const
export type DagDeprecatedNodeType = (typeof DAG_DEPRECATED_NODE_TYPES)[number]

const PALETTE_LABELS: Record<DagPaletteNodeType, string> = {
  agent: 'Agent',
  gate: 'Gate',
  parallel: 'Parallel',
}

export function isPaletteNodeType(type: string): type is DagPaletteNodeType {
  return (DAG_PALETTE_NODE_TYPES as readonly string[]).includes(type)
}

// ── Custom node data (extends Record<string,unknown> for @xyflow/react v12) ──
interface DagNodeData extends Record<string, unknown> {
  nodeType: WorkflowNode['type']
  label: string
  agentId?: string
  inputTemplate?: string
  toolName?: string
  gateKind?: string
  question?: string
  mergeStrategy?: string
  subNodes?: WorkflowNode[]
  status?: NodeStatus
  output?: NodeOutput
  error?: string
}

type DagFlowNode = Node<DagNodeData>

// ── Status helpers ──
function statusColorClass(status?: NodeStatus): string {
  switch (status) {
    case 'succeeded': return 'status-succeeded'
    case 'running':   return 'status-running'
    case 'failed':    return 'status-failed'
    case 'pending':   return 'status-pending'
    case 'skipped':
    case 'cancelled': return 'status-skipped'
    default:          return ''
  }
}

function statusDot(status?: NodeStatus): string {
  switch (status) {
    case 'succeeded': return 'succeeded'
    case 'running':   return 'running'
    case 'failed':    return 'failed'
    case 'pending':   return 'pending'
    case 'skipped':
    case 'cancelled': return 'skipped'
    default:          return 'pending'
  }
}

function edgeConditionLabel(cond?: EdgeCondition): string {
  if (!cond || cond.kind === 'always') return 'always'
  if (cond.kind === 'contains') return `contains ${cond.value ?? ''}`
  if (cond.kind === 'equals')  return `== ${cond.value ?? ''}`
  return ''
}

function nodeMeta(n: WorkflowNode): { label: string; metaLines: string[]; nodeTypeClass: string } {
  switch (n.type) {
    case 'agent': {
      const a = n as AgentNode
      return { label: a.agentId, metaLines: [a.inputTemplate], nodeTypeClass: 'agent' }
    }
    case 'tool': {
      const t = n as ToolNode
      return { label: t.toolName, metaLines: [t.inputTemplate], nodeTypeClass: 'tool' }
    }
    case 'gate': {
      const g = n as GateNode
      return { label: g.gateKind, metaLines: [], nodeTypeClass: 'gate' }
    }
    case 'parallel': {
      const p = n as ParallelNode
      return { label: `Parallel (${p.mergeStrategy})`, metaLines: [`${p.nodes.length} branches`], nodeTypeClass: 'parallel' }
    }
    case 'human': {
      const h = n as HumanNode
      return { label: 'Human Input', metaLines: [h.question], nodeTypeClass: 'human' }
    }
  }
}

// ── Custom node components ──

function AgentNodeCard({ data, selected }: NodeProps<DagFlowNode>) {
  return (
    <div className={cn('dag-node', selected && 'ring-2 ring-accent', statusColorClass(data.status))}>
      <Handle type="target" position={Position.Top} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
      <div className="dag-node-header agent">
        <span className={cn('dag-status-dot', statusDot(data.status))} />
        Agent
      </div>
      <div className="dag-node-body">
        <div className="label">{data.label as string}</div>
        {data.inputTemplate && <div className="meta">{data.inputTemplate as string}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
    </div>
  )
}

function ToolNodeCard({ data, selected }: NodeProps<DagFlowNode>) {
  return (
    <div className={cn('dag-node', selected && 'ring-2 ring-accent', statusColorClass(data.status))}>
      <Handle type="target" position={Position.Top} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
      <div className="dag-node-header tool">
        <span className={cn('dag-status-dot', statusDot(data.status))} />
        Tool
      </div>
      <div className="dag-node-body">
        <div className="label">{data.label as string}</div>
        {data.inputTemplate && <div className="meta">{data.inputTemplate as string}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
    </div>
  )
}

function GateNodeCard({ data, selected }: NodeProps<DagFlowNode>) {
  return (
    <div className={cn('dag-node gate', selected && 'ring-2 ring-accent', statusColorClass(data.status))}>
      <Handle type="target" position={Position.Top} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
      <div className="dag-node-header gate">
        <span className={cn('dag-status-dot', statusDot(data.status))} />
      </div>
      <div className="dag-node-body">
        <div className="label">{data.label as string}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
    </div>
  )
}

function HumanNodeCard({ data, selected }: NodeProps<DagFlowNode>) {
  return (
    <div className={cn('dag-node', selected && 'ring-2 ring-accent', statusColorClass(data.status))}>
      <Handle type="target" position={Position.Top} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
      <div className="dag-node-header human">
        <span className={cn('dag-status-dot', statusDot(data.status))} />
        Human
      </div>
      <div className="dag-node-body">
        <div className="label">Input Required</div>
        {data.question && <div className="meta">{data.question as string}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
    </div>
  )
}

function ParallelNodeCard({ data, selected }: NodeProps<DagFlowNode>) {
  const subNodesRaw = data.subNodes
  const subNodes: WorkflowNode[] = Array.isArray(subNodesRaw) ? (subNodesRaw as WorkflowNode[]) : []
  return (
    <div className={cn('dag-node parallel', selected && 'ring-2 ring-accent', statusColorClass(data.status))}>
      <Handle type="target" position={Position.Top} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
      <div className="dag-node-header parallel">
        <span className={cn('dag-status-dot', statusDot(data.status))} />
        Parallel
      </div>
      <div className="dag-node-body">
        <div className="label" style={{ marginBottom: 4 }}>{`merge: ${(data.mergeStrategy as string) ?? 'all'}`}</div>
        {subNodes.map((sub: WorkflowNode) => {
          const m = nodeMeta(sub)
          return (
            <div key={sub.id} className="dag-parallel-child">
              <span className="dag-status-dot pending" />
              <span className="child-role">{m.label}</span>
              <span className="child-meta">{m.metaLines[0] ?? m.nodeTypeClass}</span>
            </div>
          )
        })}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border !w-3 !h-3 !border-2 !border-surface" />
    </div>
  )
}

// ── Layout computation ──

interface LayoutEntry {
  x: number
  y: number
  width: number
  height: number
}

function computeLayout(workflow: WorkflowDef): Map<NodeId, LayoutEntry> {
  const nodeMap = new Map<NodeId, WorkflowNode>()
  for (const n of workflow.nodes) {
    nodeMap.set(n.id, n)
  }

  // BFS layer assignment from entry nodes
  const layerOf = new Map<NodeId, number>()
  const queue: Array<{ id: NodeId; layer: number }> = workflow.entry.map((id) => ({ id, layer: 0 }))

  // If no entry nodes defined, start from all nodes with no incoming edges
  if (queue.length === 0) {
    const hasIncoming = new Set<NodeId>()
    for (const e of workflow.edges) hasIncoming.add(e.to)
    for (const n of workflow.nodes) {
      if (!hasIncoming.has(n.id)) queue.push({ id: n.id, layer: 0 })
    }
  }

  const visited = new Set<NodeId>()
  while (queue.length > 0) {
    const { id, layer } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const existing = layerOf.get(id)
    if (existing === undefined || layer > existing) {
      layerOf.set(id, layer)
    }
    const currentLayer = layerOf.get(id)!
    for (const e of workflow.edges) {
      if (e.from === id && !visited.has(e.to)) {
        queue.push({ id: e.to, layer: currentLayer + 1 })
      }
    }
  }

  // Assign layer 0 to any unreachable nodes (disconnected subgraphs)
  for (const n of workflow.nodes) {
    if (!layerOf.has(n.id)) layerOf.set(n.id, 0)
  }

  // Group by layer
  const layers = new Map<number, NodeId[]>()
  for (const [id, layer] of layerOf) {
    const list = layers.get(layer) ?? []
    list.push(id)
    layers.set(layer, list)
  }

  // Position nodes within each layer
  const positions = new Map<NodeId, LayoutEntry>()
  for (const [layer, ids] of layers) {
    let maxW = 0
    for (const id of ids) {
      const n = nodeMap.get(id)
      if (n?.type === 'parallel') maxW = Math.max(maxW, PARALLEL_W)
      else maxW = Math.max(maxW, NODE_W)
    }
    if (maxW === 0) maxW = NODE_W

    const totalHeight = ids.reduce((sum, id) => {
      const n = nodeMap.get(id)
      const h = n?.type === 'parallel' ? PARALLEL_H : n?.type === 'gate' ? NODE_H_SMALL : NODE_H_LARGE
      return sum + h + V_GAP
    }, -V_GAP) // subtract last V_GAP

    const startY = -totalHeight / 2
    let y = startY

    ids.forEach((id) => {
      const n = nodeMap.get(id)
      const w = n?.type === 'parallel' ? PARALLEL_W : NODE_W
      const h = n?.type === 'parallel' ? PARALLEL_H : n?.type === 'gate' ? NODE_H_SMALL : NODE_H_LARGE
      positions.set(id, { x: layer * (maxW + H_GAP), y, width: w, height: h })
      y += h + V_GAP
    })
  }

  return positions
}

// ── Convert WorkflowDef to React Flow types ──

function toFlowNode(
  n: WorkflowNode,
  layout: LayoutEntry,
  runState?: RunState,
): DagFlowNode {
  const m = nodeMeta(n)
  const run = runState?.nodes[n.id]
  return {
    id: n.id,
    type: n.type,
    position: { x: layout.x, y: layout.y },
    data: {
      nodeType: n.type,
      label: m.label,
      agentId: n.type === 'agent' ? (n as AgentNode).agentId : undefined,
      inputTemplate: n.type === 'agent' || n.type === 'tool'
        ? (n as AgentNode | ToolNode).inputTemplate : undefined,
      toolName: n.type === 'tool' ? (n as ToolNode).toolName : undefined,
      gateKind: n.type === 'gate' ? (n as GateNode).gateKind : undefined,
      question: n.type === 'human' ? (n as HumanNode).question : undefined,
      mergeStrategy: n.type === 'parallel' ? (n as ParallelNode).mergeStrategy : undefined,
      subNodes: n.type === 'parallel' ? (n as ParallelNode).nodes : undefined,
      status: run?.status,
      output: run?.output,
      error: run?.error,
    },
    style: { width: layout.width, height: layout.height },
  } as DagFlowNode
}

function toFlowEdge(e: import('@hip/protocol').WorkflowEdge): Edge<{ label: string }> {
  const label = edgeConditionLabel(e.when)
  const isConditional = e.when && e.when.kind !== 'always'
  return {
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    label,
    type: 'smoothstep',
    animated: isConditional,
    style: {
      stroke: isConditional ? 'var(--warning)' : 'var(--border)',
      strokeDasharray: isConditional ? '6 3' : undefined,
    },
    labelStyle: { fill: 'var(--ink-tertiary)', fontWeight: 500, fontSize: 10 },
    labelBgStyle: { fill: 'var(--surface)', rx: 3 },
  }
}

// ── NodeTypes registry (includes deprecated types for legacy projection only) ──
const nodeTypes: NodeTypes = {
  agent:    AgentNodeCard,
  tool:     ToolNodeCard,
  gate:     GateNodeCard,
  human:    HumanNodeCard,
  parallel: ParallelNodeCard,
}

/**
 * Authoring palette — only agent / gate / parallel.
 * tool and human are omitted (not merely disabled) so they cannot be added from the UI.
 */
function NodePalette() {
  return (
    <div className="dag-palette" data-testid="dag-node-palette" aria-label="Workflow node types">
      <div className="dag-palette-title">Nodes</div>
      {DAG_PALETTE_NODE_TYPES.map((type) => (
        <div
          key={type}
          className={cn('dag-palette-item', type)}
          data-testid={`dag-palette-${type}`}
          data-node-type={type}
          data-enabled="true"
        >
          <span className={cn('dag-palette-swatch', type)} />
          {PALETTE_LABELS[type]}
        </div>
      ))}
    </div>
  )
}

// ── Props ──
export interface DagEditorProps {
  workflow: WorkflowDef
  runState?: RunState
  onNodeClick?: (nodeId: string) => void
  /** When false, hides the authoring palette (default true). */
  showPalette?: boolean
}

// ── Main component ──
export function DagEditor({ workflow, runState, onNodeClick, showPalette = true }: DagEditorProps) {
  const [tooltip, setTooltip] = useState<{
    id: string
    label: string
    output: NodeOutput | null
    error?: string
    status: NodeStatus
  } | null>(null)

  // Compute layout once per workflow
  const layout = useMemo(() => computeLayout(workflow), [workflow])

  // Build React Flow nodes
  const nodes: DagFlowNode[] = useMemo(() => {
    return workflow.nodes.map((n) => toFlowNode(n, layout.get(n.id) ?? { x: 0, y: 0, width: NODE_W, height: NODE_H_LARGE }, runState))
  }, [workflow, layout, runState])

  // Build React Flow edges
  const edges: Edge[] = useMemo(() => {
    return workflow.edges.map(toFlowEdge)
  }, [workflow])

  // Events
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onNodeClick?.(node.id),
    [onNodeClick],
  )

  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const d = node.data as DagNodeData | undefined
      if (d?.output || d?.error) {
        setTooltip({
          id: node.id,
          label: d.label as string,
          output: (d.output as NodeOutput) ?? null,
          error: d.error as string | undefined,
          status: (d.status as NodeStatus) ?? 'pending',
        })
      }
    },
    [],
  )

  const handleNodeMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        panOnScroll={false}
        zoomOnScroll={true}
        minZoom={0.2}
        maxZoom={2.5}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: 'var(--border)', strokeWidth: 2 },
        }}
      >
        <Background color="var(--border)" gap={20} size={1.5} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const s = (n as DagFlowNode).data?.status
            if (s === 'succeeded') return 'var(--success)'
            if (s === 'running')   return 'var(--accent)'
            if (s === 'failed')    return 'var(--danger)'
            return 'var(--ink-tertiary)'
          }}
          maskColor="var(--bg-app)"
          style={{ border: '1px solid var(--border)' }}
        />
      </ReactFlow>

      {showPalette && <NodePalette />}

      <RunStateOverlay
        runState={runState}
        nodeStatuses={new Map(nodes.map((n) => [n.id, (n.data.status as NodeStatus) ?? 'pending'] as [string, NodeStatus]))}
      />

      {/* Floating tooltip for node output */}
      {tooltip && (
        <div
          className="dag-tooltip"
          style={{ top: 60, right: 160 }}
        >
          <div className="tooltip-title">
            <span className={cn('dag-status-dot', statusDot(tooltip.status))} />
            {`${tooltip.label}${tooltip.error ? ' — Error' : ''}`}
          </div>
          <div className="tooltip-body">
            {tooltip.error ?? tooltip.output?.text ?? '(no output)'}
          </div>
        </div>
      )}
    </div>
  )
}
