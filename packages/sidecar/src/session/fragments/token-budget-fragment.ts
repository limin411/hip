import type { ContextFragment, FragmentState } from '../context-fragment.js'

export class TokenBudgetFragment implements ContextFragment {
  id = 'token-budget'
  role = 'system' as const

  isActive(state: FragmentState): boolean {
    return state.tokenBudgetPercent !== undefined && state.tokenBudgetPercent >= 0
  }

  render(state: FragmentState): string {
    const n = state.tokenBudgetPercent!
    if (n <= 10) {
      return 'Your token budget is nearly exhausted. Finish quickly or compact the conversation.'
    }
    return `You have approximately ${n}% of your token budget remaining.`
  }

  estimatedTokens(_state: FragmentState): number {
    return 20
  }
}
