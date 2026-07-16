/**
 * Live eval: short timeout stress probe (often fails by design).
 */
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval bytebase stress timeout @live @eval',
  function (this: Mocha.Suite) {
    this.timeout(120_000)

    it('records timeout or other terminal tags within 60s budget', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-pilot')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-stress-timeout')
      expect(task).toBeTruthy()

      const { score, report } = await runEvalTask({
        task: task!,
        packDir,
        packId: pack.id,
      })

      // eslint-disable-next-line no-console
      console.log('[eval] stress tags', score.tags, 'durationMs', report.durationMs)

      expect(score.tags).not.toContain('infra_prepare')
      // Calibration task: we mainly require a classified outcome
      expect(score.tags.length).toBeGreaterThan(0)
    })
  },
)
