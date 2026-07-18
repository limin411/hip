import { describe, it, expect, vi, beforeEach } from 'vitest'

const detectBinaries = vi.fn()
vi.mock('@/ipc/detect', () => ({ detectBinaries: (...a: unknown[]) => detectBinaries(...a) }))
vi.mock('@/lib/acpPresets', () => ({
  acpDetectNames: () => ['opencode', 'claude', 'claude-agent-acp'],
}))

beforeEach(async () => {
  detectBinaries.mockReset().mockResolvedValue({})
  const { useDetectionStore } = await import('./detectionStore.js')
  useDetectionStore.setState({ installed: {}, checked: false })
})

describe('detectionStore', () => {
  it('refresh() probes agent + adapter binaries and stores the result', async () => {
    detectBinaries.mockResolvedValueOnce({ opencode: true, claude: false, 'claude-agent-acp': true })
    const { useDetectionStore } = await import('./detectionStore.js')
    await useDetectionStore.getState().refresh()
    expect(detectBinaries).toHaveBeenCalledWith(expect.arrayContaining(['opencode', 'claude', 'claude-agent-acp']))
    expect(useDetectionStore.getState().installed).toEqual({
      opencode: true,
      claude: false,
      'claude-agent-acp': true,
    })
    expect(useDetectionStore.getState().checked).toBe(true)
  })
})
