/**
 * Module-level voice model download state.
 *
 * Survives Settings page unmount (switch away / back) so progress is not lost,
 * and dedupes concurrent downloads of the same model (prevents progress thrash
 * when the user clicks Download again after remounting).
 */
import { create } from 'zustand'
import type { VoiceModelId } from '@hip/protocol'
import {
  listenVoiceDownloadProgress,
  voiceCancelDownload,
  voiceDownloadModel,
  type VoiceDownloadProgress,
} from '@/ipc/voice'

/** Approx sizes when Content-Length is missing (matches voice_models.rs). */
export const VOICE_MODEL_APPROX_BYTES: Record<VoiceModelId, number> = {
  tiny: 77_691_713,
  base: 147_951_465,
  small: 487_601_967,
}

export type VoiceDownloadResult = { path: string }

type VoiceDownloadStore = {
  /** Model ids with an in-flight download. */
  activeModels: Partial<Record<VoiceModelId, true>>
  /** Latest progress per model (monotonic downloaded while phase=downloading). */
  progressByModel: Partial<Record<VoiceModelId, VoiceDownloadProgress>>
  /** Primary model for the progress bar (most recently started still active). */
  primaryModel: VoiceModelId | null
  startDownload: (model: VoiceModelId) => Promise<VoiceDownloadResult>
  cancelDownload: (model?: VoiceModelId) => Promise<void>
  isDownloading: (model?: VoiceModelId) => boolean
  applyProgress: (p: VoiceDownloadProgress) => void
  /** Test helper — clear in-flight map + state. */
  _resetForTests: () => void
}

/** Shared in-flight promises (outside zustand so re-renders never drop them). */
const inflight = new Map<VoiceModelId, Promise<VoiceDownloadResult>>()

let progressListenStarted = false

function ensureProgressListener(): void {
  if (progressListenStarted) return
  progressListenStarted = true
  void listenVoiceDownloadProgress((p) => {
    useVoiceDownloadStore.getState().applyProgress(p)
  }).catch(() => {
    /* non-tauri / test */
  })
}

function isVoiceModelId(id: string): id is VoiceModelId {
  return id === 'tiny' || id === 'base' || id === 'small'
}

export const useVoiceDownloadStore = create<VoiceDownloadStore>((set, get) => ({
  activeModels: {},
  progressByModel: {},
  primaryModel: null,

  applyProgress(p) {
    if (!isVoiceModelId(p.model)) return
    const model = p.model
    const prev = get().progressByModel[model]
    // Ignore out-of-order / concurrent race events (downloaded going backwards).
    if (
      prev &&
      prev.phase === 'downloading' &&
      p.phase === 'downloading' &&
      p.downloaded < prev.downloaded
    ) {
      return
    }
    // Fill total from catalog when the server omitted Content-Length.
    const total =
      p.total && p.total > 0
        ? p.total
        : (prev?.total && prev.total > 0 ? prev.total : VOICE_MODEL_APPROX_BYTES[model])
    const next: VoiceDownloadProgress = {
      ...p,
      total: total ?? p.total,
    }
    set((s) => ({
      progressByModel: { ...s.progressByModel, [model]: next },
      primaryModel: s.activeModels[model] ? model : s.primaryModel,
    }))
  },

  isDownloading(model) {
    const { activeModels } = get()
    if (model) return activeModels[model] === true
    return Object.keys(activeModels).length > 0
  },

  startDownload(model) {
    ensureProgressListener()
    const existing = inflight.get(model)
    if (existing) return existing

    // Register the gate promise BEFORE invoking IPC so concurrent clicks share one flight.
    let resolveGate!: (v: VoiceDownloadResult) => void
    let rejectGate!: (e: unknown) => void
    const gate = new Promise<VoiceDownloadResult>((res, rej) => {
      resolveGate = res
      rejectGate = rej
    })
    inflight.set(model, gate)

    set((s) => ({
      activeModels: { ...s.activeModels, [model]: true },
      primaryModel: model,
      progressByModel: {
        ...s.progressByModel,
        [model]: {
          model,
          downloaded: s.progressByModel[model]?.downloaded ?? 0,
          total: s.progressByModel[model]?.total ?? VOICE_MODEL_APPROX_BYTES[model],
          phase: 'downloading',
        },
      },
    }))

    void voiceDownloadModel(model)
      .then((result) => {
        inflight.delete(model)
        set((s) => {
          const { [model]: _drop, ...restActive } = s.activeModels
          const remaining = Object.keys(restActive) as VoiceModelId[]
          // Keep last progress at ready/100% briefly; page will refresh model status.
          const prev = s.progressByModel[model]
          return {
            activeModels: restActive as Partial<Record<VoiceModelId, true>>,
            progressByModel: {
              ...s.progressByModel,
              [model]: prev
                ? { ...prev, phase: 'ready', downloaded: prev.total ?? prev.downloaded }
                : {
                    model,
                    downloaded: VOICE_MODEL_APPROX_BYTES[model],
                    total: VOICE_MODEL_APPROX_BYTES[model],
                    phase: 'ready',
                  },
            },
            primaryModel:
              s.primaryModel === model ? (remaining[0] ?? null) : s.primaryModel,
          }
        })
        // Drop ready progress after a short tick so the bar does not stick forever.
        setTimeout(() => {
          set((s) => {
            if (s.progressByModel[model]?.phase !== 'ready') return s
            const { [model]: _dropP, ...restProgress } = s.progressByModel
            return { progressByModel: restProgress }
          })
        }, 1500)
        resolveGate(result)
      })
      .catch((err) => {
        inflight.delete(model)
        set((s) => {
          const { [model]: _drop, ...restActive } = s.activeModels
          const remaining = Object.keys(restActive) as VoiceModelId[]
          const prev = s.progressByModel[model]
          // Keep last % with phase=error so the bar does not vanish; partial stays on disk for resume.
          return {
            activeModels: restActive as Partial<Record<VoiceModelId, true>>,
            progressByModel: prev
              ? {
                  ...s.progressByModel,
                  [model]: { ...prev, phase: 'error' },
                }
              : s.progressByModel,
            primaryModel:
              s.primaryModel === model ? (remaining[0] ?? null) : s.primaryModel,
          }
        })
        rejectGate(err)
      })

    return gate
  },

  cancelDownload(model) {
    const id = model ?? get().primaryModel
    if (!id) return Promise.resolve()
    return voiceCancelDownload(id).catch(() => {
      /* ignore */
    })
  },

  _resetForTests() {
    inflight.clear()
    set({ activeModels: {}, progressByModel: {}, primaryModel: null })
  },
}))

