import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { LaidOutEdge, LaidOutNode } from '@/domain/knowledge/graphLayout'
import { cn } from '@/lib/utils'

type KbNodeData = {
  title: string
  focused: boolean
  onOpen: () => void
}

function KbGraphNode({ data }: NodeProps) {
  const d = data as KbNodeData
  return (
    <div
      className={cn(
        'min-w-[100px] max-w-[160px] rounded-md border px-2 py-1.5 text-center text-meta',
        d.focused
          ? 'border-accent bg-accent/15 font-medium text-ink'
          : 'border-border bg-surface text-ink hover:border-accent/60',
      )}
      data-testid="knowledge-graph-node"
      onClick={(e) => {
        e.stopPropagation()
        d.onOpen()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          d.onOpen()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-border" />
      <span className="line-clamp-2 break-words">{d.title}</span>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-border" />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  kb: KbGraphNode,
}

export interface KnowledgeGraphCanvasProps {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  focusDocId: string | null
  onOpenDoc: (docId: string) => void
}

export function KnowledgeGraphCanvas({
  nodes,
  edges,
  focusDocId,
  onOpenDoc,
}: KnowledgeGraphCanvasProps) {
  const { t } = useTranslation()
  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'kb',
        position: { x: n.x, y: n.y },
        data: {
          title: n.title,
          focused: n.id === focusDocId,
          onOpen: () => onOpenDoc(n.id),
        } satisfies KbNodeData,
        // Center the node box roughly on layout point
        style: { width: 140 },
      })),
    [nodes, focusDocId, onOpenDoc],
  )

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.kind === 'embed' ? t('knowledge.graph.edgeEmbed') : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: {
          stroke: e.kind === 'embed' ? 'var(--color-warning, #ca8a04)' : 'var(--color-border, #888)',
        },
        animated: e.kind === 'embed',
      })),
    [edges, t],
  )

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      onOpenDoc(node.id)
    },
    [onOpenDoc],
  )

  return (
    <div className="h-full w-full" data-testid="knowledge-graph-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-surface" />
      </ReactFlow>
    </div>
  )
}
