import type { AgentRole } from '@hip/protocol'

const NAME_TO_ROLE: Record<string, AgentRole> = { planner: 'planner', coder: 'coder', reviewer: 'reviewer' }

/** Map a sub-agent name to its role; defaults to 'supervisor' (the primary loop). */
export function roleForName(name: string | undefined): AgentRole {
  return name && name in NAME_TO_ROLE ? NAME_TO_ROLE[name] : 'supervisor'
}
