import { END } from '@langchain/langgraph'
import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../graph/builder.js'

export function supervisorNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to route to 'planner' | 'coder' | 'reviewer' | END
    return { next: END }
  }
}
