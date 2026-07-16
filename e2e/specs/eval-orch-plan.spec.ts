import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval orch plan @live @eval @orch',
  function (this: Mocha.Suite) {
    this.timeout(1_800_000)

    it('bb-orch-plan-then-fix', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-orch')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-orch-plan-then-fix')!
      checkPatchApplies(BYTEBASE!, task.workspace.base_sha!, path.join(packDir, 'fixtures/break-has-prefixes.patch'))
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-orch] plan', score.tags, score.passed, 'planApproved', report.ui.planApproved)
      expect(score.tags).not.toContain('infra_prepare')
      // Product forcePlan chip is required for require mode; classify plan_skipped if agent still skips.
      expect(
        score.passed ||
          score.tags.includes('plan_skipped') ||
          score.tags.includes('verify_failed') ||
          score.tags.includes('timeout'),
      ).toBe(true)
    })
  },
)
