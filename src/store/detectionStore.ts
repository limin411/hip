import { create } from 'zustand'
import { detectBinaries } from '@/ipc/detect'
import { acpDetectNames } from '@/lib/acpPresets'

interface DetectionStore {
  installed: Record<string, boolean>
  checked: boolean
  refresh: () => Promise<void>
}

export const useDetectionStore = create<DetectionStore>((set) => ({
  installed: {},
  checked: false,
  refresh: async () => {
    const installed = await detectBinaries(acpDetectNames())
    set({ installed, checked: true })
  },
}))
