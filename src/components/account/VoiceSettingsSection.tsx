import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import {
  VOICE_LANGUAGES,
  VOICE_MODEL_IDS,
  type VoiceLanguage,
  type VoiceModelId,
} from '@hip/protocol'
import { cn } from '@/lib/utils'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { Switch } from '@/components/ui/Switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { resolveInputDevice, type VoiceInputDevice } from '@/domain/voice/resolveInputDevice'
import {
  useVoiceDownloadStore,
  voiceDownloadProgressPercent,
} from '@/domain/voice/voiceDownloadStore'
import {
  voiceModelStatus,
  voiceOpenModelsDir,
  voiceRuntimeStatus,
  type VoiceModelStatus,
  type VoiceRuntimeStatus,
} from '@/ipc/voice'
import { toast } from 'sonner'

const selectTriggerCls =
  'flex h-8 cursor-pointer items-center justify-between gap-6 rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-2 text-body text-ink-secondary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'

const btnCls =
  'h-8 rounded-md border border-border px-2.5 text-meta text-ink-secondary transition-colors hover:bg-state-hover disabled:cursor-not-allowed disabled:opacity-50'

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

type VoiceStatusKey =
  | 'settings.voice.statusUnknown'
  | 'settings.voice.modelReady'
  | 'settings.voice.modelCorrupt'
  | 'settings.voice.modelMissing'

function statusLabelKey(st: VoiceModelStatus | undefined): VoiceStatusKey {
  if (!st) return 'settings.voice.statusUnknown'
  if (st.ready) return 'settings.voice.modelReady'
  if (st.corrupt) return 'settings.voice.modelCorrupt'
  return 'settings.voice.modelMissing'
}

/**
 * Voice settings body (opt-in; models downloaded here).
 * Used as standalone Settings → Voice page (hideOuterHeading) or embedded.
 */
