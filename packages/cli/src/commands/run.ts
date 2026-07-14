import type { HipRunOptions } from '../types.js'
import { runHip, exitCodeOf } from '../run.js'

export async function runCommand(opts: HipRunOptions): Promise<number> {
  const result = await runHip(opts)
  return exitCodeOf(result)
}
