import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const MSM = process.env.HIP_EVAL_MSM_PATH

;(LIVE && MSM ? describe : describe.skip)(
  'eval msm longrun watchlist @live @eval @msm @longrun',
  function (this: Mocha.Suite) {
    this.timeout(3_600_000)

    it('msm-longrun-watchlist', async () => {
      const packDir = path.resolve('e2e/eval/tasks/make-stock-money')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'msm-longrun-watchlist')!
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-msm] longrun', score.tags, score.passed, report.artifacts.report)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.passed).toBe(true)
    })
  },
)
