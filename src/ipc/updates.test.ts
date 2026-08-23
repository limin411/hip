import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const listen = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...a: unknown[]) => listen(...a),
}))

beforeEach(() => {
  invoke.mockReset()
  listen.mockReset()
})

describe('updates IPC', () => {
  it('updatesAppInfo invokes updates_app_info', async () => {
    const { updatesAppInfo } = await import('./updates.js')
    invoke.mockResolvedValueOnce({ version: '1.0.1', debugBuild: false, os: 'macos', arch: 'aarch64' })
    const info = await updatesAppInfo()
    expect(invoke).toHaveBeenCalledWith('updates_app_info')
    expect(info.version).toBe('1.0.1')
  })

  it('updatesCheck forwards force', async () => {
    const { updatesCheck } = await import('./updates.js')
    invoke.mockResolvedValueOnce({ status: 'up_to_date' })
    await updatesCheck(true)
    expect(invoke).toHaveBeenCalledWith('updates_check', { force: true })
  })

  it('updatesDownload passes tag + assetName', async () => {
    const { updatesDownload } = await import('./updates.js')
    invoke.mockResolvedValueOnce({ path: '/tmp/x.dmg' })
    const out = await updatesDownload('v1.0.2', 'hip_1.0.2_aarch64.dmg')
    expect(invoke).toHaveBeenCalledWith('updates_download', {
      tag: 'v1.0.2',
      assetName: 'hip_1.0.2_aarch64.dmg',
    })
    expect(out.path).toBe('/tmp/x.dmg')
  })

  it('cancel / open wrappers map to commands', async () => {
    const mod = await import('./updates.js')
    await mod.updatesCancelDownload()
    expect(invoke).toHaveBeenCalledWith('updates_cancel_download')
    await mod.updatesOpenInstaller('/tmp/x.dmg')
    expect(invoke).toHaveBeenCalledWith('updates_open_installer', { path: '/tmp/x.dmg' })
    await mod.updatesOpenReleasePage('https://github.com/limin411/hip/releases/tag/v1.0.2')
    expect(invoke).toHaveBeenCalledWith('updates_open_release_page', {
      url: 'https://github.com/limin411/hip/releases/tag/v1.0.2',
    })
  })

  it('listeners subscribe to the updates:// event channels', async () => {
    const mod = await import('./updates.js')
    listen.mockResolvedValue(() => {})
    await mod.listenUpdatesProgress(() => {})
    await mod.listenUpdatesAvailable(() => {})
    expect(listen).toHaveBeenCalledWith('updates://progress', expect.any(Function))
    expect(listen).toHaveBeenCalledWith('updates://available', expect.any(Function))
  })
})
