import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../../graph/builder.js'

export function plannerNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to produce a plan; push result to messages
    return {}
  }
}
