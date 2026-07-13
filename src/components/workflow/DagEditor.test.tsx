// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import type {
  WorkflowDef,
  RunState,
  NodeStatus,
  WorkflowNode,
} from '@hip/protocol'

// ── Mock @xyflow/react ──
// React Flow renders a canvas; we replace it with a simple DOM-renderable
// component so we can assert node labels and edges.
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodeClick,
    nodeTypes,
    children,
  }: {
    nodes: Array<{ id: string; data: { label: string; status?: NodeStatus }; type: string }>
    edges: Array<{ id: string; source: string; target: string; label?: string }>
    onNodeClick?: (_e: unknown, node: { id: string }) => void
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown>; selected?: boolean }>>
    children?: React.ReactNode
  }) => {
    // Render nodes as divs so we can query them in tests
    const NodeComponent = (node: typeof nodes[number]) => {
      const Comp = nodeTypes?.[node.type]
      const data = { ...node.data, label: node.data.label || node.id }
      if (Comp) {
        return (
          <div key={node.id} data-testid={`node-${node.id}`} onClick={() => onNodeClick?.(null as never, { id: node.id })}>
            <Comp data={data as Record<string, unknown>} />
          </div>
        )
      }
      return (
        <div key={node.id} data-testid={`node-${node.id}`} onClick={() => onNodeClick?.(null as never, { id: node.id })}>
          {node.id}
        </div>
      )
    }
    return React.createElement(
      'div',
      { 'data-testid': 'react-flow', style: { width: 800, height: 600 } },
      ...[
        ...nodes.map(NodeComponent),
        ...edges.map((e) =>
          React.createElement('div', {
            key: e.id,
            'data-testid': `edge-${e.id}`,
          }),
        ),
        children,
      ],
    )
  },
  Background: () => React.createElement('div', { 'data-testid': 'rf-background' }),
  Controls: () => React.createElement('div', { 'data-testid': 'rf-controls' }),
  MiniMap: () => React.createElement('div', { 'data-testid': 'rf-minimap' }),
  Handle: () => React.createElement('div', { 'data-testid': 'rf-handle' }),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

// Mock CSS imports
vi.mock('./DagEditor.css', () => ({ default: {} }))

import {
  DagEditor,
  DAG_PALETTE_NODE_TYPES,
  DAG_DEPRECATED_NODE_TYPES,
  isPaletteNodeType,
} from './DagEditor'
import { RunStateOverlay } from './RunStateOverlay'

// ── Test fixtures ──

function makeAgentNode(id: string, agentId: string, inputTemplate?: string): WorkflowNode {
  return {
    id,
    type: 'agent',
    agentId,
    inputTemplate: inputTemplate ?? 'Do something',
  } as WorkflowNode
}

function makeToolNode(id: string, toolName: string): WorkflowNode {
  return { id, type: 'tool', toolName, inputTemplate: 'Run this tool' } as WorkflowNode
}

function makeGateNode(id: string, gateKind: string): WorkflowNode {
  return { id, type: 'gate', gateKind } as WorkflowNode
}

function makeHumanNode(id: string, question: string): WorkflowNode {
  return { id, type: 'human', question } as WorkflowNode
}

function makeParallelNode(id: string, nodes: WorkflowNode[]): WorkflowNode {
  return { id, type: 'parallel', nodes, mergeStrategy: 'all' } as WorkflowNode
}

const minimalWorkflow: WorkflowDef = {
  id: 'wf-1',
  name: 'Test Workflow',
  nodes: [makeAgentNode('n1', 'coder')],
  edges: [],
  entry: ['n1'],
}

const fullWorkflow: WorkflowDef = {
  id: 'wf-2',
  name: 'Full Workflow',
  nodes: [
    makeAgentNode('start', 'architect', 'Design the system'),
    makeToolNode('tool-1', 'read_file'),
    makeGateNode('gate-1', 'typecheck'),
    makeHumanNode('human-1', 'Approve design?'),
    makeParallelNode('par-1', [
      makeAgentNode('par-a', 'coder-a'),
      makeAgentNode('par-b', 'coder-b'),
    ]),
  ],
  edges: [
    { from: 'start', to: 'tool-1' },
    { from: 'tool-1', to: 'gate-1' },
    { from: 'gate-1', to: 'human-1' },
    { from: 'human-1', to: 'par-1' },
  ],
  entry: ['start'],
}

