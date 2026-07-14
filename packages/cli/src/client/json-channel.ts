import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HipRunResult } from '../types.js'

/**
 * Emit HipRunResult per Harness ABI §A.
 * - --output PATH: write file only
 * - --json without --output: last line of stdout
 * - neither: no JSON
 */
export function emitResultJson(
  result: HipRunResult,
  opts: { json?: boolean; output?: string },
): void {
  if (!opts.json && !opts.output) return
  const line = JSON.stringify(result)
  if (opts.output) {
    mkdirSync(dirname(opts.output), { recursive: true })
    writeFileSync(opts.output, line + '\n', 'utf8')
    return
  }
  if (opts.json) {
    process.stdout.write(line + '\n')
  }
}

/** Whether human stream must go to stderr (when --json without --output). */
export function streamToStderr(opts: { json?: boolean; output?: string }): boolean {
  return Boolean(opts.json && !opts.output)
}
