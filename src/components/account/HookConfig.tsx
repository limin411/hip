import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Package } from 'lucide-react'
import type { PluginMeta } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { Badge } from '@/components/ui/Badge'
import {
  HOOK_EVENT_CATALOG,
  HOOK_EVENT_DESC_KEYS,
  pluginsWithHooks,
  totalConfiguredHookCount,
} from './hookCatalog'

function ConfiguredPluginRow({ plugin }: { plugin: PluginMeta }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-3"
      data-testid={`hook-source-${plugin.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Package size={15} className="shrink-0 text-ink-tertiary" />
          <span className="truncate text-body font-medium text-ink">{plugin.name}</span>
          <Badge size="sm">
            {t('settings.hooks.sourcePlugin')}
          </Badge>
        </div>
        <div className="mt-1 truncate font-mono text-meta text-ink-tertiary" title={plugin.dir}>
          {plugin.dir}
        </div>
      </div>
      <div className="shrink-0 text-meta text-ink-secondary">
        {t('settings.hooks.hookCount', { count: plugin.hookCount })}
      </div>
    </div>
  )
}

export function HookConfig() {
  const { t } = useTranslation()
  const { plugins, loaded, load } = usePluginsStore()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const sources = pluginsWithHooks(plugins)
  const total = totalConfiguredHookCount(plugins)

  return (
    <div className="p-6" data-testid="settings-hooks-page">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.hooks.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.hooks.intro')}</p>
      </div>

      <div className="mt-4 rounded-md border border-border bg-surface-subtle px-3 py-2.5 text-meta text-ink-secondary">
        {t('settings.hooks.editHint')}
      </div>

      {/* ── Currently configured ─────────────────────────────────────── */}
      <section className="mt-8" aria-labelledby="hooks-configured-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="hooks-configured-heading" className="text-prose font-semibold text-ink">
            {t('settings.hooks.configuredTitle')}
          </h3>
          {sources.length > 0 && (
            <span className="text-meta text-ink-tertiary">
              {t('settings.hooks.configuredSummary', {
                sources: sources.length,
                count: total,
              })}
            </span>
          )}
        </div>
        <p className="mt-1 text-meta text-ink-tertiary">{t('settings.hooks.configuredDesc')}</p>

        <div className="mt-3 space-y-2">
          {!loaded ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-meta text-ink-tertiary">
              {t('settings.hooks.loading')}
            </div>
          ) : sources.length === 0 ? (
            <div
              className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center"
              data-testid="hooks-configured-empty"
            >
              <Link2 size={22} className="mx-auto text-ink-tertiary" />
              <div className="mt-2 text-body text-ink-secondary">{t('settings.hooks.configuredEmpty')}</div>
              <div className="mt-1 text-meta text-ink-tertiary">{t('settings.hooks.configuredEmptyHint')}</div>
            </div>
          ) : (
            sources.map((p) => <ConfiguredPluginRow key={p.id} plugin={p} />)
          )}
        </div>
      </section>

      {/* ── Catalog of configurable events ───────────────────────────── */}
      <section className="mt-10" aria-labelledby="hooks-catalog-heading">
        <h3 id="hooks-catalog-heading" className="text-prose font-semibold text-ink">
          {t('settings.hooks.catalogTitle')}
        </h3>
        <p className="mt-1 text-meta text-ink-tertiary">{t('settings.hooks.catalogDesc')}</p>

        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {HOOK_EVENT_CATALOG.map((event) => (
            <li
              key={event}
              className="flex items-start gap-3 bg-surface px-3 py-3"
              data-testid={`hook-event-${event}`}
            >
              <code className="mt-0.5 shrink-0 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-meta text-ink">
                {event}
              </code>
              <span className="min-w-0 flex-1 text-meta text-ink-secondary">
                {t(HOOK_EVENT_DESC_KEYS[event])}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── How to configure ─────────────────────────────────────────── */}
      <section className="mt-10" aria-labelledby="hooks-howto-heading">
        <h3 id="hooks-howto-heading" className="text-prose font-semibold text-ink">
          {t('settings.hooks.howToTitle')}
        </h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-meta text-ink-secondary">
          <li>{t('settings.hooks.howToStep1')}</li>
          <li>{t('settings.hooks.howToStep2')}</li>
          <li>{t('settings.hooks.howToStep3')}</li>
        </ol>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface-muted px-3 py-2.5 font-mono text-caption text-ink-secondary">
{`// plugin.json
{ "hooks": "./hooks.cjs" }

// hooks.cjs
module.exports = [
  {
    event: "PreToolUse",
    matcher: "run_script",
    handler: async (ctx) => ({ kind: "allow" }),
  },
]`}
        </pre>
      </section>
    </div>
  )
}
