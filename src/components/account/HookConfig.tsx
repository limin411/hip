import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginsStore } from '@/store/pluginsStore'
import {
  configuredHookEvents,
  pluginsWithHooks,
  totalConfiguredHookCount,
} from './hookCatalog'
import { HookLifecycleDiagram } from './HookLifecycleDiagram'

/**
 * Read-only hooks settings: fishbone lifecycle map + click-to-expand sources.
 * Configuration is done by editing plugin files, not this page.
 */
export function HookConfig() {
  const { t } = useTranslation()
  const { plugins, loaded, load } = usePluginsStore()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const sources = pluginsWithHooks(plugins)
  const total = totalConfiguredHookCount(plugins)
  const configuredCount = useMemo(() => configuredHookEvents(plugins).size, [plugins])

  return (
    <div className="p-6" data-testid="settings-hooks-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-ink">{t('settings.hooks.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.hooks.introShort')}</p>
          <p className="mt-1 text-caption text-ink-tertiary">{t('settings.hooks.pluginManagedHint')}</p>
        </div>
        {loaded && sources.length > 0 && (
          <span className="text-meta text-ink-tertiary" data-testid="hooks-summary">
            {t('settings.hooks.configuredSummary', {
              sources: sources.length,
              count: total,
            })}
            {' · '}
            {t('settings.hooks.eventsOn', { count: configuredCount })}
          </span>
        )}
      </div>

      <div className="mt-5">
        <HookLifecycleDiagram plugins={plugins} />
      </div>

      {loaded && sources.length === 0 && (
        <p className="mt-3 text-meta text-ink-tertiary" data-testid="hooks-configured-empty">
          {t('settings.hooks.configuredEmptyHint')}
        </p>
      )}
    </div>
  )
}
