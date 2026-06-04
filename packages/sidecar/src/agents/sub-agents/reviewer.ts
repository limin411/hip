import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../../graph/builder.js'

export function reviewerNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to review and critique; push result to messages
    return {}
  }
}
