import type { AgentRole } from '@hip/protocol'

/** Role → CSS custom-property color, shared by the inline timeline and the agent panel. */
export const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}
