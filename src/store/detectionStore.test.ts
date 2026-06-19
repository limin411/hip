import { describe, it, expect, vi, beforeEach } from 'vitest'

const detectBinaries = vi.fn()
vi.mock('@/ipc/detect', () => ({ detectBinaries: (...a: unknown[]) => detectBinaries(...a) }))
vi.mock('@/lib/acpPresets', () => ({
  ACP_PRESETS: [
    { id: 'opencode', detectBin: 'opencode' },
    { id: 'claude-code', detectBin: 'claude-agent-acp', legacyBin: 'claude-code-acp' },
  ],
}))

beforeEach(async () => {
  detectBinaries.mockReset().mockResolvedValue({})
  const { useDetectionStore } = await import('./detectionStore.js')
  useDetectionStore.setState({ installed: {}, checked: false })
})

describe('detectionStore', () => {
  it('refresh() probes the union of preset detect + legacy binaries', async () => {
    detectBinaries.mockResolvedValueOnce({ opencode: true, 'claude-agent-acp': false, 'claude-code-acp': true })
    const { useDetectionStore } = await import('./detectionStore.js')
    await useDetectionStore.getState().refresh()
    expect(detectBinaries).toHaveBeenCalledWith(
      expect.arrayContaining(['opencode', 'claude-agent-acp', 'claude-code-acp']),
    )
    expect(useDetectionStore.getState().installed).toEqual({ opencode: true, 'claude-agent-acp': false, 'claude-code-acp': true })
    expect(useDetectionStore.getState().checked).toBe(true)
  })
})
