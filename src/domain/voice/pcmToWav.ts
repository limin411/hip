/** Pure PCM → 16 kHz mono WAV helpers (no DOM). */

export const TARGET_SAMPLE_RATE = 16_000

function floatToInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample))
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
}

/**
 * Mix multi-channel Float32 to mono and linear-resample to 16 kHz Int16 LE.
 * `input` is interleaved if channels > 1.
 */
export function resampleToMono16k(
  input: Float32Array,
  inputSampleRate: number,
  channels: number,
): Int16Array {
  const ch = Math.max(1, channels | 0)
  const inFrames = Math.floor(input.length / ch)
  if (inFrames <= 0) return new Int16Array(0)

  const mono = new Float32Array(inFrames)
  if (ch === 1) {
    mono.set(input.subarray(0, inFrames))
  } else {
    for (let i = 0; i < inFrames; i++) {
      let sum = 0
      for (let c = 0; c < ch; c++) sum += input[i * ch + c] ?? 0
      mono[i] = sum / ch
    }
  }

  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    const out = new Int16Array(inFrames)
    for (let i = 0; i < inFrames; i++) out[i] = floatToInt16(mono[i]!)
    return out
  }

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outFrames = Math.max(0, Math.floor(inFrames / ratio))
  const out = new Int16Array(outFrames)
  for (let i = 0; i < outFrames; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, inFrames - 1)
    const t = src - i0
    const s = (mono[i0] ?? 0) * (1 - t) + (mono[i1] ?? 0) * t
    out[i] = floatToInt16(s)
  }
  return out
}

/** Build RIFF/WAVE bytes: PCM 16-bit mono. */
export function encodeWavPcm16Mono(
  pcm: Int16Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
): Uint8Array {
  const dataSize = pcm.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  let o = 44
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(o, pcm[i]!, true)
    o += 2
  }
  return new Uint8Array(buffer)
}

export function wavToBase64(wav: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < wav.length; i += chunk) {
    const sub = wav.subarray(i, Math.min(i + chunk, wav.length))
    binary += String.fromCharCode(...sub)
  }
  return btoa(binary)
}
