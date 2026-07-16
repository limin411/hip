import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defaultDebugExportFilename, exportSessionDebugBundle } from './exportSessionDebug'

vi.mock('@/ipc/dialog', () => ({
  pickSavePath: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/i18n', () => ({
  default: { t: (key: string) => key },
}))

import { pickSavePath } from '@/ipc/dialog'
import { invoke } from '@tauri-apps/api/core'

describe('defaultDebugExportFilename', () => {
  it('builds a safe dated json name', () => {
    const name = defaultDebugExportFilename('sess/a:b', new Date('2026-07-16T12:00:00Z'))
    expect(name).toBe('hip-debug-sess_a_b-2026-07-16.json')
  })
})

describe('exportSessionDebugBundle', () => {
  beforeEach(() => {
    vi.mocked(pickSavePath).mockReset()
    vi.mocked(invoke).mockReset()
  })

  it('writes json to the path from the save dialog', async () => {
    vi.mocked(pickSavePath).mockResolvedValue('/tmp/out.json')
    vi.mocked(invoke).mockResolvedValue(undefined)
    const result = await exportSessionDebugBundle('{"v":1}\n', 's1')
    expect(result).toBe('saved')
    expect(pickSavePath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^hip-debug-s1-\d{4}-\d{2}-\d{2}\.json$/),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }),
    )
    expect(invoke).toHaveBeenCalledWith('write_text_file', {
      path: '/tmp/out.json',
      contents: '{"v":1}\n',
    })
  })

  it('returns cancelled when user dismisses the dialog', async () => {
    vi.mocked(pickSavePath).mockResolvedValue(null)
    await expect(exportSessionDebugBundle('{}', 's1')).resolves.toBe('cancelled')
    expect(invoke).not.toHaveBeenCalled()
  })
})
