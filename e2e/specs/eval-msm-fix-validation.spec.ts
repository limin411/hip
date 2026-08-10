import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const MSM = process.env.HIP_EVAL_MSM_PATH

;(LIVE && MSM ? describe : describe.skip)(
  'eval msm fix validation @live @eval @msm',
  function (this: Mocha.Suite) {
    this.timeout(1_200_000)

    it('msm-fix-validation', async () => {
      const packDir = path.resolve('e2e/eval/tasks/make-stock-money')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'msm-fix-validation')!
      checkPatchApplies(
        MSM!,
        task.workspace.base_sha ?? 'HEAD',
        path.join(packDir, 'fixtures/break-validation.patch'),
      )
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-msm] validation', score.tags, score.passed, report.artifacts.report)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.passed).toBe(true)
    })
  },
)
