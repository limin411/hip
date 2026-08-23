// Settings → 更新检查 (Version & updates): current version, GitHub latest
// check, download+verify+open-installer flow, and the auto-check toggle.
// Formerly a block inside GeneralSettings; moved to a dedicated settings page.
// updatesStore remains the single writer for lastResult / progress (KD-13).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { Switch } from '@/components/ui/Switch'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { toast } from 'sonner'
import { useUpdatesStore } from '@/store/updatesStore'
import {
  updatesAppInfo as fetchAppInfo,
  updatesCheck as runCheck,
  updatesCancelDownload as cancelDownload,
  updatesDownload as startDownload,
  updatesOpenInstaller as openInstaller,
  updatesOpenReleasePage as openReleasePage,
} from '@/ipc/updates'

export function UpdatesSettings() {
  const { t } = useTranslation()
  const updateSection = useHipConfigStore((s) => s.updateSection)

  const appInfo = useUpdatesStore((s) => s.appInfo)
  const lastResult = useUpdatesStore((s) => s.lastResult)
  const progress = useUpdatesStore((s) => s.progress)
  const checking = useUpdatesStore((s) => s.checking)
  const setAppInfo = useUpdatesStore((s) => s.setAppInfo)
  const setLastResult = useUpdatesStore((s) => s.setLastResult)
  const setChecking = useUpdatesStore((s) => s.setChecking)
  const autoCheck = useHipConfigStore((s) => s.config.updates?.autoCheck === true)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [readyPath, setReadyPath] = useState<string | null>(null)
  const [retryLeft, setRetryLeft] = useState(0)

  // Mount hydration: app info + a TTL-cached check (never blocks the page).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const info = await fetchAppInfo()
      if (cancelled) return
      setAppInfo(info)
      const result = await runCheck(false)
      if (cancelled) return
      setLastResult(result)
    })()
    return () => {
      cancelled = true
    }
  }, [setAppInfo, setLastResult])

  // 429 cooldown: keep the check button disabled for retryAfterSec.
  useEffect(() => {
    const sec = lastResult?.status === 'error' ? lastResult.retryAfterSec : undefined
    if (!sec || sec <= 0) return
    setRetryLeft(sec)
    const id = setInterval(() => setRetryLeft((n) => (n <= 1 ? 0 : n - 1)), 1000)
    return () => clearInterval(id)
  }, [lastResult])

  const onCheck = async () => {
    setChecking(true)
    try {
      setLastResult(await runCheck(true))
    } catch {
      // IPC failure — keep the previous result.
    } finally {
      setChecking(false)
    }
  }

  const onAutoToggle = (next: boolean) => {
    void updateSection('updates', (prev) => ({ ...(prev ?? {}), autoCheck: next }))
    if (next) {
      // One immediate non-forced check (command path — never emits).
      void runCheck(false).then((r) => useUpdatesStore.getState().setLastResult(r))
    }
  }

  const doDownload = async () => {
    const asset = lastResult?.asset
    if (!asset || !lastResult?.latestTag) return
    setReadyPath(null)
    try {
      const { path } = await startDownload(lastResult.latestTag, asset.name)
      setReadyPath(path)
    } catch {
      // The terminal updates://progress event carries the error for the UI.
    }
  }

  const onOpenInstaller = async () => {
    if (!readyPath) return
    try {
      await openInstaller(readyPath)
      toast.success(t('settings.updates.opened'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const onOpenRelease = () => {
    const url = lastResult?.htmlUrl
    if (url) void openReleasePage(url)
  }

  const formatSize = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
    const mb = bytes / (1024 * 1024)
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  const formatCheckedAt = (iso: string): string => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  }

  const statusText = (() => {
    if (checking) return t('settings.updates.checking')
    if (progress) {
      switch (progress.phase) {
        case 'downloading': {
          const pct =
            progress.total && progress.total > 0
              ? ` ${Math.round((progress.downloaded / progress.total) * 100)}%`
              : ''
          return `${t('settings.updates.downloading', { name: progress.assetName })}${pct}`
        }
        case 'verifying':
          return t('settings.updates.verifying')
        case 'ready':
          return t('settings.updates.ready')
        case 'error':
          return progress.errorKind === 'hash'
            ? t('settings.updates.errorHash')
            : t('settings.updates.errorHttp', { status: progress.errorKind ?? '' })
        case 'cancelled':
          break // fall through to the check-result line
      }
    }
    if (!lastResult) return t('settings.updates.idle')
    switch (lastResult.status) {
      case 'up_to_date':
        return t('settings.updates.upToDate')
      case 'current_ahead':
        return t('settings.updates.ahead')
      case 'update_available':
        return t('settings.updates.available', {
          tag: lastResult.latestTag ?? '',
          date: lastResult.publishedAt ? formatCheckedAt(lastResult.publishedAt) : '',
        })
      case 'no_matching_asset':
        return t('settings.updates.noAsset', {
          tag: lastResult.latestTag ?? '',
          os: appInfo?.os ?? '',
          arch: appInfo?.arch ?? '',
        })
      case 'error':
        switch (lastResult.errorKind) {
          case 'rate_limit':
            return t('settings.updates.errorRateLimit')
          case 'http':
            return t('settings.updates.errorHttp', { status: lastResult.errorMessage ?? '' })
          case 'parse':
            return t('settings.updates.errorParse')
          case 'host':
            return t('settings.updates.errorHost')
          default:
            return t('settings.updates.errorNetwork')
        }
    }
  })()

  const statusDanger = Boolean(
    !checking &&
      (lastResult?.status === 'error' ||
        (progress?.phase === 'error' && progress.errorKind !== 'cancelled')),
  )

  const devBlocked = Boolean(appInfo?.debugBuild)
  const hasAsset = lastResult?.status === 'update_available' && !!lastResult.asset
  const canInstall =
    hasAsset && !!lastResult?.asset?.sha256 && !devBlocked && progress?.phase !== 'downloading'
  const canOpenRelease =
    (lastResult?.status === 'update_available' || lastResult?.status === 'no_matching_asset') &&
    !!lastResult?.htmlUrl &&
    !canInstall
  const busyDownloading = progress?.phase === 'downloading' || progress?.phase === 'verifying'
  const showNotes =
    lastResult &&
    (lastResult.status === 'update_available' || lastResult.status === 'no_matching_asset') &&
    lastResult.notesExcerpt

  return (
    <div className="flex flex-col">
      <div className="px-8 pb-3 pt-7">
        <h2 className="text-title font-semibold tracking-tight text-ink">
          {t('settings.updates.section')}
        </h2>
        <p className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
          {t('settings.updates.source')}
        </p>
      </div>
      <div className="flex flex-col gap-3 px-8 py-4" data-testid="settings-updates">
        {/* Current version */}
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">{t('settings.updates.current')}</div>
            <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
              {t('settings.updates.currentDesc')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {appInfo?.debugBuild ? (
              <span className="text-meta text-ink-tertiary">{t('settings.updates.devBadge')}</span>
            ) : null}
            <span className="text-body tabular-nums text-ink" data-testid="settings-updates-version">
              {appInfo?.version ?? '—'}
            </span>
          </div>
        </div>
        {/* Check status + actions */}
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div
              className={cn('text-body font-medium', statusDanger ? 'text-danger' : 'text-ink')}
              data-testid="settings-updates-status"
            >
              {statusText}
            </div>
            {lastResult && lastResult.status !== 'error' && progress?.phase !== 'error' ? (
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.updates.lastChecked', {
                  time: formatCheckedAt(lastResult.checkedAt),
                })}
              </div>
            ) : null}
            {devBlocked && hasAsset ? (
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.updates.devBlocked')}
              </div>
            ) : null}
            {hasAsset && !lastResult?.asset?.sha256 ? (
              <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
                {t('settings.updates.noHash')}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canInstall ? (
              <Button
                variant="primary"
                size="sm"
                data-testid="settings-updates-install"
                onClick={() => setConfirmOpen(true)}
              >
                {t('settings.updates.install')}
              </Button>
            ) : null}
            {canOpenRelease ? (
              <Button
                variant="outline"
                size="sm"
                data-testid="settings-updates-open-release"
                onClick={onOpenRelease}
              >
                {t('settings.updates.openRelease')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              data-testid="settings-updates-check"
              disabled={checking || retryLeft > 0}
              onClick={onCheck}
            >
              {checking
                ? t('settings.updates.checking')
                : retryLeft > 0
                  ? `${t('settings.updates.check')} (${retryLeft}s)`
                  : t('settings.updates.check')}
            </Button>
          </div>
        </div>
        {/* Download progress */}
        {progress && (busyDownloading || progress.phase === 'ready') ? (
          <div
            className="flex items-center justify-between gap-6"
            data-testid="settings-updates-progress"
          >
            <div className="min-w-0 flex-1">
              {busyDownloading && progress.total ? (
                <div className="flex items-center gap-3">
                  <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-chrome"
                      style={{
                        width: `${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-meta tabular-nums text-ink-tertiary">
                    {formatSize(progress.downloaded)} / {formatSize(progress.total)}
                  </span>
                </div>
              ) : null}
              {progress.phase === 'ready' && appInfo?.os === 'macos' ? (
                <div className="text-meta leading-relaxed text-ink-tertiary">
                  {t('settings.updates.gatekeeperHint')}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {busyDownloading ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="settings-updates-cancel"
                  onClick={() => void cancelDownload()}
                >
                  {t('settings.updates.cancel')}
                </Button>
              ) : null}
              {progress.phase === 'ready' && readyPath ? (
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="settings-updates-open-installer"
                  onClick={() => void onOpenInstaller()}
                >
                  {t('settings.updates.openInstaller')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* Release notes */}
        {showNotes ? (
          <div className="rounded-sm border border-border bg-surface-subtle px-3 py-2">
            <div className="text-meta font-medium text-ink-secondary">
              {t('settings.updates.notesLabel')}
            </div>
            <div
              className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-meta leading-relaxed text-ink-secondary"
              data-testid="settings-updates-notes"
            >
              {lastResult?.notesExcerpt}
            </div>
          </div>
        ) : null}
        {/* Auto check toggle */}
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">{t('settings.updates.auto')}</div>
            <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
              {t('settings.updates.autoDesc')}
            </div>
          </div>
          <Switch
            checked={autoCheck}
            onCheckedChange={onAutoToggle}
            data-testid="settings-updates-auto"
          />
        </div>
      </div>
      {/* Download confirm (unsigned warning) */}
      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('settings.updates.unsignedTitle')}
        variant="confirm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('settings.updates.cancel')}
            </Button>
            <Button
              variant="primary"
              data-testid="settings-updates-confirm"
              onClick={() => {
                setConfirmOpen(false)
                void doDownload()
              }}
            >
              {t('settings.updates.confirmAction')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-8 py-2">
          <p className="text-body font-medium text-ink">
            {t('settings.updates.confirmTitle', { name: lastResult?.asset?.name ?? '' })}
          </p>
          <p className="text-meta leading-relaxed text-ink-secondary">
            {t('settings.updates.unsignedBody', {
              size: formatSize(lastResult?.asset?.size ?? 0),
            })}
          </p>
        </div>
      </Modal>
    </div>
  )
}
