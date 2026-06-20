import type { ContextFragment, FragmentState } from '../context-fragment.js'
import { skillsBlock } from '../system-prompt.js'

export class SkillsFragment implements ContextFragment {
  id = 'skills'
  role = 'system' as const

  isActive(state: FragmentState): boolean {
    return (state.skills !== undefined && state.skills.length > 0) && state.cwd !== undefined
  }

  render(state: FragmentState): string {
    return skillsBlock(state.skills!, state.cwd)
  }

  estimatedTokens(state: FragmentState): number {
    return Math.ceil(this.render(state).length / 4)
  }
}
