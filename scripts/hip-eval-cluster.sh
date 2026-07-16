#!/usr/bin/env bash
# Aggregate HIP_EVAL_ROOT run-report.json files into by-axis cluster JSON.
# No live LLM. Safe after any eval reports exist.
set -euo pipefail
export HIP_EVAL_ROOT="${HIP_EVAL_ROOT:-$HOME/.hip/eval-runs}"
export HIP_EVAL_CLUSTER_OUT="${HIP_EVAL_CLUSTER_OUT:-$HIP_EVAL_ROOT/cluster-by-axis.json}"

node <<'NODE'
const fs = require('fs')
const path = require('path')
const os = require('os')

const root = process.env.HIP_EVAL_ROOT || path.join(os.homedir(), '.hip', 'eval-runs')
const out = process.env.HIP_EVAL_CLUSTER_OUT || path.join(root, 'cluster-by-axis.json')

const reports = []
if (fs.existsSync(root)) {
  for (const name of fs.readdirSync(root)) {
    const rp = path.join(root, name, 'run-report.json')
    if (fs.existsSync(rp)) reports.push(rp)
  }
}
reports.sort()

const byAxis = {}
const latestByTask = {}

for (const p of reports) {
  try {
    const r = JSON.parse(fs.readFileSync(p, 'utf8'))
    const taskId = r.taskId || path.basename(path.dirname(p))
    const axes = (r.score && r.score.axes) || ['_unspecified']
    const passed = !!(r.score && r.score.passed)
    const tags = (r.score && r.score.tags) || []
    const finished = r.finishedAt || ''

    if (!latestByTask[taskId] || finished > (latestByTask[taskId].finishedAt || '')) {
      latestByTask[taskId] = { passed, tags, axes, finishedAt: finished, report: p }
    }

    for (const axis of axes) {
      if (!byAxis[axis]) byAxis[axis] = { total: 0, passed: 0, failed: 0, tags: {} }
      byAxis[axis].total++
      if (passed) byAxis[axis].passed++
      else byAxis[axis].failed++
      for (const t of tags) {
        byAxis[axis].tags[t] = (byAxis[axis].tags[t] || 0) + 1
      }
    }
  } catch (e) {
    console.warn('[cluster] skip', p, e.message)
  }
}

const byTask = {}
for (const [taskId, v] of Object.entries(latestByTask)) {
  byTask[taskId] = { passed: v.passed, tags: v.tags, axes: v.axes, report: v.report }
}

const cluster = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evalRoot: root,
  reportCount: reports.length,
  byAxis,
  byTask,
  reports,
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(cluster, null, 2))
console.log('[cluster] wrote', out)
console.log('[cluster] reports', reports.length, 'tasks', Object.keys(byTask).length)
console.log('[cluster] axes', Object.keys(byAxis).join(', ') || '(none)')
for (const [axis, s] of Object.entries(byAxis)) {
  const rate = s.total ? ((100 * s.passed) / s.total).toFixed(0) : '0'
  console.log('  ', `${axis}: ${s.passed}/${s.total} (${rate}%)`)
}
NODE
