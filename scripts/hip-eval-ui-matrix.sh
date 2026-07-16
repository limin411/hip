#!/usr/bin/env bash
# Run full capability matrix packs sequentially, then write byAxis cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
: "${HIP_EVAL_BYTEBASE_PATH:?set HIP_EVAL_BYTEBASE_PATH}"
export E2E_LIVE_LLM=1
export HIP_EVAL_BYTEBASE_PATH
export HIP_EVAL_ROOT="${HIP_EVAL_ROOT:-$HOME/.hip/eval-runs}"

echo "[matrix] pilot fix (baseline)"
yarn test:e2e --spec e2e/specs/eval-bytebase-fix-has-prefixes.spec.ts || true

echo "[matrix] hard"
bash scripts/hip-eval-ui-hard.sh || true

echo "[matrix] orch"
bash scripts/hip-eval-ui-orch.sh || true

echo "[matrix] adv"
bash scripts/hip-eval-ui-adv.sh || true

echo "[matrix] cluster"
node --input-type=module -e "
import { findRunReports, buildAxisCluster, writeAxisCluster } from './e2e/eval/report.ts';
import { evalRoot } from './e2e/eval/workspace.ts';
const reports = findRunReports(process.env.HIP_EVAL_ROOT || evalRoot());
const cluster = buildAxisCluster(reports);
const out = (process.env.HIP_EVAL_ROOT || evalRoot()) + '/cluster-by-axis.json';
writeAxisCluster(out, cluster);
console.log('[matrix] wrote', out, 'axes', Object.keys(cluster.byAxis));
" 2>/dev/null || {
  # fallback: pure node without ts loader — write small js
  node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.HIP_EVAL_ROOT || path.join(require('os').homedir(), '.hip', 'eval-runs');
const reports = [];
if (fs.existsSync(root)) {
  for (const name of fs.readdirSync(root)) {
    const rp = path.join(root, name, 'run-report.json');
    if (fs.existsSync(rp)) reports.push(rp);
  }
}
const byAxis = {};
const byTask = {};
for (const p of reports) {
  try {
    const r = JSON.parse(fs.readFileSync(p, 'utf8'));
    const axes = (r.score && r.score.axes) || ['_unspecified'];
    const passed = !!(r.score && r.score.passed);
    const tags = (r.score && r.score.tags) || [];
    byTask[r.taskId] = { passed, tags, axes };
    for (const axis of axes) {
      if (!byAxis[axis]) byAxis[axis] = { total: 0, passed: 0, failed: 0, tags: {} };
      byAxis[axis].total++;
      if (passed) byAxis[axis].passed++; else byAxis[axis].failed++;
      for (const t of tags) byAxis[axis].tags[t] = (byAxis[axis].tags[t] || 0) + 1;
    }
  } catch {}
}
const out = path.join(root, 'cluster-by-axis.json');
fs.writeFileSync(out, JSON.stringify({ byAxis, byTask, reports }, null, 2));
console.log('[matrix] wrote', out, 'reports', reports.length);
NODE
}
