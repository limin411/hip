import type { AgentAuthMode } from '@hip/protocol'

export type AcpPresetStatus = 'available' | 'coming-soon'
export type AcpPresetIcon = 'code' | 'bot' | 'cpu' | 'rocket'

export interface AcpPreset {
  id: string
  name: string // brand label, NOT localized
  status: AcpPresetStatus
  command: string // default executable; '' for coming-soon
  args: string[] // default launch args; [] for coming-soon
  quirks?: string // quirk-profile key (packages/sidecar/.../acp-quirks.ts)
  authModeDefault?: AgentAuthMode
  icon: AcpPresetIcon
}

export const ACP_PRESETS: AcpPreset[] = [
  { id: 'opencode', name: 'OpenCode', status: 'available', command: 'opencode', args: ['acp'], quirks: 'opencode', authModeDefault: 'opencode-self', icon: 'code' },
  { id: 'claude-code', name: 'Claude Code', status: 'coming-soon', command: '', args: [], icon: 'bot' },
  { id: 'codex', name: 'Codex', status: 'coming-soon', command: '', args: [], icon: 'cpu' },
  { id: 'kimi-code', name: 'Kimi Code', status: 'coming-soon', command: '', args: [], icon: 'rocket' },
]

/** The 自定义 / 通用 escape hatch — not a real preset; the picker handles it separately. */
export const CUSTOM_ACP_PRESET_ID = 'custom'

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}
