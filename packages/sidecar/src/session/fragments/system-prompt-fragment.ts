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
      mcpCatalog: state.mcpCatalog,
    })
  }

  estimatedTokens(_state: FragmentState): number {
    // buildSystemPrompt can perform filesystem scans (skillsBlock uses globSync);
    // avoid double-rendering by using a fixed baseline consistent with the
    // typical system prompt size (~2-5k characters).
    return 1200
  }
}
