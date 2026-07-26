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

export type PreferredInputDevice = {
  id?: string
  label?: string
  groupId?: string
}

/**
 * Rebind a preferred microphone after restart / hotplug.
 * Order: id → groupId → exact label → fuzzy label → default.
 *
 * When the device list is empty (not yet enumerated / no permission) but a
 * non-default preferred id is stored, keep that id so capture can still try it
 * and the settings UI can show the saved label.
 */
export function resolveInputDevice(
  preferred: PreferredInputDevice,
  devices: VoiceInputDevice[],
): ResolveInputDeviceResult {
  if (!preferred.id || preferred.id === 'default') {
    return { deviceId: 'default', matched: 'default', stale: false }
  }
  if (devices.length === 0) {
    // Optimistic: try the persisted id; UI should still show preferred.label.
    return { deviceId: preferred.id, matched: 'id', stale: false }
  }
  if (devices.some((d) => d.id === preferred.id)) {
    return { deviceId: preferred.id, matched: 'id', stale: false }
  }
  if (preferred.groupId) {
    const byGroup = devices.find((d) => d.groupId && d.groupId === preferred.groupId)
    if (byGroup) return { deviceId: byGroup.id, matched: 'groupId', stale: true }
  }
  if (preferred.label?.trim()) {
    const label = preferred.label.trim()
    const exact = devices.find((d) => d.label === label)
    if (exact) return { deviceId: exact.id, matched: 'label', stale: true }
    // Prefer longer overlap; ignore generic unnamed placeholders.
    const fuzzy = devices.find(
      (d) =>
        d.label &&
        !/^Microphone \d+$/i.test(d.label) &&
        (d.label.includes(label) || label.includes(d.label)),
    )
    if (fuzzy) return { deviceId: fuzzy.id, matched: 'label', stale: true }
  }
  return { deviceId: 'default', matched: 'default', stale: true }
}
