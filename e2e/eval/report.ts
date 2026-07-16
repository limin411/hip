import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RunReport } from './types.js'
import { evalRoot } from './workspace.js'

export function reportDir(runId: string): string {
  return path.join(evalRoot(), runId)
}

export function writeRunReport(report: RunReport): string {
  const dir = report.artifacts.dir || reportDir(report.runId)
  fs.mkdirSync(dir, { recursive: true })
  const reportPath = path.join(dir, 'run-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  return reportPath
}

export function writeTextArtifact(runId: string, name: string, content: string): string {
  const dir = reportDir(runId)
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}
