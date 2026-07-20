import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { PlanMode } from '../plan-mode.js'

const enterPlanModeSchema = z.object({}).strict()

export class EnterPlanModeTool extends StructuredTool {
  static override lc_name() {
    return 'EnterPlanMode'
  }

  name = 'EnterPlanMode'
  description =
    'Enter plan mode for implementation tasks with genuine ambiguity about the right approach ' +
    '(e.g. auth/caching/real-time design, multi-file redesign, unclear requirements that need ' +
    'exploration before code). Plan mode restricts the agent to read-only tools (Read, Grep, Glob) ' +
    'and the plan file. After entering, investigate, design a step-by-step plan, write narrative ' +
    'Markdown to the plan file, call write_todos for execution tracking, then ExitPlanMode for ' +
    'user approval. Do NOT use for pure research/analysis that only needs a written answer, ' +
    'single obvious edits (typos, renames, small UI tweaks), or when the user wants execution ' +
    'not a planning ceremony. Do NOT edit files other than the plan file while plan mode is active.'
  schema = enterPlanModeSchema

  constructor(
    private planMode: PlanMode,
    private sessionId: string,
  ) {
    super()
  }

  protected async _call(_input: z.infer<typeof enterPlanModeSchema>): Promise<string> {
    if (this.planMode.isActive) {
      return 'Error: Plan mode is already active. Use ExitPlanMode when the plan is ready.'
    }

    await this.planMode.enter(this.sessionId)

    const path = this.planMode.planFilePath ?? '(unknown)'

    return `Plan mode is now active. Plan file: ${path}

1. Use read-only tools (Read, Grep, Glob) to investigate the codebase.
2. Design a concrete, step-by-step plan.
3. Write the plan as Markdown to the plan file with Write/Edit.
4. Call write_todos with structured plan items for execution tracking.
5. When the plan is ready, call ExitPlanMode for user approval.

Do NOT edit files other than the plan file while plan mode is active.`
  }
}
