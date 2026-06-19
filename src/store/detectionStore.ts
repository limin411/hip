import { create } from 'zustand'
import { detectBinaries } from '@/ipc/detect'
import { ACP_PRESETS } from '@/lib/acpPresets'

/** All executable names worth probing: each preset's primary + legacy detect binary. */
function detectNames(): string[] {
  const s = new Set<string>()
  for (const p of ACP_PRESETS as Array<{ detectBin?: string; legacyBin?: string }>) {
    if (p.detectBin) s.add(p.detectBin)
    if (p.legacyBin) s.add(p.legacyBin)
  }
  return [...s]
}

interface DetectionStore {
  installed: Record<string, boolean>
  checked: boolean
  refresh: () => Promise<void>
}

export const useDetectionStore = create<DetectionStore>((set) => ({
  installed: {},
  checked: false,
  refresh: async () => {
    const installed = await detectBinaries(detectNames())
    set({ installed, checked: true })
  },
}))
