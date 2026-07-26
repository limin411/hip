export type VoiceInputDevice = {
  id: string
  label: string
  groupId?: string
}

export type ResolveInputDeviceResult = {
  deviceId: string
  matched: 'id' | 'groupId' | 'label' | 'default'
  stale: boolean
}

/**
 * Rebind a preferred microphone after restart / hotplug.
 * Order: id → groupId → exact label → fuzzy label → default.
 */
export function resolveInputDevice(
  preferred: { id?: string; label?: string; groupId?: string },
  devices: VoiceInputDevice[],
): ResolveInputDeviceResult {
  if (!preferred.id || preferred.id === 'default') {
    return { deviceId: 'default', matched: 'default', stale: false }
  }
  if (devices.some((d) => d.id === preferred.id)) {
    return { deviceId: preferred.id, matched: 'id', stale: false }
  }
  if (preferred.groupId) {
    const byGroup = devices.find((d) => d.groupId && d.groupId === preferred.groupId)
    if (byGroup) return { deviceId: byGroup.id, matched: 'groupId', stale: true }
  }
  if (preferred.label?.trim()) {
    const label = preferred.label
    const exact = devices.find((d) => d.label === label)
    if (exact) return { deviceId: exact.id, matched: 'label', stale: true }
    const fuzzy = devices.find(
      (d) =>
        d.label &&
        (d.label.includes(label) || label.includes(d.label)),
    )
    if (fuzzy) return { deviceId: fuzzy.id, matched: 'label', stale: true }
  }
  return { deviceId: 'default', matched: 'default', stale: true }
}
