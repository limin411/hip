import type { AgentConfig } from '@hip/protocol'

export type AcpPresetIcon = 'code' | 'bot' | 'cpu' | 'rocket'

/** A supported ACP coding-agent provider. All four are real (detect-and-add). */
export interface AcpPreset {
  id: string                  // also the agent's `quirks` value (1:1) used to match 已添加
  name: string                // brand label, not localized
  icon: AcpPresetIcon
  detectBin: string           // primary executable to find on PATH ⇒ 已安装
  legacyBin?: string          // claude-code: pre-rename adapter bin
  command: string             // baked into AgentConfig.command on add
  args: string[]              // baked into AgentConfig.args on add
  quirks: string              // sidecar quirk-profile key (acp-quirks.ts); === id
  authEnvVar?: string         // adapter agents: env var the API key maps to
  installCmd: string          // shown when 未安装 (copyable)
}

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'opencode', name: 'OpenCode', icon: 'code',
    detectBin: 'opencode', command: 'opencode', args: ['acp', '--pure'],
    quirks: 'opencode', installCmd: 'npm i -g opencode-ai',
  },
  {
    id: 'kimi-code', name: 'Kimi Code', icon: 'rocket',
    detectBin: 'kimi', command: 'kimi', args: ['acp'],
    quirks: 'kimi-code', installCmd: 'npm i -g @moonshot-ai/kimi-code',
  },
  {
    id: 'claude-code', name: 'Claude Code', icon: 'bot',
    detectBin: 'claude-agent-acp', legacyBin: 'claude-code-acp',
    command: 'claude-agent-acp', args: [],
    quirks: 'claude-code', authEnvVar: 'ANTHROPIC_API_KEY',
    installCmd: 'npm i -g @agentclientprotocol/claude-agent-acp',
  },
  {
    id: 'codex', name: 'Codex', icon: 'cpu',
    detectBin: 'codex-acp', command: 'codex-acp', args: [],
    quirks: 'codex', authEnvVar: 'OPENAI_API_KEY',
    installCmd: 'npm i -g @zed-industries/codex-acp',
  },
]

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}

/** Installed iff the primary (or legacy) detect binary is on PATH. */
export function presetInstalled(preset: AcpPreset, installed: Record<string, boolean>): boolean {
  return installed[preset.detectBin] === true || (preset.legacyBin ? installed[preset.legacyBin] === true : false)
}

/** Added iff some configured agent carries this preset's id as its quirks. */
export function presetAdded(preset: AcpPreset, agents: Pick<AgentConfig, 'quirks'>[]): boolean {
  return agents.some((a) => a.quirks === preset.id)
}
