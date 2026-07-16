import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AxisCluster, RunReport } from './types.js'
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

/** Aggregate run-report.json files into by-axis / by-task cluster. */
export function buildAxisCluster(reportPaths: string[]): AxisCluster {
  const byAxis: AxisCluster['byAxis'] = {}
  const byTask: AxisCluster['byTask'] = {}
  const reports: string[] = []

  for (const p of reportPaths) {
    if (!fs.existsSync(p)) continue
    let report: RunReport
    try {
      report = JSON.parse(fs.readFileSync(p, 'utf8')) as RunReport
    } catch {
      continue
    }
    reports.push(p)
    const axes = report.score.axes ?? []
    const passed = report.score.passed
    const tags = report.score.tags ?? []
    byTask[report.taskId] = { passed, tags, axes }

    for (const axis of axes.length ? axes : ['_unspecified']) {
      if (!byAxis[axis]) {
        byAxis[axis] = { total: 0, passed: 0, failed: 0, tags: {} }
      }
      byAxis[axis].total += 1
      if (passed) byAxis[axis].passed += 1
      else byAxis[axis].failed += 1
      for (const t of tags) {
        byAxis[axis].tags[t] = (byAxis[axis].tags[t] ?? 0) + 1
      }
    }
  }

  return { byAxis, byTask, reports }
}

export function writeAxisCluster(outPath: string, cluster: AxisCluster): string {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(cluster, null, 2))
  return outPath
}

/** Discover run-report.json under HIP_EVAL_ROOT (shallow + one level). */
export function findRunReports(root = evalRoot()): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name)
    try {
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        const rp = path.join(p, 'run-report.json')
        if (fs.existsSync(rp)) out.push(rp)
      } else if (name === 'run-report.json') {
        out.push(p)
      }
    } catch {
      // skip
    }
  }
  return out.sort()
}
