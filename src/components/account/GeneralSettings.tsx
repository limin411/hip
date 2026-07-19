import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import type { TerminalShellPref } from '@hip/protocol'
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

const LANGUAGE_KEYS: AppLanguage[] = ['zh-CN', 'zh-TW', 'en']

const THEME_KEYS: Theme[] = ['light', 'dark', 'system']

const DENSITY_KEYS: UiDensity[] = ['comfortable', 'compact']

/** Shell choices shown in General Settings (platform-filtered). */
const SHELL_KEYS_WINDOWS: TerminalShellPref[] = ['default', 'cmd', 'powershell', 'pwsh', 'bash']
const SHELL_KEYS_UNIX: TerminalShellPref[] = ['default', 'zsh', 'bash']

function shellOptionsForPlatform(): TerminalShellPref[] {
  return detectHipPlatform() === 'windows' ? SHELL_KEYS_WINDOWS : SHELL_KEYS_UNIX
}

const selectTriggerCls =
  'flex cursor-pointer items-center justify-between gap-6 rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-2 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

export function GeneralSettings() {
  const { t } = useTranslation()
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const density = useUiStore((s) => s.density)
  const setDensity = useUiStore((s) => s.setDensity)

  const terminalShell = useHipConfigStore((s) => s.config.terminal?.shell ?? 'default')
  const trashRetention = resolveTrashRetentionDays(
    useHipConfigStore((s) => s.config.trash?.retentionDays),
  )
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const loadHipConfig = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)
  const [retentionDraft, setRetentionDraft] = useState(String(trashRetention))

  useEffect(() => {
    if (!hipLoaded) void loadHipConfig()
  }, [hipLoaded, loadHipConfig])

  useEffect(() => {
    setRetentionDraft(String(trashRetention))
  }, [trashRetention])

  const shellKeys = shellOptionsForPlatform()
  const setTerminalShell = (shell: TerminalShellPref) => {
    void updateSection('terminal', { shell })
  }

  const commitTrashRetention = () => {
    const n = resolveTrashRetentionDays(Number(retentionDraft))
    setRetentionDraft(String(n))
    void updateSection('trash', { retentionDays: n })
  }

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-6 pb-2">
        <h2 className="text-title font-semibold text-ink">{t('settings.general')}</h2>
      </div>
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.language')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.languageDesc')}</div>
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
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.theme')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.themeDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={selectTriggerCls}>
                <span>{t(`settings.themes.${theme}`)}</span>
                <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
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
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.density')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.densityDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={selectTriggerCls}>
                <span>{t(`settings.densities.${density}`)}</span>
                <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
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
        <div className="flex items-center justify-between px-6 py-5" data-testid="settings-terminal-shell">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.terminalShell')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.terminalShellDesc')}</div>
          </div>
          <div className="relative ml-4 shrink-0">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={selectTriggerCls} data-testid="settings-terminal-shell-trigger">
                  <span>{t(`settings.terminalShells.${terminalShell}`)}</span>
                  <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
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
      <div
        className="flex items-center justify-between px-6 py-5"
        data-testid="settings-trash-retention"
      >
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.trashRetention')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.trashRetentionDesc')}</div>
        </div>
        <div className="relative ml-4 flex shrink-0 items-center gap-2">
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
            className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-body text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
          <span className="text-meta text-ink-tertiary">
            {t('settings.trashRetentionUnit', { defaultValue: 'days' })}
          </span>
        </div>
      </div>
      {CONTEXT_MENUS ? <ContextMenuSettings /> : null}
    </div>
  )
}
