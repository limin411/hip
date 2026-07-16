import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAxisCluster, writeAxisCluster } from './report.js'
import type { RunReport } from './types.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

function sampleReport(taskId: string, passed: boolean, axes: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-rep-'))
  tmpDirs.push(dir)
  const report: RunReport = {
    schemaVersion: 1,
    runId: 'r1',
    taskId,
    packId: 'p',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    workspace: {
      strategy: 'worktree',
      repoPath: '/x',
      cwd: '/y',
      baseSha: 'abc',
      kept: false,
      primaryGuard: {
        beforePorcelain: '',
        afterPorcelain: '',
        headBefore: 'abc',
        headAfter: 'abc',
        mutated: false,
      },
    },
    ui: {
      settled: true,
      timedOut: false,
      assistantText: '',
      changesPaths: [],
      permissionModalStuck: false,
      awaitingUser: false,
      errorHints: [],
    },
    changes: { dirtyAfter: false, paths: [], fullPatch: '', trackedPatch: '' },
    verify: { ran: true, passed, results: [] },
    score: {
      passed,
      tags: passed ? ['pass'] : ['verify_failed'],
      notes: [],
      verifyPassed: passed,
      axes,
    },
    artifacts: { dir, report: path.join(dir, 'run-report.json') },
  }
  const p = path.join(dir, 'run-report.json')
  fs.writeFileSync(p, JSON.stringify(report))
  return p
}

describe('buildAxisCluster', () => {
  it('aggregates by axis', () => {
    const a = sampleReport('t1', true, ['multi_file'])
    const b = sampleReport('t2', false, ['multi_file', 'edit_single'])
    const c = buildAxisCluster([a, b])
    expect(c.byAxis.multi_file.total).toBe(2)
    expect(c.byAxis.multi_file.passed).toBe(1)
    expect(c.byAxis.edit_single.failed).toBe(1)
    const out = writeAxisCluster(path.join(path.dirname(a), 'cluster.json'), c)
    expect(fs.existsSync(out)).toBe(true)
  })
})
