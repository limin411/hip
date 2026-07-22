import { describe, it, expect } from 'vitest'
import {
  TRANSCRIPT_INTERLEAVED_BLOCKS,
  TRANSCRIPT_VIRTUALIZE,
  TRANSCRIPT_ROW_GAP_PX,
  TRANSCRIPT_ROW_ESTIMATE_PX,
} from './feature'

describe('chat feature flags (Phase 5 product defaults)', () => {
  it('enables interleaved TurnBlocks by default', () => {
    expect(TRANSCRIPT_INTERLEAVED_BLOCKS).toBe(true)
  })

  it('enables transcript virtualization by default', () => {
    expect(TRANSCRIPT_VIRTUALIZE).toBe(true)
  })

  it('keeps row geometry constants', () => {
    expect(TRANSCRIPT_ROW_GAP_PX).toBe(20)
    expect(TRANSCRIPT_ROW_ESTIMATE_PX).toBe(120)
  })
})
