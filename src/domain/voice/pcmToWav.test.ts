// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  encodeWavPcm16Mono,
  resampleToMono16k,
  TARGET_SAMPLE_RATE,
  wavToBase64,
} from './pcmToWav'

function sine48kStereo(seconds: number, hz = 440): Float32Array {
  const sr = 48_000
  const frames = Math.floor(sr * seconds)
  const out = new Float32Array(frames * 2)
  for (let i = 0; i < frames; i++) {
    const s = Math.sin((2 * Math.PI * hz * i) / sr) * 0.5
    out[i * 2] = s
    out[i * 2 + 1] = s
  }
  return out
}

describe('pcmToWav', () => {
  it('encodes 16 kHz mono WAV with correct headers', () => {
    const input = sine48kStereo(0.1)
    const pcm = resampleToMono16k(input, 48_000, 2)
    expect(pcm.length).toBeGreaterThan(100)
    const wav = encodeWavPcm16Mono(pcm)
    const magic = String.fromCharCode(...wav.subarray(0, 4))
    const wave = String.fromCharCode(...wav.subarray(8, 12))
    const fmt = String.fromCharCode(...wav.subarray(12, 16))
    expect(magic).toBe('RIFF')
    expect(wave).toBe('WAVE')
    expect(fmt).toBe('fmt ')
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(pcm.length * 2)
    const b64 = wavToBase64(wav)
    expect(b64.length).toBeGreaterThan(10)
    expect(b64.startsWith('data:')).toBe(false)
  })

  it('identity path when already 16 k mono', () => {
    const frames = 1600
    const input = new Float32Array(frames)
    for (let i = 0; i < frames; i++) input[i] = Math.sin(i / 10) * 0.2
    const pcm = resampleToMono16k(input, 16_000, 1)
    expect(pcm.length).toBe(frames)
  })

  it('empty buffer yields empty pcm', () => {
    expect(resampleToMono16k(new Float32Array(0), 48_000, 1).length).toBe(0)
  })
})
