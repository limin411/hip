import type { AgentRole } from '@hip/protocol'

/** Role → CSS custom-property color, shared by the inline timeline and the agent panel. */
export const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
  worker: 'var(--role-worker)',
}

/** Role → i18n key for its localized display name (artifact.roles.*). */
export const ROLE_NAME_KEY = {
  supervisor: 'artifact.roles.supervisor',
  planner: 'artifact.roles.planner',
  coder: 'artifact.roles.coder',
  reviewer: 'artifact.roles.reviewer',
  worker: 'artifact.roles.worker',
} as const satisfies Record<AgentRole, string>
