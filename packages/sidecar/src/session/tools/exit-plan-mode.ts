import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { PlanMode } from '../plan-mode.js'

const ExitPlanModeSchema = z.object({}).strict()

export class ExitPlanModeTool extends StructuredTool {
  static override lc_name() {
    return 'ExitPlanMode'
  }

  name = 'ExitPlanMode'
  description = 'Exit plan mode. Save and submit the plan for review.'
  schema = ExitPlanModeSchema

  constructor(private planMode: PlanMode) {
    super()
  }

  async _call(_input: z.infer<typeof ExitPlanModeSchema>): Promise<string> {
    if (!this.planMode.isActive) {
      return 'Error: ExitPlanMode can only be called while plan mode is active. Use EnterPlanMode first.'
    }

    const planContent = await this.planMode.readPlan()

    if (planContent && planContent.trim()) {
      return `Exited plan mode. Plan ready for review.\n\n## Plan:\n${planContent}`
    }

    // Plan file may be empty if write_todos was used instead of Write/Edit.
    // Allow empty plan files — the plan is tracked via write_todos state.
    return `Exited plan mode. Plan ready for review.`
  }
}
