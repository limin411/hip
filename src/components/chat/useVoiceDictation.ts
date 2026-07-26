import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { VOICE_MODEL_IDS, type VoiceLanguage, type VoiceModelId } from '@hip/protocol'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { appendTranscript } from '@/domain/voice/appendTranscript'
import { listAudioInputDevices } from '@/domain/voice/listAudioInputDevices'
import { startVoiceCapture, type CaptureHandle } from '@/domain/voice/voiceCapture'
import { resolveInputDevice } from '@/domain/voice/resolveInputDevice'
import { startVoiceModelDownload } from '@/domain/voice/voiceDownloadStore'
import { voiceModelStatus, voiceRuntimeStatus, voiceTranscribe } from '@/ipc/voice'

export type VoiceMicState = 'idle' | 'recording' | 'transcribing' | 'unavailable' | 'downloading'

const MIN_AUDIO_MS = 400

export function useVoiceDictation(opts: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement>
}) {
  const { t } = useTranslation()
  const voiceCfg = useHipConfigStore((s) => s.config.voice)
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const paletteOpen = useCommandPaletteStore((s) => s.open)
  // Opt-in: Settings → Voice must be explicitly enabled (default off).
  const enabled = voiceCfg?.enabled === true
  const model = (voiceCfg?.model ?? 'base') as VoiceModelId
  const language = (voiceCfg?.language ?? 'auto') as VoiceLanguage
  const maxDurationSec = Math.max(5, Math.min(120, voiceCfg?.maxDurationSec ?? 60))
  const [state, setState] = useState<VoiceMicState>('idle')
  const [envDisabled, setEnvDisabled] = useState(false)
  const [binaryOk, setBinaryOk] = useState(true)
  const captureRef = useRef<CaptureHandle | null>(null)
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Model id resolved at record-start (may fall back from base→tiny). */
  const activeModelRef = useRef<VoiceModelId>(model)

  useEffect(() => {
    let cancelled = false
    void voiceRuntimeStatus()
      .then((st) => {
        if (cancelled) return
        setEnvDisabled(st.voiceEnvDisabled)
        setBinaryOk(st.binaryAvailable || st.mock)
      })
      .catch(() => {
        if (!cancelled) setBinaryOk(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const cleanupCapture = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
    captureRef.current?.cancel()
    captureRef.current = null
  }, [])

  useEffect(() => () => cleanupCapture(), [cleanupCapture])

  const finishAndTranscribe = useCallback(async () => {
    const cap = captureRef.current
    captureRef.current = null
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
    if (!cap) {
      setState('idle')
      return
    }
    setState('transcribing')
    try {
      const { wavBase64, audioMs } = await cap.stop()
      if (audioMs < MIN_AUDIO_MS || !wavBase64) {
        toast.message(t('voice.tooShort'))
        setState('idle')
        return
      }
      const result = await voiceTranscribe({
        wavBase64,
        language,
        model: activeModelRef.current,
      })
      const text = result.text?.trim() ?? ''
      if (!text) {
        toast.message(t('voice.emptyTranscript'))
      } else {
        opts.onChange(appendTranscript(opts.value, text))
        queueMicrotask(() => opts.inputRef?.current?.focus())
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : String(e)
      if (msg.includes('binary_missing')) toast.error(t('voice.binaryMissing'))
      else if (msg.includes('model_missing')) toast.error(t('voice.modelMissing'))
      else if (msg.includes('payload_too_large')) toast.error(t('voice.payloadTooLarge'))
      else if (msg.includes('spawn_failed')) toast.error(t('voice.binaryMissing'))
      else if (msg.includes('timeout')) toast.error(t('voice.transcribeTimeout'))
      else toast.error(`${t('voice.transcribeFailed')}${msg ? `: ${msg}` : ''}`)
    } finally {
      setState('idle')
    }
  }, [language, opts, t])

  const startRecording = useCallback(async () => {
    if (opts.disabled || !enabled || envDisabled) return
    if (paletteOpen) return

    setState('idle')
    try {
      const runtime = await voiceRuntimeStatus()
      if (runtime.voiceEnvDisabled) {
        setEnvDisabled(true)
        return
      }
      if (!runtime.binaryAvailable && !runtime.mock) {
        toast.error(t('voice.binaryMissing'))
        setState('unavailable')
        return
      }
      setBinaryOk(true)

      // Prefer configured model; if missing, use any ready local model (e.g. tiny while UI still base).
      let useModel = model
      let st = await voiceModelStatus(model, { verify: false })
      if (!st.ready) {
        for (const id of VOICE_MODEL_IDS) {
          if (id === model) continue
          const alt = await voiceModelStatus(id, { verify: false })
          if (alt.ready) {
            useModel = id
            st = alt
            void updateSection('voice', (prev) => ({ ...(prev ?? {}), model: id }))
            toast.message(t('voice.modelFallback', { model: id }))
            break
          }
        }
      }
      if (!st.ready) {
        if (st.corrupt) {
          toast.error(t('voice.modelCorrupt'))
          return
        }
        const ok = window.confirm(
          t('voice.downloadConfirm', {
            model: useModel,
            sizeMb: Math.round((st.approxBytes ?? 150_000_000) / (1024 * 1024)),
          }),
        )
        if (!ok) return
        setState('downloading')
        try {
          await startVoiceModelDownload(useModel)
        } catch {
          toast.error(t('voice.downloadFailed'))
          setState('idle')
          return
        }
      }

      activeModelRef.current = useModel

      // Rebind preferred mic after restart: match id → groupId → label.
      // Only unlock permission when the stored id is missing (ids often rotate
      // across WebView restarts until getUserMedia has run once).
      const preferred = {
        id: voiceCfg?.inputDeviceId,
        label: voiceCfg?.inputDeviceLabel,
        groupId: voiceCfg?.inputDeviceGroupId,
      }
      const wantsPreferred = Boolean(preferred.id && preferred.id !== 'default')
      let { devices: inputs } = await listAudioInputDevices()
      let resolved = resolveInputDevice(preferred, inputs)
      if (
        wantsPreferred &&
        (inputs.length === 0 ||
          resolved.matched === 'default' ||
          !inputs.some((d) => d.id === preferred.id))
      ) {
        const again = await listAudioInputDevices({ unlockPermission: true })
        inputs = again.devices
        resolved = resolveInputDevice(preferred, inputs)
      }
      const deviceId = resolved.deviceId || 'default'
      // Other live ids to try if exact preferred id rotated after restart.
      const fallbackDeviceIds = inputs
        .filter((d) => d.id !== deviceId)
        .filter((d) => {
          if (preferred.groupId && d.groupId === preferred.groupId) return true
          const lab = preferred.label?.trim()
          if (lab && d.label && (d.label === lab || d.label.includes(lab) || lab.includes(d.label))) {
            return true
          }
          return false
        })
        .map((d) => d.id)

      const handle = await startVoiceCapture({
        deviceId,
        fallbackDeviceIds,
        maxDurationSec,
      })
      captureRef.current = handle

      // Persist rebind / refresh device identity so next cold start matches faster.
      // Never clear a saved preference when we had to fall back to system default.
      if (!handle.preferredUnavailable) {
        const opened = handle.openedDeviceId
        const dev =
          (opened && inputs.find((d) => d.id === opened)) ||
          (resolved.matched !== 'default' ? inputs.find((d) => d.id === resolved.deviceId) : undefined)
        const nextId = opened && opened !== 'default' ? opened : resolved.deviceId
        if (nextId && nextId !== 'default') {
          const nextLabel = dev?.label || preferred.label || ''
          const nextGroup = dev?.groupId || preferred.groupId || ''
          if (
            nextId !== preferred.id ||
            (nextLabel && nextLabel !== preferred.label) ||
            (nextGroup && nextGroup !== preferred.groupId)
          ) {
            void updateSection('voice', (prev) => ({
              ...(prev ?? {}),
              inputDeviceId: nextId,
              inputDeviceLabel: nextLabel || prev?.inputDeviceLabel,
              inputDeviceGroupId: nextGroup || prev?.inputDeviceGroupId,
            }))
          }
        }
      } else if (wantsPreferred) {
        toast.message(t('voice.deviceFallback'))
      }

      setState('recording')
      maxTimerRef.current = setTimeout(() => {
        void finishAndTranscribe()
      }, maxDurationSec * 1000)
    } catch (e) {
      cleanupCapture()
      setState('idle')
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        toast.error(t('voice.permissionDenied'))
      } else {
        toast.error(t('voice.captureFailed'))
      }
    }
  }, [
    cleanupCapture,
    enabled,
    envDisabled,
    finishAndTranscribe,
    maxDurationSec,
    model,
    opts.disabled,
    paletteOpen,
    t,
    updateSection,
    voiceCfg?.inputDeviceGroupId,
    voiceCfg?.inputDeviceId,
    voiceCfg?.inputDeviceLabel,
  ])

  const cancelRecording = useCallback(() => {
    cleanupCapture()
    setState('idle')
  }, [cleanupCapture])

  const toggle = useCallback(() => {
    if (opts.disabled || !enabled || envDisabled) return
    if (state === 'recording') {
      void finishAndTranscribe()
      return
    }
    if (state === 'transcribing' || state === 'downloading') return
    void startRecording()
  }, [enabled, envDisabled, finishAndTranscribe, opts.disabled, startRecording, state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state === 'recording') {
        e.preventDefault()
        e.stopPropagation()
        cancelRecording()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        if (paletteOpen || opts.disabled) return
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cancelRecording, opts.disabled, paletteOpen, state, toggle])

  const micDisabled =
    !!opts.disabled || !enabled || envDisabled || state === 'transcribing' || state === 'downloading'

  const dataState: VoiceMicState =
    !enabled || envDisabled ? 'unavailable' : !binaryOk && state === 'idle' ? 'unavailable' : state

  return {
    state: dataState,
    toggle,
    cancelRecording,
    micDisabled,
    enabled: enabled && !envDisabled,
  }
}
