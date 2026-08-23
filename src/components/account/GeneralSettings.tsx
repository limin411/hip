import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import {
  type TerminalShellPref,
  type TerminalColorThemeId,
  type TerminalBellPref,
  type CodeBlockColorThemeId,
  type DocWidthId,
  CODE_BLOCK_COLOR_THEME_IDS,
  DOC_WIDTH_IDS,
  TERMINAL_COLOR_THEME_IDS,
  TERMINAL_BELL_PREFS,
} from '@hip/protocol'
import { cn } from '@/lib/utils'
import { detectHipPlatform } from '@/lib/platform'
import { useUiStore, type AppLanguage, type Theme, type UiDensity } from '@/store/uiStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import {
  resolveTrashRetentionDays,
  TRASH_RETENTION_MAX_DAYS,
  TRASH_RETENTION_MIN_DAYS,
} from '@/lib/trashRetention'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { ContextMenuSettings } from '@/components/context-menu/ContextMenuSettings'
import { CONTEXT_MENUS } from '@/components/context-menu/feature'
import { CODE_TERMINAL } from '@/components/artifact/terminalFeature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { normalizeTerminalColorThemeId } from '@/components/artifact/terminalTheme'
import { normalizeCodeBlockThemeId } from '@/domain/knowledge/codeBlockTheme'
import { normalizeDocWidthId } from '@/domain/knowledge/docWidth'
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

