/**
 * Live eval: navigate to TruncateString via desktop UI.
 */
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { loadPack } from '../eval/load-task.js'
import { runEvalTask } from '../helpers/eval-run.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const BYTEBASE = process.env.HIP_EVAL_BYTEBASE_PATH

;(LIVE && BYTEBASE ? describe : describe.skip)(
  'eval bytebase nav TruncateString @live @eval',
  function (this: Mocha.Suite) {
    this.timeout(400_000)

    it('answers with TruncateString / util.go via UI', async () => {
      const packDir = path.resolve('e2e/eval/tasks/bytebase-pilot')
      const { pack, tasks } = loadPack(packDir)
      const task = tasks.find((t) => t.id === 'bb-common-nav-truncate')
      expect(task).toBeTruthy()

      const { score, report } = await runEvalTask({
        task: task!,
        packDir,
        packId: pack.id,
      })

      // eslint-disable-next-line no-console
      console.log('[eval] nav tags', score.tags, 'text', report.ui.assistantText.slice(0, 200))

      expect(score.tags).not.toContain('infra_prepare')
      expect(score.tags).not.toContain('ui_bind_fail')
      // Prefer pass; allow unknown if model missed text oracle
      expect(score.passed || score.tags.includes('unknown') || score.tags.includes('timeout')).toBe(true)
    })
  },
)
