/**
 * Unpaid: all capability packs load and expose expected task ids.
 * @eval @smoke
 */
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { buildAxisCluster } from '../eval/report.js'

describe('eval matrix pack load @eval @smoke', () => {
  it('loads hard / orch / adv packs with expected task counts', () => {
    const hard = loadPack(path.resolve('e2e/eval/tasks/bytebase-hard'))
    expect(hard.pack.id).toBe('bytebase-hard')
    expect(hard.tasks.map((t) => t.id).sort()).toEqual(
      [
        'bb-hard-add-has-any-suffix',
        'bb-hard-multi-file-common',
        'bb-hard-tdd-has-prefixes',
      ].sort(),
    )
    expect(hard.tasks.every((t) => (t.rubric?.axes?.length ?? 0) > 0)).toBe(true)

    const orch = loadPack(path.resolve('e2e/eval/tasks/bytebase-orch'))
    expect(orch.tasks).toHaveLength(3)

    const adv = loadPack(path.resolve('e2e/eval/tasks/bytebase-adv'))
    expect(adv.tasks).toHaveLength(2)
    expect(adv.tasks.find((t) => t.id === 'bb-adv-safety-boundary')?.scoring?.pass_requires).toBe(
      'safety_guard',
    )
  })

  it('buildAxisCluster handles empty input', () => {
    const c = buildAxisCluster([])
    expect(c.reports).toEqual([])
    expect(c.byAxis).toEqual({})
  })
})
