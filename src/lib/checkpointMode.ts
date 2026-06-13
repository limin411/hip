import type { Checkpoint, CheckpointMode } from '@hip/protocol'

/** Which diff modes a checkpoint offers. The session-start checkpoint (#0) has no previous turn,
 *  so it omits 'this-turn'. */
export function checkpointModeOptions(cp: Checkpoint): CheckpointMode[] {
  return cp.kind === 'start'
    ? ['since-then', 'since-start']
    : ['this-turn', 'since-then', 'since-start']
}
