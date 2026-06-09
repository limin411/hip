import type { AgentRole } from '@hip/protocol'

/** Role → CSS custom-property color, shared by the inline timeline and the agent panel. */
export const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}

/** Role → display title, shared by the agent panel and the inline timeline. */
export const ROLE_TITLE: Record<AgentRole, string> = {
  supervisor: 'Supervisor',
  planner: 'Planner',
  coder: 'Coder',
  reviewer: 'Reviewer',
}
