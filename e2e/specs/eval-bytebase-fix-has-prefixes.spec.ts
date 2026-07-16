/**
 * Live eval: fix HasPrefixes via desktop UI.
 * Run: E2E_LIVE_LLM=1 HIP_EVAL_BYTEBASE_PATH=... yarn test:e2e --spec e2e/specs/eval-bytebase-fix-has-prefixes.spec.ts
 */
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval bytebase fix HasPrefixes @live @eval',
  function (this: Mocha.Suite) {
    this.timeout(1_000_000)

    it('runs UI coding task and scores with go test', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-pilot')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-common-fix-has-prefixes')
      expect(task).toBeTruthy()

      const pin = task!.workspace.base_sha!
      const patch = path.join(packDir, 'fixtures/break-has-prefixes.patch')
      checkPatchApplies(BYTEBASE!, pin, patch)

      const { score, report } = await runEvalTask({
        task: task!,
        packDir,
        packId: pack.id,
      })

      // Always write path for debugging
      // eslint-disable-next-line no-console
      console.log('[eval] report', report.artifacts.report, 'tags', score.tags, 'passed', score.passed)

      expect(score.tags.length).toBeGreaterThan(0)
      expect(score.tags).not.toContain('infra_prepare')
      // Must have actually started an agent turn (not false-settled on "正在思考")
      expect(report.ui.errorHints ?? []).not.toContain('never_saw_running')
      // Live success criterion for this pilot task
      expect(score.passed).toBe(true)
      expect(report.verify.passed).toBe(true)
    })
  },
)
