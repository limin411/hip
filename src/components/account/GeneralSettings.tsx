import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore, type Theme } from '@/store/uiStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { ContextMenuSettings } from '@/components/context-menu/ContextMenuSettings'
import { CONTEXT_MENUS } from '@/components/context-menu/feature'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const
type LanguageKey = (typeof LANGUAGE_KEYS)[number]

const THEME_KEYS: Theme[] = ['light', 'dark', 'system']

const selectTriggerCls =
  'flex cursor-pointer items-center justify-between gap-6 rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-2 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const currentLang: LanguageKey = LANGUAGE_KEYS.includes(i18n.language as LanguageKey)
    ? (i18n.language as LanguageKey)
    : LANGUAGE_KEYS[0]

  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

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
                <span>{t(`settings.languages.${currentLang}`)}</span>
                <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {LANGUAGE_KEYS.map((lang) => (
                <DropdownMenuItem key={lang} onSelect={() => i18n.changeLanguage(lang)}>
                  <Check size={14} className={cn('shrink-0', currentLang === lang ? 'opacity-100' : 'opacity-0')} />
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
      {CONTEXT_MENUS ? <ContextMenuSettings /> : null}
    </div>
  )
}
