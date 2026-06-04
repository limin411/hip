import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import type { SessionConfig } from '@hip/protocol'
import { supervisorNode } from '../agents/supervisor.js'
import { plannerNode } from '../agents/sub-agents/planner.js'
import { coderNode } from '../agents/sub-agents/coder.js'
import { reviewerNode } from '../agents/sub-agents/reviewer.js'

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  next: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => END,
  }),
})

export type AgentStateType = typeof AgentState.State

export function buildAgentGraph(config: SessionConfig) {
  // Fluent chain required in LangGraph v1.x for TypeScript to track node names
  return new StateGraph(AgentState)
    .addNode('supervisor', supervisorNode(config))
    .addNode('planner', plannerNode(config))
    .addNode('coder', coderNode(config))
    .addNode('reviewer', reviewerNode(config))
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', (state) => state.next, {
      planner: 'planner',
      coder: 'coder',
      reviewer: 'reviewer',
      [END]: END,
    })
    .addEdge('planner', 'supervisor')
    .addEdge('coder', 'supervisor')
    .addEdge('reviewer', 'supervisor')
    .compile()
}
