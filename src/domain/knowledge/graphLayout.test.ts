import { describe, expect, it } from 'vitest'
import {
  layoutGraph,
  neighborhoodSubgraph,
} from './graphLayout'

const nodes = [
  { id: 'a', title: 'A' },
  { id: 'b', title: 'B' },
  { id: 'c', title: 'C' },
  { id: 'd', title: 'D' },
]
const edges = [
  { from: 'a', to: 'b', kind: 'wiki' },
  { from: 'b', to: 'c', kind: 'wiki' },
  { from: 'a', to: 'd', kind: 'embed' },
]

describe('neighborhoodSubgraph', () => {
  it('keeps focus and 1-hop neighbors', () => {
    const sub = neighborhoodSubgraph('a', nodes, edges)
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'd'])
    expect(sub.edges).toHaveLength(2)
  })
})

describe('layoutGraph', () => {
  it('places focus at origin', () => {
    const { nodes: laid } = layoutGraph(nodes, edges, 'a')
    const focus = laid.find((n) => n.id === 'a')
    expect(focus?.x).toBe(0)
    expect(focus?.y).toBe(0)
  })

  it('assigns unique edge ids', () => {
    const { edges: e } = layoutGraph(nodes, edges, 'a')
    const ids = e.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
