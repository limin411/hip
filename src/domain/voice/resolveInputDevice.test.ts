// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveInputDevice } from './resolveInputDevice'

const devices = [
  { id: 'a', label: 'Built-in Microphone', groupId: 'g1' },
  { id: 'b', label: 'USB Headset', groupId: 'g2' },
]

describe('resolveInputDevice', () => {
  it('returns default when preferred is default', () => {
    expect(resolveInputDevice({ id: 'default' }, devices)).toEqual({
      deviceId: 'default',
      matched: 'default',
      stale: false,
    })
  })

  it('matches by id', () => {
    expect(resolveInputDevice({ id: 'b' }, devices).matched).toBe('id')
  })

  it('rebinds by groupId', () => {
    const r = resolveInputDevice({ id: 'old', groupId: 'g2', label: 'x' }, devices)
    expect(r).toEqual({ deviceId: 'b', matched: 'groupId', stale: true })
  })

  it('rebinds by label', () => {
    const r = resolveInputDevice({ id: 'old', label: 'USB Headset' }, devices)
    expect(r.deviceId).toBe('b')
    expect(r.matched).toBe('label')
    expect(r.stale).toBe(true)
  })

  it('falls back to default when nothing matches', () => {
    const r = resolveInputDevice({ id: 'gone', label: 'Nope' }, devices)
    expect(r).toEqual({ deviceId: 'default', matched: 'default', stale: true })
  })

  it('keeps preferred id when device list is empty (pre-enumerate / restart)', () => {
    const r = resolveInputDevice(
      { id: 'saved-id', label: 'USB Headset', groupId: 'g2' },
      [],
    )
    expect(r).toEqual({ deviceId: 'saved-id', matched: 'id', stale: false })
  })
})
