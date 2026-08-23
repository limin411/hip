// src/store/updatesStore.ts
// Single writer for update-check state (KD-13 contract): GeneralSettings and
// WindowLifecycleHost READ via selectors; nothing keeps a second copy of
// lastResult / progress in component useState.
import { create } from 'zustand'
import type {
  AppVersionInfo,
  UpdateCheckResult,
  UpdateProgress,
} from '@/ipc/updates'

interface UpdatesState {
  appInfo: AppVersionInfo | null
  /** Latest check result (manual, mount hydration, or wake-loop event). */
  lastResult: UpdateCheckResult | null
  /** Latest download progress (kept even after the settings page unmounts). */
  progress: UpdateProgress | null
  checking: boolean
  setAppInfo: (info: AppVersionInfo) => void
  setLastResult: (r: UpdateCheckResult) => void
  setProgress: (p: UpdateProgress) => void
  setChecking: (v: boolean) => void
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  appInfo: null,
  lastResult: null,
  progress: null,
  checking: false,
  setAppInfo: (appInfo) => set({ appInfo }),
  setLastResult: (lastResult) => set({ lastResult }),
  setProgress: (progress) => set({ progress }),
  setChecking: (checking) => set({ checking }),
}))
