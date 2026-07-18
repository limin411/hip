import type { AgentConfig } from '@hip/protocol'

export type AcpPresetIcon = 'code' | 'bot' | 'cpu' | 'rocket'

/** A supported ACP coding-agent provider. All four are real (detect-and-add).
 *
 *  Detection (`detectBin`) is decoupled from how hip speaks ACP (`command`/`args`):
 *  "installed" means the AGENT's own global command is on PATH, regardless of how it was
 *  installed (npm / brew / curl / standalone). OpenCode speaks ACP natively, so its launch
 *  command IS the detected binary. Pi, Claude Code, and Codex don't speak ACP themselves —
 *  hip bridges via a community ACP adapter run with `npx` (self-contained; needs Node), so
 *  their launch command differs from the detected agent command. */
export interface AcpPreset {
  id: string                  // also the agent's `quirks` value (1:1) used to match 已添加
  name: string                // brand label, not localized
  icon: AcpPresetIcon
  detectBin: string           // the AGENT's global command to find on PATH ⇒ 已安装
  command: string             // baked into AgentConfig.command on add (how hip speaks ACP)
  args: string[]              // baked into AgentConfig.args on add
  quirks: string              // sidecar quirk-profile key (acp-quirks.ts); === id
  authEnvVar?: string         // adapter agents: env var the API key maps to
  installCmd: string          // shown when 未安装 (copyable) — installs the AGENT
  adapterPkg?: string         // set iff the agent has no native ACP: the community npm
                              // adapter hip bridges through (shown as a clarifying note)
}

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'opencode', name: 'OpenCode', icon: 'code',
    detectBin: 'opencode', command: 'opencode', args: ['acp', '--pure'],
    quirks: 'opencode', installCmd: 'npm i -g opencode-ai',
  },
  {
    // Detect the Pi agent (`pi`); speak ACP via pi-acp (spawns `pi --mode rpc`).
    id: 'pi', name: 'Pi', icon: 'rocket',
    detectBin: 'pi',
    command: 'npx', args: ['-y', 'pi-acp'],
    quirks: 'pi',
    installCmd: 'npm i -g --ignore-scripts @earendil-works/pi-coding-agent',
    adapterPkg: 'pi-acp',
  },
  {
    // Detect the Claude Code agent (`claude`); speak ACP via the adapter run on-demand
    // with npx (the adapter bundles its own runtime — no separate global install needed).
    id: 'claude-code', name: 'Claude Code', icon: 'bot',
    detectBin: 'claude',
    command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@latest'],
    quirks: 'claude-code', authEnvVar: 'ANTHROPIC_API_KEY',
    installCmd: 'npm i -g @anthropic-ai/claude-code',
    adapterPkg: '@agentclientprotocol/claude-agent-acp',
  },
  {
    // Detect the Codex agent (`codex`); speak ACP via the @zed-industries/codex-acp adapter.
    id: 'codex', name: 'Codex', icon: 'cpu',
    detectBin: 'codex',
    command: 'npx', args: ['-y', '@zed-industries/codex-acp'],
    quirks: 'codex', authEnvVar: 'OPENAI_API_KEY',
    installCmd: 'npm i -g @openai/codex',
    adapterPkg: '@zed-industries/codex-acp',
  },
]

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}

/** Installed iff the agent's global command is on PATH. */
export function presetInstalled(preset: AcpPreset, installed: Record<string, boolean>): boolean {
  return installed[preset.detectBin] === true
}

/** Added iff some configured agent carries this preset's id as its quirks. */
export function presetAdded(preset: AcpPreset, agents: Pick<AgentConfig, 'quirks'>[]): boolean {
  return agents.some((a) => a.quirks === preset.id)
}

/** For an agent created from an ACP preset, return the matching preset and whether its
 *  detect binary is currently installed. Returns undefined for non-preset agents. */
export function agentBinaryStatus(
  agent: Pick<AgentConfig, 'quirks'>,
  installed: Record<string, boolean>,
): { preset: AcpPreset; installed: boolean } | undefined {
  const preset = acpPresetById(agent.quirks ?? '')
  if (!preset) return undefined
  return { preset, installed: presetInstalled(preset, installed) }
}
