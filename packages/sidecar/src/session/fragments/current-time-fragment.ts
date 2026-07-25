import type { ContextFragment, FragmentState } from '../context-fragment.js'
import { formatCurrentTimeText } from '../current-time.js'

export class CurrentTimeFragment implements ContextFragment {
  id = 'current-time'
  role = 'system' as const

  isActive(_state: FragmentState): boolean {
    return true
  }

  render(_state: FragmentState): string {
    return formatCurrentTimeText()
  }

  estimatedTokens(_state: FragmentState): number {
    return 40
  }
}
