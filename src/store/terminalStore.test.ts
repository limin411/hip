import { describe, it, expect, beforeEach } from 'vitest'
import {
  useTerminalStore,
  attachDrainWrites,
  MAX_RING_CHUNKS,
  MAX_RING_BYTES,
} from './terminalStore'

beforeEach(() => {
  useTerminalStore.setState({ bySession: {}, attachedSessionId: null, attachedTerminalId: null })
})

describe('attachDrainWrites (D6a)', () => {
  it('rehydrates snapshot then drains mid-append tail without drop or dup', () => {
    const ring = ['a', 'b']
    const snapshot = ring.length
    // Mid-attach appends (what appendRing would do while rehydrating):
    ring.push('c', 'd')
    const { writes, cursor } = attachDrainWrites(ring, snapshot)
    expect(writes).toEqual(['a', 'b', 'c', 'd'])
    expect(writes.join('')).toBe('abcd')
    expect(cursor).toBe(4)
    // No duplicates
    expect(writes).toEqual([...new Set(writes)])
  })

  it('handles empty ring', () => {
    const { writes, cursor } = attachDrainWrites([], 0)
    expect(writes).toEqual([])
    expect(cursor).toBe(0)
  })

  it('clamps snapshot beyond length', () => {
    const { writes, cursor } = attachDrainWrites(['x'], 99)
    expect(writes).toEqual(['x'])
    expect(cursor).toBe(1)
  })
})

describe('terminalStore ring', () => {
  it('appendRing grows ring and marks running', () => {
    useTerminalStore.getState().appendRing('s1', 'hello')
    const s = useTerminalStore.getState().bySession.s1
    expect(s.ring).toEqual(['hello'])
    expect(s.ringBytes).toBe(5)
    expect(s.status).toBe('running')
  })

  it('attach mid-append: snapshot + drain matches full ring (no drop/dup)', () => {
    const store = useTerminalStore.getState()
    store.appendRing('s1', 'a')
    store.appendRing('s1', 'b')
    const snapshot = store.getRing('s1').length
    store.setAttached('s1')
    store.appendRing('s1', 'c') // during rehydrate
    const ring = useTerminalStore.getState().getRing('s1')
    const { writes, cursor } = attachDrainWrites(ring, snapshot)
    expect(writes.join('')).toBe('abc')
    expect(cursor).toBe(3)
    // Live path after attach would write only cursor.. — here cursor covers all.
  })

  it('setExit marks exited with code', () => {
    useTerminalStore.getState().appendRing('s1', 'x')
    useTerminalStore.getState().setExit('s1', 0)
    expect(useTerminalStore.getState().bySession.s1.status).toBe('exited')
    expect(useTerminalStore.getState().bySession.s1.exitCode).toBe(0)
  })

  it('setExit does not resurrect a cleared session', () => {
    useTerminalStore.getState().appendRing('s1', 'x')
    useTerminalStore.getState().clearSession('s1')
    useTerminalStore.getState().setExit('s1', 1, 9)
    expect(useTerminalStore.getState().bySession.s1).toBeUndefined()
  })

  it('setExit ignores stale generation after restart', () => {
    useTerminalStore.getState().ensureSession('s1')
    useTerminalStore.getState().setGeneration('s1', 5)
    useTerminalStore.getState().setStatus('s1', 'running')
    useTerminalStore.getState().setExit('s1', 0, 4) // old gen
    expect(useTerminalStore.getState().bySession.s1.status).toBe('running')
    useTerminalStore.getState().setExit('s1', 0, 5)
    expect(useTerminalStore.getState().bySession.s1.status).toBe('exited')
  })

  it('trim advances trimOffset so cursors can resync', () => {
    for (let i = 0; i < MAX_RING_CHUNKS + 3; i++) {
      useTerminalStore.getState().appendRing('s1', `c${i}`)
    }
    const s = useTerminalStore.getState().bySession.s1
    expect(s.trimOffset).toBeGreaterThan(0)
    expect(s.ring.length).toBeLessThanOrEqual(MAX_RING_CHUNKS)
  })

  it('clearSession removes ring and clears attach', () => {
    useTerminalStore.getState().appendRing('s1', 'x')
    useTerminalStore.getState().setAttached('s1')
    useTerminalStore.getState().clearSession('s1')
    expect(useTerminalStore.getState().bySession.s1).toBeUndefined()
    expect(useTerminalStore.getState().attachedSessionId).toBeNull()
    expect(useTerminalStore.getState().attachedTerminalId).toBeNull()
  })

  it('setAttached dual-writes attachedTerminalId alias', () => {
    useTerminalStore.getState().setAttached('s1')
    const st = useTerminalStore.getState()
    expect(st.attachedSessionId).toBe('s1')
    expect(st.attachedTerminalId).toBe('s1')
    useTerminalStore.getState().setAttached(null)
    expect(useTerminalStore.getState().attachedSessionId).toBeNull()
    expect(useTerminalStore.getState().attachedTerminalId).toBeNull()
  })

  it('trims ring by chunk count', () => {
    for (let i = 0; i < MAX_RING_CHUNKS + 10; i++) {
      useTerminalStore.getState().appendRing('s1', `c${i}`)
    }
    const s = useTerminalStore.getState().bySession.s1
    expect(s.ring.length).toBeLessThanOrEqual(MAX_RING_CHUNKS)
  })

  it('trims ring by byte budget', () => {
    const big = 'x'.repeat(100_000)
    const n = Math.ceil(MAX_RING_BYTES / big.length) + 5
    for (let i = 0; i < n; i++) {
      useTerminalStore.getState().appendRing('s1', big)
    }
    const s = useTerminalStore.getState().bySession.s1
    expect(s.ringBytes).toBeLessThanOrEqual(MAX_RING_BYTES)
    expect(s.ring.length).toBeGreaterThan(0)
  })
})
