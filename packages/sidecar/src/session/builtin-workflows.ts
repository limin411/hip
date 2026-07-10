import type { WorkflowDef } from '@hip/protocol'

/** v1 default cluster template: linear planner → coder, no gates. */
export function buildClusterDefaultWorkflow(): WorkflowDef {
  return {
    id: 'builtin:cluster-default',
    name: 'Cluster Default',
    entry: ['planner'],
    nodes: [
      {
        type: 'agent',
        id: 'planner',
        agentId: 'worker',
        inputTemplate:
          'You are the planner. Break down the user request into concrete steps and acceptance criteria. Be concise.\n\nUser request:\n{{input}}',
      },
      {
        type: 'agent',
        id: 'coder',
        agentId: 'worker',
        inputTemplate:
          'You are the implementer. Execute the plan with minimal correct changes.\n\nPlan:\n{{planner}}\n\nOriginal request:\n{{input}}',
      },
    ],
    edges: [{ from: 'planner', to: 'coder' }],
  }
}
