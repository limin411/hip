import type { WorkflowDef } from '@hip/protocol'

/**
 * Internal/test cluster template: linear planner → coder, no gates.
 *
 * NOT a product default and NOT selected by orchMode (routing ignores orchMode;
 * only an explicit pendingWorkflowDef / workflow:run enters the DAG path).
 * Product default remains Supervisor ReAct + task/dispatch_agent.
 * Callers that need this template must set pendingWorkflowDef themselves
 * (tests / advanced internal use).
 */
export function buildClusterDefaultWorkflow(): WorkflowDef {
  return {
    id: 'builtin:cluster-default',
    name: 'Cluster Default',
    entry: ['planner'],
    nodes: [
      {
        type: 'agent',
        id: 'planner',
        // Prefer real profiles over legacy worker when this template is used.
        agentId: 'plan',
        inputTemplate:
          'You are the planner. Break down the user request into concrete steps and acceptance criteria. Be concise.\n\nUser request:\n{{input}}',
      },
      {
        type: 'agent',
        id: 'coder',
        agentId: 'coder',
        inputTemplate:
          'You are the implementer. Execute the plan with minimal correct changes.\n\nPlan:\n{{planner}}\n\nOriginal request:\n{{input}}',
      },
    ],
    edges: [{ from: 'planner', to: 'coder' }],
  }
}
