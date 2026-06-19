import { describe, it, expect, vi, beforeEach } from 'vitest'

const detectBinaries = vi.fn()
vi.mock('@/ipc/detect', () => ({ detectBinaries: (...a: unknown[]) => detectBinaries(...a) }))
vi.mock('@/lib/acpPresets', () => ({
  ACP_PRESETS: [
    { id: 'opencode', detectBin: 'opencode' },
    { id: 'claude-code', detectBin: 'claude' },
  ],
}))

beforeEach(async () => {
  detectBinaries.mockReset().mockResolvedValue({})
  const { useDetectionStore } = await import('./detectionStore.js')
  useDetectionStore.setState({ installed: {}, checked: false })
})

describe('detectionStore', () => {
  it('refresh() probes each preset detect (agent) command and stores the result', async () => {
    detectBinaries.mockResolvedValueOnce({ opencode: true, claude: false })
    const { useDetectionStore } = await import('./detectionStore.js')
    await useDetectionStore.getState().refresh()
    expect(detectBinaries).toHaveBeenCalledWith(expect.arrayContaining(['opencode', 'claude']))
    expect(useDetectionStore.getState().installed).toEqual({ opencode: true, claude: false })
    expect(useDetectionStore.getState().checked).toBe(true)
  })
})
