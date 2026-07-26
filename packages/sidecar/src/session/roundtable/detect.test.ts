import { describe, it, expect, afterEach } from 'vitest'
import {
  isRoundtableMessage,
  stripRoundtableFrame,
  shouldEnterRoundtableLoop,
} from './detect.js'
import { ROUNDTABLE_MARKER, ROUNDTABLE_SEP } from './constants.js'

describe('roundtable detect', () => {
  const prev = process.env.HIP_ROUNDTABLE_ENGINE
  afterEach(() => {
    if (prev === undefined) delete process.env.HIP_ROUNDTABLE_ENGINE
    else process.env.HIP_ROUNDTABLE_ENGINE = prev
  })

  it('strips frame to user issue', () => {
    const wire = `${ROUNDTABLE_MARKER}\nframe here${ROUNDTABLE_SEP}My real question`
    expect(isRoundtableMessage(wire)).toBe(true)
    expect(stripRoundtableFrame(wire)).toBe('My real question')
  })

  it('shouldEnterRoundtableLoop respects engine', () => {
    const wire = `${ROUNDTABLE_MARKER}\nx${ROUNDTABLE_SEP}q`
    process.env.HIP_ROUNDTABLE_ENGINE = 'loop'
    expect(shouldEnterRoundtableLoop(wire)).toBe(true)
    process.env.HIP_ROUNDTABLE_ENGINE = 'sim'
    expect(shouldEnterRoundtableLoop(wire)).toBe(false)
    expect(shouldEnterRoundtableLoop('plain')).toBe(false)
  })
})
