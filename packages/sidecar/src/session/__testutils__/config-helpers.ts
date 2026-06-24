import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'

/** Write a minimal hip.toml in `dir` and return its path.
 *
 *  Use this in tests instead of the legacy per-domain JSON files
 *  (`hip-skills.json`, `hip-agents.json`, etc.). The sidecar now reads
 *  skills/agents exclusively from `HIP_CONFIG_PATH`.
 */
export function writeHipToml(
  dir: string,
  opts: {
    skills?: Record<string, boolean>
    agents?: AgentConfig[]
  } = {},
): string {
  const lines: string[] = ['version = 1']

  if (opts.skills) {
    for (const [id, enabled] of Object.entries(opts.skills)) {
      lines.push('', '[[skills]]', `id = ${JSON.stringify(id)}`, `enabled = ${enabled}`)
    }
  }

  if (opts.agents) {
    for (const a of opts.agents) {
      lines.push('', '[[agents]]')
      lines.push(`id = ${JSON.stringify(a.id)}`)
      lines.push(`name = ${JSON.stringify(a.name)}`)
      lines.push(`kind = ${JSON.stringify(a.kind)}`)
      lines.push(`command = ${JSON.stringify(a.command)}`)
      lines.push(`args = ${JSON.stringify(a.args)}`)
      if (a.boundModel) {
        lines.push('[agents.boundModel]')
        lines.push(`providerID = ${JSON.stringify(a.boundModel.providerID)}`)
        lines.push(`modelID = ${JSON.stringify(a.boundModel.modelID)}`)
      }
      if (a.allowedSkills?.length) {
        lines.push(`allowedSkills = ${JSON.stringify(a.allowedSkills)}`)
      }
      if (a.allowedMcpServers?.length) {
        lines.push(`allowedMcpServers = ${JSON.stringify(a.allowedMcpServers)}`)
      }
      if (a.allowedTools?.length) {
        lines.push(`allowedTools = ${JSON.stringify(a.allowedTools)}`)
      }
      if (a.env && Object.keys(a.env).length > 0) {
        lines.push('[agents.env]')
        for (const [k, v] of Object.entries(a.env)) {
          lines.push(`${k} = ${JSON.stringify(v)}`)
        }
      }
      lines.push(`enabled = ${a.enabled}`)
    }
  }

  const p = join(dir, 'hip.toml')
  writeFileSync(p, lines.join('\n') + '\n', 'utf8')
  return p
}