export function VoiceSettingsSection({
  hideOuterHeading = false,
}: {
  /** When true, skip the in-page h3 (parent page already has a title). */
  hideOuterHeading?: boolean
}) {
  const { t } = useTranslation()
  const voice = useHipConfigStore((s) => s.config.voice)
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const [devices, setDevices] = useState<VoiceInputDevice[]>([])
  const [permissionDenied, setPermissionDenied] = useState(false)
  /** Status map for tiny/base/small after last check. */
  const [modelStatuses, setModelStatuses] = useState<Partial<Record<VoiceModelId, VoiceModelStatus>>>(
    {},
  )
  const [checking, setChecking] = useState(false)
  const [runtime, setRuntime] = useState<VoiceRuntimeStatus | null>(null)
  // Download state lives in a module store so switching Settings pages does not drop it.
  const activeModels = useVoiceDownloadStore((s) => s.activeModels)
  const progressByModel = useVoiceDownloadStore((s) => s.progressByModel)
  const primaryModel = useVoiceDownloadStore((s) => s.primaryModel)
  const startDownload = useVoiceDownloadStore((s) => s.startDownload)
  const cancelDownload = useVoiceDownloadStore((s) => s.cancelDownload)
  const downloading = Object.keys(activeModels).length > 0
  const progress = primaryModel ? (progressByModel[primaryModel] ?? null) : null

  // Opt-in: only true when user explicitly enables.
  const enabled = voice?.enabled === true
  const language = (voice?.language ?? 'auto') as VoiceLanguage
  const model = (voice?.model ?? 'base') as VoiceModelId
  const resolved = resolveInputDevice(
    {
      id: voice?.inputDeviceId,
      label: voice?.inputDeviceLabel,
      groupId: voice?.inputDeviceGroupId,
    },
    devices,
  )
  const activeStatus = modelStatuses[model]

  /** List mics without opening a capture stream (never seize the mic on page load). */
  const listDevicesOnly = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([])
      return
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(
        list
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({
            id: d.deviceId,
            label:
              d.label?.trim() ||
              (d.deviceId
                ? `${t('settings.voice.unnamedDevice')} ${i + 1}`
                : t('settings.voice.unnamedDevice')),
            groupId: d.groupId,
          })),
      )
    } catch {
      setDevices([])
    }
  }, [t])

  /**
   * User-initiated: briefly open mic only to unlock device labels / permission.
   * Always stop tracks immediately so we do not hold the device.
   */
  const refreshDevicesWithPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([])
      return
    }
    if (navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
          new Promise<never>((_, rej) => {
            setTimeout(() => rej(new Error('mic-permission-timeout')), 2000)
          }),
        ])
        stream.getTracks().forEach((tr) => tr.stop())
        setPermissionDenied(false)
      } catch {
        setPermissionDenied(true)
      }
    }
    await listDevicesOnly()
  }, [listDevicesOnly])

  const checkAllModels = useCallback(async () => {
    setChecking(true)
    try {
      const results = await Promise.all(
        VOICE_MODEL_IDS.map(async (id) => {
          try {
            return await voiceModelStatus(id)
          } catch {
            return {
              model: id,
              ready: false,
              approxBytes: undefined,
            } satisfies VoiceModelStatus
          }
        }),
      )
      const next: Partial<Record<VoiceModelId, VoiceModelStatus>> = {}
      for (const st of results) {
        const id = st.model as VoiceModelId
        if (VOICE_MODEL_IDS.includes(id)) next[id] = st
      }
      setModelStatuses(next)
    } finally {
      setChecking(false)
    }
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      setRuntime(await voiceRuntimeStatus())
    } catch {
      setRuntime({
        mock: false,
        binaryAvailable: false,
        voiceEnvDisabled: false,
      })
    }
  }, [])

  // When voice is turned on, load runtime + model statuses (not before — opt-in).
  // Device list uses enumerate only — never getUserMedia on mount (would seize system mic/audio).
  // Download progress is owned by voiceDownloadStore (survives page switch).
  useEffect(() => {
    if (!enabled) return
    void refreshRuntime()
    void checkAllModels()
    void listDevicesOnly()
    const onChange = () => void listDevicesOnly()
    try {
      navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    } catch {
      /* test env */
    }
    return () => {
      try {
        navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
      } catch {
        /* ignore */
      }
    }
  }, [enabled, listDevicesOnly, checkAllModels, refreshRuntime])

  // When a download finishes while this page is mounted, refresh model statuses.
  const wasDownloading = useRef(false)
  useEffect(() => {
    if (!enabled) return
    if (downloading) {
      wasDownloading.current = true
      return
    }
    if (wasDownloading.current) {
      wasDownloading.current = false
      void checkAllModels()
    }
  }, [enabled, downloading, checkAllModels])

  // Re-check selected model after model id change (still only when enabled).
  useEffect(() => {
    if (!enabled) return
    void voiceModelStatus(model)
      .then((st) => setModelStatuses((prev) => ({ ...prev, [model]: st })))
      .catch(() => {})
  }, [enabled, model])

  const rebindDone = useRef(false)
  const resolvedId = resolved.deviceId
  const resolvedStale = resolved.stale
  const resolvedMatched = resolved.matched
  useEffect(() => {
    if (!enabled || rebindDone.current) return
    if (
      resolvedStale &&
      resolvedMatched !== 'default' &&
      resolvedId !== (voice?.inputDeviceId ?? 'default')
    ) {
      rebindDone.current = true
      const dev = devices.find((d) => d.id === resolvedId)
      void updateSection('voice', (prev) => ({
        ...(prev ?? {}),
        inputDeviceId: resolvedId,
        inputDeviceLabel: dev?.label ?? prev?.inputDeviceLabel,
        inputDeviceGroupId: dev?.groupId ?? prev?.inputDeviceGroupId,
      }))
    }
  }, [
    enabled,
    devices,
    resolvedId,
    resolvedMatched,
    resolvedStale,
    updateSection,
    voice?.inputDeviceId,
  ])

  const selectDevice = (id: string) => {
    if (id === 'default') {
      void updateSection('voice', (prev) => ({
        ...(prev ?? {}),
        inputDeviceId: 'default',
        inputDeviceLabel: '',
        inputDeviceGroupId: '',
      }))
      return
    }
    const dev = devices.find((d) => d.id === id)
    void updateSection('voice', (prev) => ({
      ...(prev ?? {}),
      inputDeviceId: id,
      inputDeviceLabel: dev?.label ?? '',
      inputDeviceGroupId: dev?.groupId ?? '',
    }))
  }

  const onDownload = async (id: VoiceModelId = model) => {
    // Dedupe + persistent state live in the store; re-click while in-flight joins the same promise.
    try {
      await startDownload(id)
      toast.success(t('settings.voice.downloadDone'))
      await checkAllModels()
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : String(e)
      if (msg.includes('cancelled')) toast.message(t('settings.voice.downloadCancelled'))
      else if (msg.includes('download_in_progress')) {
        // Another path already owns this download — UI still shows store progress.
        toast.message(t('settings.voice.downloading'))
      } else toast.error(`${t('voice.downloadFailed')}: ${msg}`)
    }
  }

  const onCancelDownload = async () => {
    await cancelDownload(primaryModel ?? model)
  }

  const onCheckStatus = async () => {
    await refreshRuntime()
    await checkAllModels()
    toast.success(t('settings.voice.checkDone'))
  }

  const progressPct = downloading ? voiceDownloadProgressPercent(progress) : null

  const deviceLabel =
    resolved.deviceId === 'default'
      ? t('settings.voice.systemDefault')
      : (devices.find((d) => d.id === resolved.deviceId)?.label ?? t('settings.voice.systemDefault'))

  return (
    <>
      {hideOuterHeading ? null : (
        <div className="px-8 pb-1 pt-5">
          <h3 className="text-meta font-semibold uppercase tracking-wide text-ink-tertiary">
            {t('settings.voice.section')}
          </h3>
          <p className="mt-1 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.voice.sectionHint')}
          </p>
        </div>
      )}

      {/* Master switch — always visible; default off */}
      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-voice-enabled"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.voice.enabled')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.voice.enabledDesc')}
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) =>
            void updateSection('voice', (prev) => ({ ...(prev ?? {}), enabled: v }))
          }
          data-testid="settings-voice-enabled-switch"
        />
      </div>

      {!enabled ? null : (
        <>
          {/* Engine status */}
          <div
            className="flex items-center justify-between gap-6 px-8 py-4"
            data-testid="settings-voice-engine"
          >
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{t('settings.voice.engine')}</div>
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.voice.engineDesc')}
              </div>
              <div className="mt-1 text-meta text-ink-tertiary" data-testid="settings-voice-engine-status">
                {runtime == null
                  ? t('settings.voice.statusChecking')
                  : runtime.mock
                    ? t('settings.voice.engineMock')
                    : runtime.binaryAvailable
                      ? t('settings.voice.engineReady')
                      : t('settings.voice.binaryMissing')}
              </div>
            </div>
          </div>

          {/* Microphone */}
          <div
            className="flex items-center justify-between gap-6 px-8 py-4"
            data-testid="settings-voice-device"
          >
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{t('settings.voice.inputDevice')}</div>
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.voice.inputDeviceDesc')}
              </div>
              {permissionDenied ? (
                <p
                  className="mt-1 text-meta text-amber-600 dark:text-amber-400"
                  data-testid="settings-voice-permission-hint"
                >
                  {t('settings.voice.permissionHint')}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-ink-secondary hover:bg-state-hover"
                onClick={() => void refreshDevicesWithPermission()}
                data-testid="settings-voice-refresh-devices"
                title={t('settings.voice.refresh')}
                aria-label={t('settings.voice.refresh')}
              >
                <RefreshCw size={14} />
              </button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={selectTriggerCls}
                    data-testid="settings-voice-device-trigger"
                  >
                    <span className="max-w-[180px] truncate">{deviceLabel}</span>
                    <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid="settings-voice-device-default"
                    onSelect={() => selectDevice('default')}
                  >
                    <Check
                      size={14}
                      className={cn(
                        'shrink-0',
                        resolved.deviceId === 'default' ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span>{t('settings.voice.systemDefault')}</span>
                  </DropdownMenuItem>
                  {devices.map((d) => (
                    <DropdownMenuItem
                      key={d.id}
                      data-testid="settings-voice-device-item"
                      onSelect={() => selectDevice(d.id)}
                    >
                      <Check
                        size={14}
                        className={cn(
                          'shrink-0',
                          resolved.deviceId === d.id ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="max-w-[220px] truncate">{d.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Language */}
          <div
            className="flex items-center justify-between gap-6 px-8 py-4"
            data-testid="settings-voice-language"
          >
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{t('settings.voice.language')}</div>
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.voice.languageDesc')}
              </div>
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={selectTriggerCls}>
                  <span>{t(`settings.voice.languages.${language}`)}</span>
                  <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {VOICE_LANGUAGES.map((lang) => (
                  <DropdownMenuItem
                    key={lang}
                    onSelect={() =>
                      void updateSection('voice', (prev) => ({ ...(prev ?? {}), language: lang }))
                    }
                  >
                    <Check
                      size={14}
                      className={cn('shrink-0', language === lang ? 'opacity-100' : 'opacity-0')}
                    />
                    <span>{t(`settings.voice.languages.${lang}`)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Active model picker */}
          <div
            className="flex items-center justify-between gap-6 px-8 py-4"
            data-testid="settings-voice-model"
          >
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{t('settings.voice.model')}</div>
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.voice.modelDesc')}
              </div>
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={selectTriggerCls} data-testid="settings-voice-model-trigger">
                  <span>{t(`settings.voice.models.${model}`)}</span>
                  <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {VOICE_MODEL_IDS.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    data-testid={`settings-voice-model-${m}`}
                    onSelect={() =>
                      void updateSection('voice', (prev) => ({ ...(prev ?? {}), model: m }))
                    }
                  >
                    <Check
                      size={14}
                      className={cn('shrink-0', model === m ? 'opacity-100' : 'opacity-0')}
                    />
                    <span>{t(`settings.voice.models.${m}`)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Model download + status panel */}
          <div
            className="mx-8 mb-2 rounded-lg border border-border bg-surface-muted/40 p-4"
            data-testid="settings-voice-model-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-body font-medium text-ink">
                  {t('settings.voice.modelManage')}
                </div>
                <p className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                  {t('settings.voice.modelManageDesc')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnCls}
                  disabled={checking || downloading}
                  onClick={() => void onCheckStatus()}
                  data-testid="settings-voice-check-status"
                >
                  {checking ? t('settings.voice.checking') : t('settings.voice.checkStatus')}
                </button>
                <button
                  type="button"
                  className={btnCls}
                  disabled={downloading}
                  onClick={() => void onDownload(model)}
                  data-testid="settings-voice-download"
                >
                  {downloading
                    ? t('settings.voice.downloading')
                    : activeStatus?.ready
                      ? t('settings.voice.redownload')
                      : t('settings.voice.download')}
                </button>
                {downloading ? (
                  <button
                    type="button"
                    className={btnCls}
                    onClick={() => void onCancelDownload()}
                    data-testid="settings-voice-cancel-download"
                  >
                    {t('settings.voice.cancelDownload')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btnCls}
                  onClick={() =>
                    void voiceOpenModelsDir().catch(() =>
                      toast.error(t('settings.voice.openDirFailed')),
                    )
                  }
                  data-testid="settings-voice-open-models-dir"
                >
                  {t('settings.voice.openModelsDir')}
                </button>
              </div>
            </div>

            {progressPct != null ? (
              <div className="mt-3" data-testid="settings-voice-download-progress">
                <div className="mb-1 flex justify-between text-caption text-ink-tertiary">
                  <span>
                    {t('settings.voice.downloadingModel', { model: progress?.model ?? model })}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            ) : null}

            <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface">
              {VOICE_MODEL_IDS.map((id) => {
                const st = modelStatuses[id]
                const isActive = id === model
                const sizeHint = formatBytes(st?.bytesOnDisk ?? st?.approxBytes)
                return (
                  <li
                    key={id}
                    className={cn(
                      'flex items-center justify-between gap-3 px-3 py-2.5',
                      isActive && 'bg-state-hover/40',
                    )}
                    data-testid={`settings-voice-model-row-${id}`}
                    data-ready={st?.ready ? 'true' : 'false'}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-body text-ink">
                        <span>{t(`settings.voice.models.${id}`)}</span>
                        {isActive ? (
                          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-caption text-ink-tertiary">
                            {t('settings.voice.activeModel')}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="mt-0.5 text-meta text-ink-tertiary"
                        data-testid={`settings-voice-model-status-${id}`}
                      >
                        {checking && !st
                          ? t('settings.voice.statusChecking')
                          : t(statusLabelKey(st), {
                              sizeMb:
                                Math.round((st?.approxBytes ?? 0) / (1024 * 1024)) || '—',
                            })}
                        {st?.ready && st.bytesOnDisk != null
                          ? ` · ${formatBytes(st.bytesOnDisk)}`
                          : !st?.ready && st?.approxBytes
                            ? ` · ~${sizeHint}`
                            : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {activeModels[id] ? (
                        <span
                          className="text-meta text-ink-tertiary"
                          data-testid={`settings-voice-downloading-${id}`}
                        >
                          {t('settings.voice.downloading')}
                        </span>
                      ) : !st?.ready ? (
                        <button
                          type="button"
                          className={btnCls}
                          disabled={downloading}
                          onClick={() => {
                            if (id !== model) {
                              void updateSection('voice', (prev) => ({
                                ...(prev ?? {}),
                                model: id,
                              }))
                            }
                            void onDownload(id)
                          }}
                          data-testid={`settings-voice-download-${id}`}
                        >
                          {t('settings.voice.download')}
                        </button>
                      ) : null}
                      {st?.ready && id !== model ? (
                        <button
                          type="button"
                          className={btnCls}
                          onClick={() =>
                            void updateSection('voice', (prev) => ({
                              ...(prev ?? {}),
                              model: id,
                            }))
                          }
                          data-testid={`settings-voice-use-${id}`}
                        >
                          {t('settings.voice.useModel')}
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>

            <p
              className="mt-2 text-caption leading-relaxed text-ink-tertiary"
              data-testid="settings-voice-model-status"
            >
              {t('settings.voice.selectedStatus', {
                model: t(`settings.voice.models.${model}`),
                status: t(statusLabelKey(activeStatus), {
                  sizeMb: Math.round((activeStatus?.approxBytes ?? 0) / (1024 * 1024)) || '—',
                }),
              })}
            </p>
          </div>
        </>
      )}
    </>
  )
}