const emptyWorkflow: WorkflowDef = {
  id: 'wf-empty',
  name: 'Empty Workflow',
  nodes: [],
  edges: [],
  entry: [],
}

function makeRunState(
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled',
  nodeStatuses: Record<string, NodeStatus>,
): RunState {
  return {
    runId: status === 'running' ? 'run-abc1234567890' : 'run-xyz',
    workflowId: 'wf-1',
    status,
    nodes: Object.fromEntries(
      Object.entries(nodeStatuses).map(([id, s]) => [id, { status: s }]),
    ),
  }
}

// ── Tests ──

describe('DagEditor', () => {
  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders without crashing for a minimal workflow', () => {
    render(<DagEditor workflow={minimalWorkflow} />)
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
  })

  it('renders node for each workflow node', () => {
    render(<DagEditor workflow={minimalWorkflow} />)
    // Our mock renders each node with data-testid="node-{id}"
    expect(screen.getByTestId('node-n1')).toBeInTheDocument()
  })

  it('renders edges between nodes', () => {
    const wf: WorkflowDef = {
      id: 'wf-edges',
      name: 'Edges',
      nodes: [makeAgentNode('a', 'agent-a'), makeToolNode('b', 'some-tool')],
      edges: [{ from: 'a', to: 'b' }],
      entry: ['a'],
    }
    render(<DagEditor workflow={wf} />)
    expect(screen.getByTestId('edge-a->b')).toBeInTheDocument()
  })

  it('renders all node types (agent, tool, gate, human, parallel)', () => {
    render(<DagEditor workflow={fullWorkflow} />)
    // Each node should be rendered by our mock
    expect(screen.getByTestId('node-start')).toBeInTheDocument()
    expect(screen.getByTestId('node-tool-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-gate-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-human-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-par-1')).toBeInTheDocument()
  })

  it('renders empty workflow without crashing', () => {
    render(<DagEditor workflow={emptyWorkflow} />)
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.queryByTestId(/^node-/)).toBeNull()
  })

  it('shows RunStateOverlay when runState is provided', () => {
    const runState = makeRunState('running', { n1: 'running' })
    render(<DagEditor workflow={minimalWorkflow} runState={runState} />)
    expect(screen.getByTestId('runstate-overlay')).toBeInTheDocument()
  })

  it('hides RunStateOverlay when runState is undefined', () => {
    render(<DagEditor workflow={minimalWorkflow} />)
    expect(screen.queryByTestId('runstate-overlay')).toBeNull()
  })

  it('calls onNodeClick when a node is clicked', () => {
    const onClick = vi.fn()
    render(<DagEditor workflow={minimalWorkflow} onNodeClick={onClick} />)
    fireEvent.click(screen.getByTestId('node-n1'))
    expect(onClick).toHaveBeenCalledWith('n1')
  })

  it('renders React Flow sub-components (Background, Controls, MiniMap)', () => {
    render(<DagEditor workflow={minimalWorkflow} />)
    expect(screen.getByTestId('rf-background')).toBeInTheDocument()
    expect(screen.getByTestId('rf-controls')).toBeInTheDocument()
    expect(screen.getByTestId('rf-minimap')).toBeInTheDocument()
  })

  it('palette offers only agent, gate, parallel (no tool/human)', () => {
    render(<DagEditor workflow={minimalWorkflow} />)
    expect(screen.getByTestId('dag-node-palette')).toBeInTheDocument()
    for (const type of DAG_PALETTE_NODE_TYPES) {
      const item = screen.getByTestId(`dag-palette-${type}`)
      expect(item).toBeInTheDocument()
      expect(item).toHaveAttribute('data-enabled', 'true')
      expect(item).toHaveAttribute('data-node-type', type)
    }
    expect(screen.queryByTestId('dag-palette-tool')).toBeNull()
    expect(screen.queryByTestId('dag-palette-human')).toBeNull()
  })

  it('hides palette when showPalette is false', () => {
    render(<DagEditor workflow={minimalWorkflow} showPalette={false} />)
    expect(screen.queryByTestId('dag-node-palette')).toBeNull()
  })

  it('still projects legacy tool/human nodes even though they are not in the palette', () => {
    render(<DagEditor workflow={fullWorkflow} />)
    expect(screen.getByTestId('node-tool-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-human-1')).toBeInTheDocument()
    // Palette must still exclude them
    expect(screen.queryByTestId('dag-palette-tool')).toBeNull()
    expect(screen.queryByTestId('dag-palette-human')).toBeNull()
  })
})

