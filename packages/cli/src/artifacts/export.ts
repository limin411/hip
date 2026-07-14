import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HipRunResult } from '../types.js'
import { redactSecrets } from './redact.js'

export interface TraceEvent {
  ts: string
  type: string
  payload?: unknown
}

export interface ExportArtifactsOpts {
  outDir: string
  result: HipRunResult
  trace?: TraceEvent[]
  /** When true, do not redact (default false). */
  traceRaw?: boolean
}

export function exportArtifacts(opts: ExportArtifactsOpts): NonNullable<HipRunResult['artifacts']> {
  const { outDir } = opts
  mkdirSync(outDir, { recursive: true })

  const resultPath = join(outDir, 'result.json')
  writeFileSync(resultPath, JSON.stringify(opts.result) + '\n', 'utf8')

  const artifacts: NonNullable<HipRunResult['artifacts']> = {
    dir: outDir,
    result: resultPath,
  }

  if (opts.trace?.length) {
    const lines = opts.trace.map((e) => {
      const line = JSON.stringify(e)
      return opts.traceRaw ? line : redactSecrets(line)
    })
    const tracePath = join(outDir, 'trace.jsonl')
    writeFileSync(tracePath, lines.join('\n') + '\n', 'utf8')
    artifacts.trace = tracePath
  }

  if (opts.result.usage) {
    const usagePath = join(outDir, 'usage.json')
    writeFileSync(usagePath, JSON.stringify(opts.result.usage) + '\n', 'utf8')
    artifacts.usage = usagePath
  }

  const patchPath = join(outDir, 'patch.diff')
  if (existsSync(patchPath)) artifacts.patch = patchPath

  return artifacts
}
