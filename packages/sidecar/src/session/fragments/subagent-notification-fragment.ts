import type { ContextFragment, FragmentState } from '../context-fragment.js'

export class SubagentNotificationFragment implements ContextFragment {
  id = 'subagent-notification'
  role = 'system' as const

  isActive(state: FragmentState): boolean {
    return (state.pendingSubagents !== undefined && state.pendingSubagents.length > 0) ||
           (state.completedSubagents !== undefined && state.completedSubagents.length > 0)
  }

  render(state: FragmentState): string {
    const sections: string[] = []

    if (state.pendingSubagents && state.pendingSubagents.length > 0) {
      const pending = state.pendingSubagents
        .map((s) => `- ${s.description} (${s.id})`)
        .join('\n')
      sections.push(`Pending background tasks:\n${pending}`)
    }

    if (state.completedSubagents && state.completedSubagents.length > 0) {
      const completed = state.completedSubagents
        .map((s) => `- ${s.description} (${s.id}) — ${s.status}`)
        .join('\n')
      sections.push(`Completed background tasks:\n${completed}`)
    }

    return sections.join('\n\n')
  }

  estimatedTokens(state: FragmentState): number {
    return Math.ceil(this.render(state).length / 4)
  }
}