describe('DAG palette type guards', () => {
  it('DAG_PALETTE_NODE_TYPES is agent/gate/parallel only', () => {
    expect([...DAG_PALETTE_NODE_TYPES]).toEqual(['agent', 'gate', 'parallel'])
  })

  it('DAG_DEPRECATED_NODE_TYPES is tool/human', () => {
    expect([...DAG_DEPRECATED_NODE_TYPES]).toEqual(['tool', 'human'])
  })

  it('isPaletteNodeType accepts authorable types and rejects deprecated ones', () => {
    expect(isPaletteNodeType('agent')).toBe(true)
    expect(isPaletteNodeType('gate')).toBe(true)
    expect(isPaletteNodeType('parallel')).toBe(true)
    expect(isPaletteNodeType('tool')).toBe(false)
    expect(isPaletteNodeType('human')).toBe(false)
  })
})

describe('RunStateOverlay', () => {
  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('returns null when runState is undefined', () => {
    const { container } = render(<RunStateOverlay />)
    expect(container.innerHTML).toBe('')
  })

  it('shows "Workflow Running…" when status is running', () => {
    const runState = makeRunState('running', {})
    render(<RunStateOverlay runState={runState} />)
    expect(screen.getByText('Workflow Running…')).toBeInTheDocument()
  })

  it('shows "Workflow Complete" when status is succeeded', () => {
    const runState = makeRunState('succeeded', {})
    render(<RunStateOverlay runState={runState} />)
    expect(screen.getByText('Workflow Complete')).toBeInTheDocument()
  })

  it('shows "Workflow Failed" when status is failed', () => {
    const runState = makeRunState('failed', {})
    render(<RunStateOverlay runState={runState} />)
    expect(screen.getByText('Workflow Failed')).toBeInTheDocument()
  })

  it('shows "Workflow Cancelled" when status is cancelled', () => {
    const runState = makeRunState('cancelled', {})
    render(<RunStateOverlay runState={runState} />)
    expect(screen.getByText('Workflow Cancelled')).toBeInTheDocument()
  })

  it('displays status counts from nodeStatuses', () => {
    const runState = makeRunState('running', {})
    const nodeStatuses = new Map<string, NodeStatus>([
      ['a', 'running'],
      ['b', 'succeeded'],
      ['c', 'succeeded'],
      ['d', 'failed'],
      ['e', 'skipped'],
      ['f', 'pending'],
    ])
    render(<RunStateOverlay runState={runState} nodeStatuses={nodeStatuses} />)
    // The overlay renders status counts. Query within the overlay to avoid
    // conflicting with the runId span which also contains digits.
    const overlay = screen.getByTestId('runstate-overlay')
    const countElements = overlay.querySelectorAll('.count')
    const counts = Array.from(countElements).map((el) => el.textContent)
    // running=1, succeeded=2, failed=1, skipped=1, pending=1
    expect(counts).toContain('1')
    expect(counts).toContain('2')
  })

  it('shows truncated runId when status is running', () => {
    const runState = makeRunState('running', {})
    render(<RunStateOverlay runState={runState} />)
    // runId is 'run-abc1234567890', truncated to first 8 chars: 'run-abc1'
    expect(screen.getByText('run-abc1')).toBeInTheDocument()
  })

  it('does not show runId when status is not running', () => {
    const runState = makeRunState('succeeded', {})
    render(<RunStateOverlay runState={runState} />)
    expect(screen.queryByText('run-xyz')).toBeNull()
  })

  it('renders legend with all 5 standard statuses', () => {
    const runState = makeRunState('running', {})
    render(<RunStateOverlay runState={runState} />)
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })
})
