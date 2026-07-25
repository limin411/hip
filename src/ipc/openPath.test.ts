import { describe, it, expect, vi, beforeEach } from 'vitest'

const { openPath, shellOpen, toastError } = vi.hoisted(() => ({
  openPath: vi.fn(async () => {}),
  shellOpen: vi.fn(async () => {}),
  toastError: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({ openPath }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }))
vi.mock('sonner', () => ({ toast: { error: toastError, message: vi.fn(), success: vi.fn() } }))
vi.mock('@/i18n', () => ({
  default: { t: (key: string) => key },
}))

import { openContainingFolder, openWithDefaultApp } from './openPath'

describe('openContainingFolder', () => {
  beforeEach(() => {
    openPath.mockReset().mockResolvedValue(undefined)
    shellOpen.mockReset().mockResolvedValue(undefined)
    toastError.mockReset()
  })

  it('opens parent directory for files under cwd', async () => {
    const ok = await openContainingFolder('/project/src/a.ts', {
      cwd: '/project',
      isDir: false,
    })
    expect(ok).toBe(true)
    expect(openPath).toHaveBeenCalledWith('/project/src')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('opens directory itself when isDir', async () => {
    await openContainingFolder('/project/src', { cwd: '/project', isDir: true })
    expect(openPath).toHaveBeenCalledWith('/project/src')
  })

  it('rejects paths outside cwd (prefix attack)', async () => {
    const ok = await openContainingFolder('/project-evil/x', {
      cwd: '/project',
      isDir: false,
    })
    expect(ok).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('contextMenu.file.pathOutsideCwd')
  })

  it('rejects when cwd is null', async () => {
    const ok = await openContainingFolder('/project/a', { cwd: null, isDir: false })
    expect(ok).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('falls back to shell open when opener fails', async () => {
    openPath.mockRejectedValueOnce(new Error('no opener'))
    const ok = await openContainingFolder('/project/a.ts', {
      cwd: '/project',
      isDir: false,
    })
    expect(ok).toBe(true)
    expect(shellOpen).toHaveBeenCalledWith('/project')
  })

  it('toasts when both openers fail', async () => {
    openPath.mockRejectedValueOnce(new Error('no'))
    shellOpen.mockRejectedValueOnce(new Error('no'))
    const ok = await openContainingFolder('/project/a.ts', {
      cwd: '/project',
      isDir: false,
    })
    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('contextMenu.file.openContainingFolderFailed')
  })
})

describe('openWithDefaultApp', () => {
  beforeEach(() => {
    openPath.mockReset().mockResolvedValue(undefined)
    shellOpen.mockReset().mockResolvedValue(undefined)
    toastError.mockReset()
  })

  it('opens the file itself under cwd', async () => {
    const ok = await openWithDefaultApp('/project/out/index.html', { cwd: '/project' })
    expect(ok).toBe(true)
    expect(openPath).toHaveBeenCalledWith('/project/out/index.html')
  })

  it('rejects paths outside cwd', async () => {
    const ok = await openWithDefaultApp('/etc/passwd', { cwd: '/project' })
    expect(ok).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('contextMenu.file.pathOutsideCwd')
  })

  it('toasts when both openers fail', async () => {
    openPath.mockRejectedValueOnce(new Error('no'))
    shellOpen.mockRejectedValueOnce(new Error('no'))
    const ok = await openWithDefaultApp('/project/a.html', { cwd: '/project' })
    expect(ok).toBe(false)
    expect(toastError).toHaveBeenCalledWith('contextMenu.file.openWithDefaultAppFailed')
  })
})
