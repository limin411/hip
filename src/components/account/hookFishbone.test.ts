import { describe, it, expect } from 'vitest'
import { buildHookFishboneGraph, FISHBONE_EVENT_IDS } from './hookFishbone'
import { HOOK_EVENT_CATALOG } from './hookCatalog'

describe('buildHookFishboneGraph', () => {
  it('includes every catalog event as a rib node', () => {
    const { nodes } = buildHookFishboneGraph({
      configuredEvents: new Set(),
      sourcesByEvent: new Map(),
      expandedEvent: null,
    })
    for (const event of FISHBONE_EVENT_IDS) {
      expect(nodes.some((n) => n.id === `event-${event}`)).toBe(true)
    }
    expect(FISHBONE_EVENT_IDS).toHaveLength(HOOK_EVENT_CATALOG.length)
  })

  it('marks configured and expanded event data', () => {
    const { nodes } = buildHookFishboneGraph({
      configuredEvents: new Set(['PreToolUse']),
      sourcesByEvent: new Map([
        [
          'PreToolUse',
          [{ pluginId: 'g', name: 'Guard', dir: '/p/g', hookCount: 1 }],
        ],
      ]),
      expandedEvent: 'PreToolUse',
    })
    const pre = nodes.find((n) => n.id === 'event-PreToolUse')
    expect(pre?.data.configured).toBe(true)
    expect(pre?.data.expanded).toBe(true)
    expect(pre?.data.sourceCount).toBe(1)

    const stop = nodes.find((n) => n.id === 'event-Stop')
    expect(stop?.data.configured).toBe(false)
    expect(stop?.data.expanded).toBe(false)
  })

  it('builds a spine chain and rib edges', () => {
    const { edges } = buildHookFishboneGraph({
      configuredEvents: new Set(),
      sourcesByEvent: new Map(),
      expandedEvent: null,
    })
    expect(edges.some((e) => e.id.startsWith('spine-'))).toBe(true)
    expect(edges.some((e) => e.id === 'rib-j-tool-PreToolUse')).toBe(true)
  })

  it('lays out vertically: head above joints, ribs left/right of spine', () => {
    const { nodes, edges } = buildHookFishboneGraph({
      configuredEvents: new Set(),
      sourcesByEvent: new Map(),
      expandedEvent: null,
    })
    const head = nodes.find((n) => n.id === 'head')!
    const session = nodes.find((n) => n.id === 'j-session')!
    const tool = nodes.find((n) => n.id === 'j-tool')!
    const tail = nodes.find((n) => n.id === 'tail')!
    expect(head.position.y).toBeLessThan(session.position.y)
    expect(session.position.y).toBeLessThan(tool.position.y)
    expect(tool.position.y).toBeLessThan(tail.position.y)

    const pre = nodes.find((n) => n.id === 'event-PreToolUse')!
    const perm = nodes.find((n) => n.id === 'event-PermissionRequest')!
    // PreToolUse left of spine; PermissionRequest right of spine
    expect(pre.position.x).toBeLessThan(tool.position.x)
    expect(perm.position.x).toBeGreaterThan(tool.position.x)

    const rib = edges.find((e) => e.id === 'rib-j-tool-PreToolUse')!
    expect(rib.sourceHandle).toBe('rib-left')
    expect(rib.targetHandle).toBe('from-spine-right')
  })
})

