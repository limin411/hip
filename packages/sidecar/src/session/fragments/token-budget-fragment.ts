import type { ContextFragment, FragmentState } from '../context-fragment.js'
import { renderTokenBudget, shouldInjectTokenBudget } from './token-budget.js'

export class TokenBudgetFragment implements ContextFragment {
  id = 'token-budget'
  role = 'system' as const

  isActive(state: FragmentState): boolean {
    return (
      state.tokenBudgetPercent !== undefined &&
      shouldInjectTokenBudget(state.tokenBudgetPercent)
    )
  }

  render(state: FragmentState): string {
    return renderTokenBudget(state.tokenBudgetPercent ?? 100)
  }

  estimatedTokens(_state: FragmentState): number {
    return 20
  }
}
