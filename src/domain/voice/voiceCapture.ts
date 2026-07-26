import {
  encodeWavPcm16Mono,
  resampleToMono16k,
  wavToBase64,
} from './pcmToWav'

export type CaptureHandle = {
  stop: () => Promise<{ wavBase64: string; audioMs: number }>
  cancel: () => void
  /** Current input RMS 0..1 (updated while recording). */
  getLevel: () => number
  /** deviceId from the opened MediaStreamTrack settings when available. */
  openedDeviceId: string
  /** True when preferred exact device failed and system default was used. */
  preferredUnavailable: boolean
}

type StartOpts = {
  deviceId: string | 'default'
  maxDurationSec: number
  onLevel?: (rms: number) => void
  /**
   * When exact deviceId fails (common after restart when WebView rotates ids),
   * try these as soft ideal before falling back to system default.
   */
  fallbackDeviceIds?: string[]
}

/**
 * Capture mic PCM via AudioContext + ScriptProcessor (wide WebView support).
 * No MediaRecorder — output is always 16 kHz mono WAV base64.
 *
 * Important for Tauri/WKWebView:
 * - AudioContext often starts suspended → must resume()
 * - Do not route processor to speakers (uses silent GainNode) so opening mic
 *   does not play through speakers / seize output as hard.
 */
export async function startVoiceCapture(opts: StartOpts): Promise<CaptureHandle> {
  const maxMs = Math.max(5, Math.min(120, opts.maxDurationSec)) * 1000
  const audioBase = { echoCancellation: true, noiseSuppression: true } as const

  let stream: MediaStream
  let preferredUnavailable = false
  const requested = opts.deviceId || 'default'

  const open = async (audio: MediaTrackConstraints | true) =>
    navigator.mediaDevices.getUserMedia({ audio, video: false })

  try {
    if (requested === 'default') {
      stream = await open({ ...audioBase })
    } else {
      stream = await open({
        ...audioBase,
        deviceId: { exact: requested },
      })
    }
  } catch (e) {
    const overconstrained =
      e instanceof DOMException &&
      (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')
    if (requested === 'default' || !overconstrained) throw e

    // Try soft ideal on the same id, then alternate ids (rebind targets), then default.
    const candidates = [
      requested,
      ...(opts.fallbackDeviceIds ?? []).filter((id) => id && id !== requested && id !== 'default'),
    ]
    let opened: MediaStream | null = null
    for (const id of candidates) {
      try {
        opened = await open({
          ...audioBase,
          deviceId: { ideal: id },
        })
        // ideal may still pick another device; accept if we got a stream.
        break
      } catch {
        /* try next */
      }
    }
    if (!opened) {
      opened = await open({ ...audioBase })
      preferredUnavailable = true
    } else {
      const actual = opened.getAudioTracks()[0]?.getSettings?.()?.deviceId
      if (actual && actual !== requested && !candidates.includes(actual)) {
        preferredUnavailable = true
      }
    }
    stream = opened
  }

  const openedDeviceId =
    stream.getAudioTracks()[0]?.getSettings?.()?.deviceId ||
    (requested === 'default' ? 'default' : requested)

  const audioCtx = new AudioContext()
  // WKWebView / Chromium autoplay policy: context starts suspended until resume.
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume()
    } catch {
      /* continue; may still get zeros */
    }
  }

  const source = audioCtx.createMediaStreamSource(stream)
  const channels = Math.max(1, source.channelCount || 1)
  // ScriptProcessor is deprecated but works in Tauri WKWebView without worklet packaging.
  const bufferSize = 4096
  const processor = audioCtx.createScriptProcessor(bufferSize, channels, 1)
  // Silent sink so onaudioprocess fires without playing mic through speakers.
  const mute = audioCtx.createGain()
  mute.gain.value = 0

  const chunks: Float32Array[] = []
  let cancelled = false
  let stopped = false
  let lastLevel = 0
  let processChannels = channels
  const startedAt = performance.now()

  processor.onaudioprocess = (ev) => {
    if (cancelled || stopped) return
    const input = ev.inputBuffer
    const frames = input.length
    const chCount = input.numberOfChannels
    processChannels = chCount
    const interleaved = new Float32Array(frames * chCount)
    for (let c = 0; c < chCount; c++) {
      const data = input.getChannelData(c)
      for (let i = 0; i < frames; i++) interleaved[i * chCount + c] = data[i]!
    }
    chunks.push(interleaved)
    let sum = 0
    const mono = input.getChannelData(0)
    for (let i = 0; i < mono.length; i++) sum += mono[i]! * mono[i]!
    lastLevel = Math.sqrt(sum / Math.max(1, mono.length))
    opts.onLevel?.(lastLevel)
    if (performance.now() - startedAt >= maxMs) {
      // Auto-stop path is handled by caller max timer.
    }
  }

  source.connect(processor)
  processor.connect(mute)
  mute.connect(audioCtx.destination)

  const teardownTracks = () => {
    try {
      processor.disconnect()
    } catch {
      /* ignore */
    }
    try {
      source.disconnect()
    } catch {
      /* ignore */
    }
    try {
      mute.disconnect()
    } catch {
      /* ignore */
    }
    void audioCtx.close().catch(() => {})
    for (const t of stream.getTracks()) {
      try {
        t.stop()
      } catch {
        /* ignore */
      }
    }
  }

  return {
    getLevel: () => lastLevel,
    openedDeviceId,
    preferredUnavailable,
    cancel: () => {
      if (cancelled || stopped) return
      cancelled = true
      chunks.length = 0
      teardownTracks()
    },
    stop: async () => {
      if (cancelled) {
        return { wavBase64: '', audioMs: 0 }
      }
      stopped = true
      // Ensure any pending graph work flushes one more quantum.
      if (audioCtx.state === 'running') {
        await new Promise((r) => setTimeout(r, 30))
      }
      const sampleRate = audioCtx.sampleRate || 48_000
      const chCount = Math.max(1, processChannels || channels)
      teardownTracks()
      const totalLen = chunks.reduce((n, c) => n + c.length, 0)
      if (totalLen === 0) {
        return { wavBase64: '', audioMs: 0 }
      }
      const merged = new Float32Array(totalLen)
      let o = 0
      for (const c of chunks) {
        merged.set(c, o)
        o += c.length
      }
      chunks.length = 0
      const pcm = resampleToMono16k(merged, sampleRate, chCount)
      const audioMs = Math.round((pcm.length / 16_000) * 1000)
      const wav = encodeWavPcm16Mono(pcm)
      const wavBase64 = wavToBase64(wav)
      return { wavBase64, audioMs }
    },
  }
}
