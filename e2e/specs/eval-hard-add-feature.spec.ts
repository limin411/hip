import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval hard add feature @live @eval @hard',
  function (this: Mocha.Suite) {
    this.timeout(1_200_000)

    it('bb-hard-add-has-any-suffix', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-hard')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-hard-add-has-any-suffix')!
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-hard] add-feature', score.tags, score.passed, report.artifacts.report)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.passed).toBe(true)
    })
  },
)
