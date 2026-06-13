import { describe, it, expect } from 'vitest'
import type { Checkpoint } from '@hip/protocol'
import { checkpointModeOptions } from './checkpointMode'

const turnCp: Checkpoint = { id: 's:1', sessionId: 's', turnId: '1', kind: 'turn', label: 'x', treeSha: 't', commitSha: 'c', branch: 'main', createdAt: 1 }
const startCp: Checkpoint = { ...turnCp, id: 's:start', turnId: null, kind: 'start', label: null }

describe('checkpointModeOptions', () => {
  it('offers all three modes for a turn checkpoint', () => {
    expect(checkpointModeOptions(turnCp)).toEqual(['this-turn', 'since-then', 'since-start'])
  })
  it('omits this-turn for the session-start checkpoint (#0 has no previous turn)', () => {
    expect(checkpointModeOptions(startCp)).toEqual(['since-then', 'since-start'])
  })
})
