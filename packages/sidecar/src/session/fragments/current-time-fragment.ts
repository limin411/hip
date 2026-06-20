import type { ContextFragment, FragmentState } from '../context-fragment.js'

export class CurrentTimeFragment implements ContextFragment {
  id = 'current-time'
  role = 'system' as const

  isActive(_state: FragmentState): boolean {
    return true
  }

  render(_state: FragmentState): string {
    const iso = new Date().toISOString().replace('T', ' ').slice(0, 19)
    return `It is ${iso} UTC.`
  }

  estimatedTokens(_state: FragmentState): number {
    return 15
  }
}
