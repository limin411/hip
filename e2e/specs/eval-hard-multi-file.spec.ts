import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval hard multi-file @live @eval @hard',
  function (this: Mocha.Suite) {
    this.timeout(1_500_000)

    it('bb-hard-multi-file-common', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-hard')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-hard-multi-file-common')!
      checkPatchApplies(BYTEBASE!, task.workspace.base_sha!, path.join(packDir, 'fixtures/break-multi-file-common.patch'))
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-hard] multi-file', score.tags, score.passed, report.artifacts.report)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.passed).toBe(true)
    })
  },
)
