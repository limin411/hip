import { beforeEach, describe, expect, it, vi } from 'vitest'

const isDirectory = vi.fn(async (_path: string): Promise<boolean | null> => true)

vi.mock('@/ipc/pathExists', () => ({
  isDirectory: (path: string) => isDirectory(path),
}))

import { useProjectPathStore } from './projectPathStore'

describe('projectPathStore', () => {
  beforeEach(() => {
    isDirectory.mockReset()
    isDirectory.mockResolvedValue(true)
    useProjectPathStore.setState({ byKey: {} })
  })

  it('marks missing after probe returns false', async () => {
    isDirectory.mockResolvedValue(false)
    useProjectPathStore.getState().ensureChecked(['/gone/proj'])
    await vi.waitFor(() => {
      expect(useProjectPathStore.getState().isMissing('/gone/proj')).toBe(true)
    })
    expect(useProjectPathStore.getState().statusOf('/gone/proj/')).toBe('missing')
  })

  it('marks ok after probe returns true', async () => {
    useProjectPathStore.getState().ensureChecked(['/ok/proj'])
    await vi.waitFor(() => {
      expect(useProjectPathStore.getState().statusOf('/ok/proj')).toBe('ok')
    })
  })

  it('stays unknown when probe cannot run', async () => {
    isDirectory.mockResolvedValue(null)
    useProjectPathStore.getState().ensureChecked(['/maybe'])
    await vi.waitFor(() => {
      const e = useProjectPathStore.getState().byKey['/maybe']
      expect(e?.inFlight).toBe(false)
    })
    expect(useProjectPathStore.getState().statusOf('/maybe')).toBe('unknown')
    expect(useProjectPathStore.getState().isMissing('/maybe')).toBe(false)
  })

  it('markOk and invalidate', () => {
    useProjectPathStore.getState().markOk('/p')
    expect(useProjectPathStore.getState().statusOf('/p')).toBe('ok')
    useProjectPathStore.getState().invalidate('/p')
    expect(useProjectPathStore.getState().statusOf('/p')).toBe('unknown')
  })

  it('dedupes in-flight checks', () => {
    let resolve!: (v: boolean) => void
    isDirectory.mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          resolve = r
        }),
    )
    useProjectPathStore.getState().ensureChecked(['/slow'])
    useProjectPathStore.getState().ensureChecked(['/slow'])
    expect(isDirectory).toHaveBeenCalledTimes(1)
    resolve(true)
  })
})
