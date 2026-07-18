/**
 * Live eval: fix TruncateRunes on a local Forgejo checkout (worktree isolation).
 */
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const FORGEJO = process.env.HIP_EVAL_FORGEJO_PATH

;(LIVE && FORGEJO ? describe : describe.skip)(
  'eval forgejo fix TruncateRunes @live @eval @forgejo',
  function (this: Mocha.Suite) {
    this.timeout(1_500_000)

    it('fj-util-fix-truncate-runes', async () => {
      const packDir = path.resolve('e2e/eval/tasks/forgejo')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'fj-util-fix-truncate-runes')!
      checkPatchApplies(
        FORGEJO!,
        task.workspace.base_sha ?? 'HEAD',
        path.join(packDir, 'fixtures/break-truncate-runes.patch'),
      )
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-forgejo] truncate', score.tags, score.passed, report.artifacts.report)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.tags).not.toContain('primary_tree_mutated')
      expect(score.tags).not.toContain('permission_stuck')
      expect(score.passed).toBe(true)
    })
  },
)
