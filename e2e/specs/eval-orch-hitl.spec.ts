import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval orch hitl resume @live @eval @orch',
  function (this: Mocha.Suite) {
    this.timeout(1_800_000)

    it('bb-orch-hitl-resume', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-orch')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-orch-hitl-resume')!
      checkPatchApplies(BYTEBASE!, task.workspace.base_sha!, path.join(packDir, 'fixtures/break-has-prefixes.patch'))
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-orch] hitl', score.tags, score.passed, 'resumes', report.ui.interruptResumes)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.tags).not.toContain('permission_stuck')
      expect(score.passed).toBe(true)
    })
  },
)
