import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../../graph/builder.js'

export function coderNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to generate code; push result to messages
    return {}
  }
}
