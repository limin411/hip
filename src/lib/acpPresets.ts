import type { AgentConfig } from '@hip/protocol'

export type AcpPresetIcon = 'code' | 'bot' | 'cpu' | 'rocket'

/** A supported ACP coding-agent provider. All four are real (detect-and-add).
 *
 *  Detection (`detectBin`) is decoupled from how hip speaks ACP (`command`/`args`):
 *  "agent installed" means the AGENT's own global command is on PATH, regardless of how
 *  it was installed (npm / brew / curl / standalone).
 *
 *  OpenCode speaks ACP natively — launch command IS the detected binary.
 *  Pi / Claude Code / Codex need a community ACP adapter binary also on PATH
 *  (`adapterBin`); hip spawns that binary directly (no `npx -y`). Both the agent
 *  and the adapter must be pre-installed before the preset is pickable / switchable. */
export interface AcpPreset {
  id: string                  // also the agent's `quirks` value (1:1) used to match 已添加
  name: string                // brand label, not localized
  icon: AcpPresetIcon
  detectBin: string           // the AGENT's global command to find on PATH ⇒ agent 已安装
  command: string             // baked into AgentConfig.command on add (how hip speaks ACP)
  args: string[]              // baked into AgentConfig.args on add
  quirks: string              // sidecar quirk-profile key (acp-quirks.ts); === id
  authEnvVar?: string         // adapter agents: env var the API key maps to
  installCmd: string          // shown when agent 未安装 (copyable) — installs the AGENT
  adapterPkg?: string         // set iff the agent has no native ACP: community npm package name
  adapterBin?: string         // global CLI of the adapter on PATH (required when adapterPkg set)
  adapterInstallCmd?: string  // shown when adapter 未安装 (copyable)
}

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'opencode', name: 'OpenCode', icon: 'code',
    detectBin: 'opencode', command: 'opencode', args: ['acp', '--pure'],
    quirks: 'opencode', installCmd: 'npm i -g opencode-ai',
  },
  {
    // Detect the Pi agent (`pi`); speak ACP via globally-installed `pi-acp`.
    id: 'pi', name: 'Pi', icon: 'rocket',
    detectBin: 'pi',
    command: 'pi-acp', args: [],
    quirks: 'pi',
    installCmd: 'npm i -g --ignore-scripts @earendil-works/pi-coding-agent',
    adapterPkg: 'pi-acp',
    adapterBin: 'pi-acp',
    adapterInstallCmd: 'npm i -g pi-acp',
  },
  {
    // Detect Claude Code (`claude`); speak ACP via globally-installed adapter.
    id: 'claude-code', name: 'Claude Code', icon: 'bot',
    detectBin: 'claude',
    command: 'claude-agent-acp', args: [],
    quirks: 'claude-code', authEnvVar: 'ANTHROPIC_API_KEY',
    installCmd: 'npm i -g @anthropic-ai/claude-code',
    adapterPkg: '@agentclientprotocol/claude-agent-acp',
    adapterBin: 'claude-agent-acp',
    adapterInstallCmd: 'npm i -g @agentclientprotocol/claude-agent-acp',
  },
  {
    // Detect Codex (`codex`); speak ACP via globally-installed adapter.
    id: 'codex', name: 'Codex', icon: 'cpu',
    detectBin: 'codex',
    command: 'codex-acp', args: [],
    quirks: 'codex', authEnvVar: 'OPENAI_API_KEY',
    installCmd: 'npm i -g @openai/codex',
    adapterPkg: '@zed-industries/codex-acp',
    adapterBin: 'codex-acp',
    adapterInstallCmd: 'npm i -g @zed-industries/codex-acp',
  },
]

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}

/** Agent CLI present on PATH. */
export function presetAgentInstalled(preset: AcpPreset, installed: Record<string, boolean>): boolean {
  return installed[preset.detectBin] === true
}

/** Adapter CLI present on PATH. Native ACP presets (no adapterBin) are always "ok". */
export function presetAdapterInstalled(preset: AcpPreset, installed: Record<string, boolean>): boolean {
  if (!preset.adapterBin) return true
  return installed[preset.adapterBin] === true
}

/** Ready to pick / enable: agent installed, and adapter installed when required. */
export function presetInstalled(preset: AcpPreset, installed: Record<string, boolean>): boolean {
  return presetAgentInstalled(preset, installed) && presetAdapterInstalled(preset, installed)
}

/** Added iff some configured agent carries this preset's id as its quirks. */
export function presetAdded(preset: AcpPreset, agents: Pick<AgentConfig, 'quirks'>[]): boolean {
  return agents.some((a) => a.quirks === preset.id)
}

export interface AgentBinaryStatus {
  preset: AcpPreset
  /** Agent detect binary on PATH. */
  agentInstalled: boolean
  /** Adapter binary on PATH; always true when the preset has no adapter. */
  adapterInstalled: boolean
  /** Both agent and adapter ready. */
  installed: boolean
}

/** For an agent created from an ACP preset, return install readiness for agent + adapter.
 *  Returns undefined for non-preset agents. */
export function agentBinaryStatus(
  agent: Pick<AgentConfig, 'quirks'>,
  installed: Record<string, boolean>,
): AgentBinaryStatus | undefined {
  const preset = acpPresetById(agent.quirks ?? '')
  if (!preset) return undefined
  const agentInstalled = presetAgentInstalled(preset, installed)
  const adapterInstalled = presetAdapterInstalled(preset, installed)
  return {
    preset,
    agentInstalled,
    adapterInstalled,
    installed: agentInstalled && adapterInstalled,
  }
}

/** All bare names worth probing on PATH (agent + adapter CLIs). */
export function acpDetectNames(): string[] {
  const s = new Set<string>()
  for (const p of ACP_PRESETS) {
    if (p.detectBin) s.add(p.detectBin)
    if (p.adapterBin) s.add(p.adapterBin)
  }
  return [...s]
}
