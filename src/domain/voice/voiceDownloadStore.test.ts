import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useVoiceDownloadStore,
  voiceDownloadProgressPercent,
  startVoiceModelDownload,
} from './voiceDownloadStore'

const voiceDownloadModel = vi.fn()
const voiceCancelDownload = vi.fn()
const listenVoiceDownloadProgress = vi.fn().mockResolvedValue(() => {})

vi.mock('@/ipc/voice', () => ({
  voiceDownloadModel: (...a: unknown[]) => voiceDownloadModel(...a),
  voiceCancelDownload: (...a: unknown[]) => voiceCancelDownload(...a),
  listenVoiceDownloadProgress: (...a: unknown[]) => listenVoiceDownloadProgress(...a),
}))

describe('voiceDownloadStore', () => {
  beforeEach(() => {
    useVoiceDownloadStore.getState()._resetForTests()
    voiceDownloadModel.mockReset()
    voiceCancelDownload.mockReset()
    listenVoiceDownloadProgress.mockClear()
  })

  it('keeps progress after “unmount” (module state) and dedupes same-model start', async () => {
    let resolveDl!: (v: { path: string }) => void
    voiceDownloadModel.mockImplementation(
      () =>
        new Promise<{ path: string }>((res) => {
          resolveDl = res
        }),
    )

    const p1 = startVoiceModelDownload('base')
    expect(useVoiceDownloadStore.getState().isDownloading('base')).toBe(true)
    expect(useVoiceDownloadStore.getState().primaryModel).toBe('base')

    // Progress event while “away from page”
    useVoiceDownloadStore.getState().applyProgress({
      model: 'base',
      downloaded: 50_000_000,
      total: 147_951_465,
      phase: 'downloading',
    })
    expect(useVoiceDownloadStore.getState().progressByModel.base?.downloaded).toBe(50_000_000)

    // Second click joins the same promise — no second IPC invoke
    const p2 = startVoiceModelDownload('base')
    expect(voiceDownloadModel).toHaveBeenCalledTimes(1)
    expect(p1).toBe(p2)

    // Out-of-order progress must not regress the bar
    useVoiceDownloadStore.getState().applyProgress({
      model: 'base',
      downloaded: 10_000_000,
      total: 147_951_465,
      phase: 'downloading',
    })
    expect(useVoiceDownloadStore.getState().progressByModel.base?.downloaded).toBe(50_000_000)

    resolveDl({ path: '/tmp/ggml-base.bin' })
    await expect(p1).resolves.toEqual({ path: '/tmp/ggml-base.bin' })
    expect(useVoiceDownloadStore.getState().isDownloading()).toBe(false)
    // Success keeps a short-lived ready progress so the bar does not vanish mid-verify.
    expect(useVoiceDownloadStore.getState().progressByModel.base?.phase).toBe('ready')
  })

  it('keeps last percent on error so resume is visible', async () => {
    voiceDownloadModel.mockRejectedValue(new Error('voice.network:timeout'))
    useVoiceDownloadStore.getState().applyProgress({
      model: 'tiny',
      downloaded: 40_000_000,
      total: 77_691_713,
      phase: 'downloading',
    })
    // Manually seed active + inflight via startDownload
    const p = startVoiceModelDownload('tiny')
    useVoiceDownloadStore.getState().applyProgress({
      model: 'tiny',
      downloaded: 40_000_000,
      total: 77_691_713,
      phase: 'downloading',
    })
    await expect(p).rejects.toThrow(/network/)
    const prog = useVoiceDownloadStore.getState().progressByModel.tiny
    expect(prog?.phase).toBe('error')
    expect(prog?.downloaded).toBe(40_000_000)
  })

  it('voiceDownloadProgressPercent uses approx when total missing', () => {
    const pct = voiceDownloadProgressPercent({
      model: 'tiny',
      downloaded: 38_845_856,
      phase: 'downloading',
    })
    expect(pct).toBe(50)
  })

  it('caps downloading phase below 100 until hashing/ready', () => {
    expect(
      voiceDownloadProgressPercent({
        model: 'tiny',
        downloaded: 77_691_713,
        total: 77_691_713,
        phase: 'downloading',
      }),
    ).toBe(99)
    expect(
      voiceDownloadProgressPercent({
        model: 'tiny',
        downloaded: 77_691_713,
        total: 77_691_713,
        phase: 'ready',
      }),
    ).toBe(100)
  })
})
