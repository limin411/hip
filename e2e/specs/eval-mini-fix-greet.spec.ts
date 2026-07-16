/**
 * Live eval: fix Greet in the mini-go fixture pack (non-Bytebase migration).
 */
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { checkPatchApplies } from '../eval/workspace.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const MINI = process.env.HIP_EVAL_MINI_GO_PATH

;(LIVE && MINI ? describe : describe.skip)(
  'eval mini-go fix Greet @live @eval @mini',
  function (this: Mocha.Suite) {
    this.timeout(900_000)

    it('mini-fix-greet', async () => {
      const packDir = path.resolve('e2e/eval/tasks/mini-go')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'mini-fix-greet')!
      checkPatchApplies(MINI!, task.workspace.base_sha ?? 'HEAD', path.join(packDir, 'fixtures/break-greet.patch'))
      const { score, report } = await runEvalTask({ task, packDir, packId: pack.id })
      // eslint-disable-next-line no-console
      console.log('[eval-mini] greet', score.tags, score.passed, report.artifacts.report)
      expect(score.tags).not.toContain('infra_prepare')
      expect(score.passed).toBe(true)
    })
  },
)
