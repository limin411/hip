import type { ContextFragment, FragmentState } from '../context-fragment.js'
import { buildSystemPrompt } from '../system-prompt.js'

export class SystemPromptFragment implements ContextFragment {
  id = 'system-prompt'
  role = 'system' as const

  isActive(state: FragmentState): boolean {
    return state.cwd !== undefined
  }

  render(state: FragmentState): string {
    return buildSystemPrompt({
      cwd: state.cwd!,
      userInstructions: state.customSystemPrompt,
      skills: state.skills,
      permissionMode: state.permissionMode,
      mcpCatalog: state.mcpCatalog?.join('\n'),
    })
  }

  estimatedTokens(state: FragmentState): number {
    return Math.ceil(this.render(state).length / 4)
  }
}