// 英文优先：English 置顶，中文次之（与产品字体/文案定位一致）
const LANGUAGE_KEYS: AppLanguage[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko']

const THEME_KEYS: Theme[] = ['light', 'dark', 'system']

const DENSITY_KEYS: UiDensity[] = ['comfortable', 'compact']

/** Shell choices shown in General Settings (platform-filtered). */
const SHELL_KEYS_WINDOWS: TerminalShellPref[] = ['default', 'cmd', 'powershell', 'pwsh', 'bash']
const SHELL_KEYS_UNIX: TerminalShellPref[] = ['default', 'zsh', 'bash']

function shellOptionsForPlatform(): TerminalShellPref[] {
  return detectHipPlatform() === 'windows' ? SHELL_KEYS_WINDOWS : SHELL_KEYS_UNIX
}

const selectTriggerCls =
  'flex h-8 cursor-pointer items-center justify-between gap-6 rounded-sm border border-border bg-surface py-1.5 pl-2.5 pr-2 text-body text-ink-secondary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'

export function GeneralSettings() {
  const { t } = useTranslation()
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const density = useUiStore((s) => s.density)
  const setDensity = useUiStore((s) => s.setDensity)

  const codeBlockTheme = useHipConfigStore((s) =>
    normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme),
  )
  const docWidth = useHipConfigStore((s) =>
    normalizeDocWidthId(s.config.knowledge?.docWidth),
  )
  const terminalShell = useHipConfigStore((s) => s.config.terminal?.shell ?? 'default')
  const terminalColor = useHipConfigStore((s) =>
    normalizeTerminalColorThemeId(s.config.terminal?.colorTheme),
  )
  // P0.5: bell pref — visual (default) | off.
  const terminalBell = useHipConfigStore((s) => s.config.terminal?.bell ?? 'visual')
  const trashRetention = resolveTrashRetentionDays(
    useHipConfigStore((s) => s.config.trash?.retentionDays),
  )
  const proxy = useHipConfigStore((s) => s.config.proxy)
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const loadHipConfig = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)
  const [retentionDraft, setRetentionDraft] = useState(String(trashRetention))
  const [proxyHttp, setProxyHttp] = useState(proxy?.http ?? '')
  const [proxyHttps, setProxyHttps] = useState(proxy?.https ?? '')
  const [proxyAll, setProxyAll] = useState(proxy?.all ?? '')
  const [proxyNoProxy, setProxyNoProxy] = useState(proxy?.noProxy ?? '')

  useEffect(() => {
    if (!hipLoaded) void loadHipConfig()
  }, [hipLoaded, loadHipConfig])

  useEffect(() => {
    setRetentionDraft(String(trashRetention))
  }, [trashRetention])

  useEffect(() => {
    setProxyHttp(proxy?.http ?? '')
    setProxyHttps(proxy?.https ?? '')
    setProxyAll(proxy?.all ?? '')
    setProxyNoProxy(proxy?.noProxy ?? '')
  }, [proxy?.http, proxy?.https, proxy?.all, proxy?.noProxy])

  const shellKeys = shellOptionsForPlatform()
  const showTerminalColor = CODE_TERMINAL || TERMINAL_MANAGEMENT
  const setTerminalShell = (shell: TerminalShellPref) => {
    void updateSection('terminal', (prev) => ({ ...(prev ?? {}), shell }))
  }
  const setCodeBlockTheme = (colorTheme: CodeBlockColorThemeId) => {
    void updateSection('codeBlock', (prev) => ({ ...(prev ?? {}), colorTheme }))
  }
  const setDocWidth = (width: DocWidthId) => {
    void updateSection('knowledge', (prev) => ({ ...(prev ?? {}), docWidth: width }))
  }
  const setTerminalColor = (colorTheme: TerminalColorThemeId) => {
    void updateSection('terminal', (prev) => ({ ...(prev ?? {}), colorTheme }))
  }
  const setTerminalBell = (bell: TerminalBellPref) => {
    void updateSection('terminal', (prev) => ({ ...(prev ?? {}), bell }))
  }

  const commitTrashRetention = () => {
    const n = resolveTrashRetentionDays(Number(retentionDraft))
    setRetentionDraft(String(n))
    void updateSection('trash', { retentionDays: n })
  }

  const proxyEnabled = proxy?.enabled === true
  const setProxyEnabled = (enabled: boolean) => {
    void updateSection('proxy', (prev) => ({ ...(prev ?? {}), enabled }))
  }
  const commitProxyField = (
    field: 'http' | 'https' | 'all' | 'noProxy',
    value: string,
  ) => {
    const trimmed = value.trim()
    void updateSection('proxy', (prev) => ({
      ...(prev ?? {}),
      [field]: trimmed || undefined,
    }))
  }

  // ── Version & updates (updatesStore is the single writer for check state) ──
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
        <h2 className="text-title font-semibold tracking-tight text-ink">{t('settings.general')}</h2>
      </div>
      <div className="flex items-center justify-between gap-6 px-8 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.language')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">{t('settings.languageDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={selectTriggerCls}>
                <span>{t(`settings.languages.${language}`)}</span>
                <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {LANGUAGE_KEYS.map((lang) => (
                <DropdownMenuItem key={lang} onSelect={() => setLanguage(lang)}>
                  <Check size={14} className={cn('shrink-0', language === lang ? 'opacity-100' : 'opacity-0')} />
                  <span>{t(`settings.languages.${lang}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center justify-between gap-6 px-8 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.theme')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">{t('settings.themeDesc')}</div>
        </div>
        <div className="relative shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={selectTriggerCls}>
                <span>{t(`settings.themes.${theme}`)}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {THEME_KEYS.map((themeKey) => (
                <DropdownMenuItem key={themeKey} onSelect={() => setTheme(themeKey)}>
                  <Check size={14} className={cn('shrink-0', theme === themeKey ? 'opacity-100' : 'opacity-0')} />
                  <span>{t(`settings.themes.${themeKey}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-code-block-color"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.codeBlockColor')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.codeBlockColorDesc')}
          </div>
        </div>
        <div className="relative shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={selectTriggerCls}
                data-testid="settings-code-block-color-trigger"
              >
                <span>{t(`settings.codeBlockColors.${codeBlockTheme}`)}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CODE_BLOCK_COLOR_THEME_IDS.map((themeId) => (
                <DropdownMenuItem
                  key={themeId}
                  data-testid={`settings-code-block-color-${themeId}`}
                  onSelect={() => setCodeBlockTheme(themeId)}
                >
                  <Check
                    size={14}
                    className={cn(
                      'shrink-0',
                      codeBlockTheme === themeId ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span>{t(`settings.codeBlockColors.${themeId}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-doc-width"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.docWidth')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.docWidthDesc')}
          </div>
        </div>
        <div className="relative shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={selectTriggerCls}
                data-testid="settings-doc-width-trigger"
              >
                <span>{t(`settings.docWidths.${docWidth}`)}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {DOC_WIDTH_IDS.map((widthId) => (
                <DropdownMenuItem
                  key={widthId}
                  data-testid={`settings-doc-width-${widthId}`}
                  onSelect={() => setDocWidth(widthId)}
                >
                  <Check
                    size={14}
                    className={cn(
                      'shrink-0',
                      docWidth === widthId ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span>{t(`settings.docWidths.${widthId}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center justify-between gap-6 px-8 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.density')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">{t('settings.densityDesc')}</div>
        </div>
        <div className="relative shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={selectTriggerCls}>
                <span>{t(`settings.densities.${density}`)}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {DENSITY_KEYS.map((densityKey) => (
                <DropdownMenuItem key={densityKey} onSelect={() => setDensity(densityKey)}>
                  <Check size={14} className={cn('shrink-0', density === densityKey ? 'opacity-100' : 'opacity-0')} />
                  <span>{t(`settings.densities.${densityKey}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {CODE_TERMINAL ? (
        <div className="flex items-center justify-between gap-6 px-8 py-4" data-testid="settings-terminal-shell">
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">{t('settings.terminalShell')}</div>
            <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">{t('settings.terminalShellDesc')}</div>
          </div>
          <div className="relative shrink-0">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={selectTriggerCls} data-testid="settings-terminal-shell-trigger">
                  <span>{t(`settings.terminalShells.${terminalShell}`)}</span>
                  <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {shellKeys.map((shellKey) => (
                  <DropdownMenuItem
                    key={shellKey}
                    data-testid={`settings-terminal-shell-${shellKey}`}
                    onSelect={() => setTerminalShell(shellKey)}
                  >
                    <Check
                      size={14}
                      className={cn('shrink-0', terminalShell === shellKey ? 'opacity-100' : 'opacity-0')}
                    />
                    <span>{t(`settings.terminalShells.${shellKey}`)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
      {showTerminalColor ? (
        <div
          className="flex items-center justify-between gap-6 px-8 py-4"
          data-testid="settings-terminal-color"
        >
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">{t('settings.terminalColor')}</div>
            <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
              {t('settings.terminalColorDesc')}
            </div>
          </div>
          <div className="relative shrink-0">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={selectTriggerCls}
                  data-testid="settings-terminal-color-trigger"
                >
                  <span>{t(`settings.terminalColors.${terminalColor}`)}</span>
                  <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {TERMINAL_COLOR_THEME_IDS.map((themeId) => (
                  <DropdownMenuItem
                    key={themeId}
                    data-testid={`settings-terminal-color-${themeId}`}
                    onSelect={() => setTerminalColor(themeId)}
                  >
                    <Check
                      size={14}
                      className={cn(
                        'shrink-0',
                        terminalColor === themeId ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span>{t(`settings.terminalColors.${themeId}`)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
      {showTerminalColor ? (
        <div
          className="flex items-center justify-between gap-6 px-8 py-4"
          data-testid="settings-terminal-bell"
        >
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">{t('settings.terminalBell')}</div>
            <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
              {t('settings.terminalBellDesc')}
            </div>
          </div>
          <div className="relative shrink-0">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={selectTriggerCls}
                  data-testid="settings-terminal-bell-trigger"
                >
                  <span>{t(`settings.terminalBells.${terminalBell}`)}</span>
                  <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {TERMINAL_BELL_PREFS.map((bellKey) => (
                  <DropdownMenuItem
                    key={bellKey}
                    data-testid={`settings-terminal-bell-${bellKey}`}
                    onSelect={() => setTerminalBell(bellKey)}
                  >
                    <Check
                      size={14}
                      className={cn(
                        'shrink-0',
                        terminalBell === bellKey ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span>{t(`settings.terminalBells.${bellKey}`)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-trash-retention"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.trashRetention')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">{t('settings.trashRetentionDesc')}</div>
        </div>
        <div className="relative flex shrink-0 items-center gap-2">
          <input
            type="number"
            min={TRASH_RETENTION_MIN_DAYS}
            max={TRASH_RETENTION_MAX_DAYS}
            value={retentionDraft}
            data-testid="settings-trash-retention-input"
            onChange={(e) => setRetentionDraft(e.target.value)}
            onBlur={commitTrashRetention}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            className="h-8 w-20 rounded-sm border border-border bg-surface px-2 text-left text-body tabular-nums text-ink transition-[border-color,box-shadow] duration-chrome focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
          />
          <span className="text-meta text-ink-tertiary">
            {t('settings.trashRetentionUnit', { defaultValue: 'days' })}
          </span>
        </div>
      </div>
      {/* Network proxy */}
      <div
        className="flex flex-col gap-3 px-8 py-4"
        data-testid="settings-proxy"
      >
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-ink">{t('settings.proxy')}</div>
            <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
              {t('settings.proxyDesc')}
            </div>
          </div>
          <Switch
            checked={proxyEnabled}
            onCheckedChange={setProxyEnabled}
            data-testid="settings-proxy-enabled"
          />
        </div>
        {proxyEnabled ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('settings.proxyHttp')}</span>
              <input
                type="url"
                value={proxyHttp}
                data-testid="settings-proxy-http"
                placeholder="http://127.0.0.1:7890"
                spellCheck={false}
                onChange={(e) => setProxyHttp(e.target.value)}
                onBlur={() => commitProxyField('http', proxyHttp)}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-body text-ink transition-[border-color,box-shadow] duration-chrome focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('settings.proxyHttps')}</span>
              <input
                type="url"
                value={proxyHttps}
                data-testid="settings-proxy-https"
                placeholder="http://127.0.0.1:7890"
                spellCheck={false}
                onChange={(e) => setProxyHttps(e.target.value)}
                onBlur={() => commitProxyField('https', proxyHttps)}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-body text-ink transition-[border-color,box-shadow] duration-chrome focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('settings.proxyAll')}</span>
              <input
                type="url"
                value={proxyAll}
                data-testid="settings-proxy-all"
                placeholder={t('settings.proxyAllPlaceholder')}
                spellCheck={false}
                onChange={(e) => setProxyAll(e.target.value)}
                onBlur={() => commitProxyField('all', proxyAll)}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-body text-ink transition-[border-color,box-shadow] duration-chrome focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('settings.proxyNoProxy')}</span>
              <input
                type="text"
                value={proxyNoProxy}
                data-testid="settings-proxy-no-proxy"
                placeholder="localhost,127.0.0.1,::1"
                spellCheck={false}
                onChange={(e) => setProxyNoProxy(e.target.value)}
                onBlur={() => commitProxyField('noProxy', proxyNoProxy)}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-body text-ink transition-[border-color,box-shadow] duration-chrome focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
              />
            </label>
            <p className="text-caption leading-relaxed text-ink-tertiary sm:col-span-2">
              {t('settings.proxyRestartHint')}
            </p>
          </div>
        ) : null}
      </div>
      {/* Version & updates */}
      <div className="flex flex-col gap-3 px-8 py-4" data-testid="settings-updates">
        <div>
          <h3 className="text-body font-semibold text-ink">{t('settings.updates.section')}</h3>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.updates.source')}
          </p>
        </div>
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
          <div className="flex items-center justify-between gap-6" data-testid="settings-updates-progress">
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
      {CONTEXT_MENUS ? <ContextMenuSettings /> : null}
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
