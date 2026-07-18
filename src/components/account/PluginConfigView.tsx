import { Package } from 'lucide-react'
import type { PluginMeta } from '@hip/protocol'

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
  /** Built-in marketplace catalog entries (empty until source management lands). */
  plugins: PluginMeta[]
  t: Translate
}

export function PluginConfigView({ plugins, t }: PluginConfigViewProps) {
  return (
    <div className="p-6" data-testid="plugin-market">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.plugins.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.plugins.intro')}</p>
      </div>

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
            <PluginCard key={plugin.id} plugin={plugin} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Read-only card for a built-in catalog entry (no install / uninstall actions). */
function PluginCard({ plugin, t }: { plugin: PluginMeta; t: Translate }) {
  return (
    <div data-testid="plugin-card" className="rounded-lg border border-border bg-surface p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Package size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{plugin.name}</span>
            <span className="shrink-0 text-caption text-ink-tertiary">{plugin.version}</span>
          </div>
        </div>
      </div>
      {plugin.description && (
        <div className="mt-3 truncate text-body text-ink-secondary">{plugin.description}</div>
      )}
      <div className="mt-3 text-caption text-ink-tertiary">{formatComponentCounts(plugin, t)}</div>
    </div>
  )
}
