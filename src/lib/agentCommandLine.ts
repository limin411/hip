import type { AgentConfig } from '@hip/protocol'

/** Render an agent's launch command line: `command arg1 arg2`.
 *  `args` is typed `string[]` but can arrive `undefined` over the Rust→JSON boundary —
 *  empty arrays are dropped by `skip_serializing_if = "Vec::is_empty"` — so guard it. */
export function agentCommandLine(agent: Pick<AgentConfig, 'command'> & { args?: string[] }): string {
  return [agent.command, ...(agent.args ?? [])].join(' ')
}
