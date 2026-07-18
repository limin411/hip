import { Package, Trash2, ExternalLink } from 'lucide-react'
import type { PluginMeta } from '@hip/protocol'
import { Button } from '@/components/ui/Button'

export type Translate = (key: string, options?: Record<string, unknown>) => string

export function formatComponentCounts(plugin: PluginMeta, t: Translate): string {
  return t('settings.plugins.componentCounts', {
    skills: plugin.skills.length,
    mcpServers: plugin.mcpServers.length,
    agents: plugin.agents.length,
    hooks: plugin.hookCount,
  })
}

export interface PluginConfigViewProps {
  plugins: PluginMeta[]
  /** Uninstall delete error banner (not install flow). */
  error: string | null
  onDelete: (plugin: PluginMeta) => void
  t: Translate
}

/**
 * Plugin market: read-only scan of ~/.hip/plugins (and registry paths).
 * No in-app install — place packages under the data directory.
 */
export function PluginConfigView({ plugins, error, onDelete, t }: PluginConfigViewProps) {
  return (
    <div className="p-6" data-testid="plugin-market">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.plugins.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.plugins.intro')}</p>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
          {error}
        </div>
      )}

      {plugins.length === 0 ? (
        <div
          className="mt-5 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center"
          data-testid="plugin-market-empty"
        >
          <Package size={22} className="mx-auto text-ink-tertiary" />
          <div className="mt-2 text-body text-ink-secondary">{t('settings.plugins.empty')}</div>
          <div className="mt-1 text-meta text-ink-tertiary">{t('settings.plugins.emptyHint')}</div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} onDelete={() => onDelete(plugin)} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function PluginCard({
  plugin,
  onDelete,
  t,
}: {
  plugin: PluginMeta
  onDelete: () => void
  t: Translate
}) {
  return (
    <div data-testid="plugin-card" className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Package size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{plugin.name}</span>
            <span className="shrink-0 text-caption text-ink-tertiary">{plugin.version}</span>
          </div>
          {plugin.author && (
            <div className="truncate text-caption text-ink-tertiary">{plugin.author}</div>
          )}
        </div>
      </div>
      {plugin.description && (
        <div className="mt-3 line-clamp-2 text-body text-ink-secondary">{plugin.description}</div>
      )}
      <div className="mt-3 text-caption text-ink-tertiary">{formatComponentCounts(plugin, t)}</div>
      {(plugin.keywords?.length || plugin.sourceUrl || plugin.license) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {plugin.license && (
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary">
              {plugin.license}
            </span>
          )}
          {plugin.keywords?.slice(0, 4).map((kw) => (
            <span
              key={kw}
              className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary"
            >
              {kw}
            </span>
          ))}
          {plugin.sourceUrl && (
            <a
              href={plugin.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-caption text-accent-strong hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={12} />
              {t('settings.plugins.source')}
            </a>
          )}
        </div>
      )}
      <div className="mt-auto flex justify-end pt-3">
        <Button variant="outline" size="sm" onClick={onDelete} data-testid="plugin-uninstall">
          <Trash2 size={14} /> {t('settings.plugins.uninstall')}
        </Button>
      </div>
    </div>
  )
}
