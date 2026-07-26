import {
  encodeWavPcm16Mono,
  resampleToMono16k,
  wavToBase64,
} from './pcmToWav'

export type CaptureHandle = {
  stop: () => Promise<{ wavBase64: string; audioMs: number }>
  cancel: () => void
}

type StartOpts = {
  deviceId: string | 'default'
  maxDurationSec: number
  onLevel?: (rms: number) => void
}

/**
 * Capture mic PCM via AudioContext + ScriptProcessor (wide WebView support).
 * No MediaRecorder — output is always 16 kHz mono WAV base64.
 */
export async function startVoiceCapture(opts: StartOpts): Promise<CaptureHandle> {
  const maxMs = Math.max(5, Math.min(120, opts.maxDurationSec)) * 1000
  const constraints: MediaStreamConstraints = {
    audio:
      opts.deviceId === 'default'
        ? true
        : { deviceId: { exact: opts.deviceId } },
    video: false,
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    if (opts.deviceId !== 'default' && e instanceof DOMException && e.name === 'OverconstrainedError') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } else {
      throw e
    }
  }

  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaStreamSource(stream)
  const channels = Math.max(1, source.channelCount || 1)
  // ScriptProcessor is deprecated but works in Tauri WKWebView without worklet packaging.
  const bufferSize = 4096
  const processor = audioCtx.createScriptProcessor(bufferSize, channels, 1)
  const chunks: Float32Array[] = []
  let cancelled = false
  let stopped = false
  const startedAt = performance.now()

  processor.onaudioprocess = (ev) => {
    if (cancelled || stopped) return
    const input = ev.inputBuffer
    const frames = input.length
    const chCount = input.numberOfChannels
    const interleaved = new Float32Array(frames * chCount)
    for (let c = 0; c < chCount; c++) {
      const data = input.getChannelData(c)
      for (let i = 0; i < frames; i++) interleaved[i * chCount + c] = data[i]!
    }
    chunks.push(interleaved)
    if (opts.onLevel) {
      let sum = 0
      const mono = input.getChannelData(0)
      for (let i = 0; i < mono.length; i++) sum += mono[i]! * mono[i]!
      opts.onLevel(Math.sqrt(sum / Math.max(1, mono.length)))
    }
    if (performance.now() - startedAt >= maxMs) {
      // Auto-stop path is handled by caller max timer; keep collecting until stop/cancel.
    }
  }

  source.connect(processor)
  processor.connect(audioCtx.destination)

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
      const sampleRate = audioCtx.sampleRate
      const chCount = Math.max(1, source.channelCount || channels)
      teardownTracks()
      const totalLen = chunks.reduce((n, c) => n + c.length, 0)
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
