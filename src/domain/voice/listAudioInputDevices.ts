import type { VoiceInputDevice } from './resolveInputDevice'

export type ListAudioInputDevicesResult = {
  devices: VoiceInputDevice[]
  permissionDenied: boolean
}

/**
 * Enumerate audioinput devices. Optionally open (and immediately stop) a short
 * getUserMedia stream so WebView fills stable deviceIds + labels — required to
 * rebind a preferred mic after app restart.
 */
export async function listAudioInputDevices(opts?: {
  unlockPermission?: boolean
  /** Fallback label prefix when the browser withholds device names. */
  unnamedLabel?: (index: number) => string
}): Promise<ListAudioInputDevicesResult> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { devices: [], permissionDenied: false }
  }

  let permissionDenied = false
  if (opts?.unlockPermission && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
        new Promise<never>((_, rej) => {
          setTimeout(() => rej(new Error('mic-permission-timeout')), 2000)
        }),
      ])
      stream.getTracks().forEach((tr) => {
        try {
          tr.stop()
        } catch {
          /* ignore */
        }
      })
    } catch {
      permissionDenied = true
    }
  }

  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    const devices = list
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        id: d.deviceId,
        label:
          d.label?.trim() ||
          (opts?.unnamedLabel
            ? opts.unnamedLabel(i)
            : d.deviceId
              ? `Microphone ${i + 1}`
              : 'Microphone'),
        groupId: d.groupId || undefined,
      }))
      .filter((d) => d.id) // drop empty ids (pre-permission ghosts)
    return { devices, permissionDenied }
  } catch {
    return { devices: [], permissionDenied }
  }
}