/** Non-hook accessor for composer / non-React call sites. */
export function startVoiceModelDownload(model: VoiceModelId): Promise<VoiceDownloadResult> {
  return useVoiceDownloadStore.getState().startDownload(model)
}

export function voiceDownloadProgressPercent(p: VoiceDownloadProgress | null | undefined): number | null {
  if (!p) return null
  const model = isVoiceModelId(p.model) ? p.model : null
  const total =
    p.total && p.total > 0
      ? p.total
      : model
        ? VOICE_MODEL_APPROX_BYTES[model]
        : 0
  if (!total || total <= 0) return null
  if (p.phase === 'hashing' || p.phase === 'ready') return 100
  // error / incomplete: show last known percent (capped)
  return Math.min(99, Math.max(0, Math.round((p.downloaded / total) * 100)))
}

/** Whether the UI should still show the progress bar (active, verifying, or failed mid-way). */
export function shouldShowVoiceDownloadProgress(
  downloading: boolean,
  p: VoiceDownloadProgress | null | undefined,
): boolean {
  if (downloading) return true
  if (!p) return false
  return p.phase === 'hashing' || p.phase === 'ready' || p.phase === 'error' || p.phase === 'downloading'
}

/** Seed UI progress from a `.partial` left on disk (resume). Idempotent. */
export function seedProgressFromPartial(
  model: VoiceModelId,
  partialBytes: number,
  approxBytes?: number,
): void {
  if (partialBytes <= 0) return
  const s = useVoiceDownloadStore.getState()
  if (s.activeModels[model] || s.progressByModel[model]?.phase === 'downloading') return
  const total = approxBytes && approxBytes > 0 ? approxBytes : VOICE_MODEL_APPROX_BYTES[model]
  const prev = s.progressByModel[model]
  if (
    prev &&
    prev.downloaded === partialBytes &&
    (prev.total ?? 0) === total &&
    (prev.phase === 'error' || prev.phase === 'downloading')
  ) {
    return
  }
  useVoiceDownloadStore.setState({
    progressByModel: {
      ...s.progressByModel,
      [model]: {
        model,
        downloaded: partialBytes,
        total,
        phase: 'error', // paused / incomplete — not actively downloading
      },
    },
    primaryModel: s.primaryModel ?? model,
  })
}
