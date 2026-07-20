import { describe, expect, it } from 'vitest'
import {
  TRANSCRIPT_WINDOW_SIZE,
  growWindowSize,
  transcriptWindowStart,
  windowSizeToInclude,
} from './transcriptWindow'

describe('transcriptWindow', () => {
  it('KD-15 default window is 30', () => {
    expect(TRANSCRIPT_WINDOW_SIZE).toBe(30)
  })

  it('transcriptWindowStart is 0 when total ≤ window', () => {
    expect(transcriptWindowStart(10, 30)).toBe(0)
    expect(transcriptWindowStart(30, 30)).toBe(0)
  })

  it('transcriptWindowStart offsets when total > window', () => {
    expect(transcriptWindowStart(50, 30)).toBe(20)
    expect(transcriptWindowStart(31, 30)).toBe(1)
  })

  it('windowSizeToInclude expands to cover target from end', () => {
    // 50 msgs, jump to index 5 → need at least 45 mounted
    expect(windowSizeToInclude(50, 5)).toBe(45)
    // already within last 30
    expect(windowSizeToInclude(50, 40)).toBe(TRANSCRIPT_WINDOW_SIZE)
    // oldest
    expect(windowSizeToInclude(50, 0)).toBe(50)
  })

  it('windowSizeToInclude ignores out-of-range targets', () => {
    expect(windowSizeToInclude(50, -1)).toBe(TRANSCRIPT_WINDOW_SIZE)
    expect(windowSizeToInclude(50, 50)).toBe(TRANSCRIPT_WINDOW_SIZE)
    expect(windowSizeToInclude(0, 0)).toBe(TRANSCRIPT_WINDOW_SIZE)
  })

  it('growWindowSize steps by N and caps at total', () => {
    expect(growWindowSize(100, 30)).toBe(60)
    expect(growWindowSize(100, 90)).toBe(100)
    expect(growWindowSize(40, 30)).toBe(40)
    expect(growWindowSize(50, 30, 10)).toBe(40)
  })
})
