import { useEffect, useState } from 'react'
import { Package, Trash2, ExternalLink, Eye, FileText } from 'lucide-react'
import type { Components } from 'react-markdown'
import type { PluginMeta } from '@hip/protocol'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { readPluginFile } from '@/ipc/plugins'

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
  /** Uninstall / toggle error banner. */
  error: string | null
  onDelete: (plugin: PluginMeta) => void
  onToggle: (plugin: PluginMeta, enabled: boolean) => void
  onView: (plugin: PluginMeta) => void
  t: Translate
}

/**
 * Plugin market: scan of ~/.hip/plugins (+ registry paths).
 * View details + enable switch; no in-app install.
 */
export function PluginConfigView({
  plugins,
  error,
  onDelete,
  onToggle,
  onView,
  t,
}: PluginConfigViewProps) {
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
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onDelete={() => onDelete(plugin)}
              onToggle={(on) => onToggle(plugin, on)}
              onView={() => onView(plugin)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PluginCard({
  plugin,
  onDelete,
  onToggle,
  onView,
  t,
}: {
  plugin: PluginMeta
  onDelete: () => void
  onToggle: (on: boolean) => void
  onView: () => void
  t: Translate
}) {
  return (
    <div
      data-testid="plugin-card"
      data-plugin-id={plugin.id}
      className="flex flex-col rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Package size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{plugin.name}</span>
            <span className="shrink-0 text-caption text-ink-tertiary">{plugin.version}</span>
          </div>
          {plugin.author && (
            <div className="truncate text-caption text-ink-tertiary">{plugin.author}</div>
          )}
        </div>
        <Switch
          checked={plugin.enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('settings.plugins.enableThis')}
          data-testid={`plugin-enable-${plugin.id}`}
        />
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
      <div className="mt-auto flex justify-end gap-2 pt-3">
        <Button variant="outline" size="sm" onClick={onView} data-testid="plugin-view">
          <Eye size={14} /> {t('settings.plugins.view')}
        </Button>
        <Button variant="outline" size="sm" onClick={onDelete} data-testid="plugin-uninstall">
          <Trash2 size={14} /> {t('settings.plugins.uninstall')}
        </Button>
      </div>
    </div>
  )
}

export function PluginViewModal({
  plugin,
  onClose,
  t,
}: {
  plugin: PluginMeta
  onClose: () => void
  t: Translate
}) {
  const [body, setBody] = useState<string | null>(null)
  const [docError, setDocError] = useState(false)

  useEffect(() => {
    let live = true
    setBody(null)
    setDocError(false)
    if (!plugin.hasPluginMd) {
      setBody('')
      return
    }
    readPluginFile(plugin.id, 'PLUGIN.md')
      .then((b) => {
        if (live) setBody(b)
      })
      .catch(() => {
        if (live) setDocError(true)
      })
    return () => {
      live = false
    }
  }, [plugin.id, plugin.hasPluginMd])

  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith('language-')
      return (
        <code className={isBlock ? className : undefined} {...props}>
          {children}
        </code>
      )
    },
  }

  // Strip YAML frontmatter for display when present.
  const displayBody = body
    ? body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    : null

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={t('settings.plugins.viewTitle', { name: plugin.name })}
      resizable
      storageKey="plugin-view"
      className="max-w-2xl"
    >
      <div className="space-y-4 p-6" data-testid="plugin-view-modal">
        <div className="flex flex-wrap items-center gap-2 text-meta text-ink-tertiary">
          <span>{plugin.version}</span>
          {plugin.author && <span>· {plugin.author}</span>}
          {plugin.license && <span>· {plugin.license}</span>}
          <span
            className={
              plugin.enabled
                ? 'rounded bg-success/10 px-1.5 py-0.5 text-success'
                : 'rounded bg-surface-muted px-1.5 py-0.5'
            }
          >
            {plugin.enabled ? t('settings.plugins.statusEnabled') : t('settings.plugins.statusDisabled')}
          </span>
        </div>

        {plugin.description && (
          <p className="text-body text-ink-secondary">{plugin.description}</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ComponentList
            title={t('settings.plugins.skillsSection')}
            items={plugin.skills}
            empty={t('settings.plugins.none')}
          />
          <ComponentList
            title={t('settings.plugins.mcpSection')}
            items={plugin.mcpServers.map((s) => s.name || s.id)}
            empty={t('settings.plugins.none')}
          />
          <ComponentList
            title={t('settings.plugins.agentsSection')}
            items={plugin.agents}
            empty={t('settings.plugins.none')}
          />
          <ComponentList
            title={t('settings.plugins.hooksSection')}
            items={
              plugin.hookEvents.length > 0
                ? plugin.hookEvents
                : plugin.hookCount > 0
                  ? [t('settings.plugins.hookCountOnly', { count: plugin.hookCount })]
                  : []
            }
            empty={t('settings.plugins.none')}
          />
        </div>

        {plugin.dir && (
          <div className="text-caption text-ink-tertiary break-all">
            {t('settings.plugins.pathLabel')}: {plugin.dir}
          </div>
        )}

        {plugin.hasPluginMd && (
          <div className="border-t border-border pt-4">
            <h3 className="mb-2 text-meta font-medium text-ink-secondary">
              {t('settings.plugins.docSection')}
            </h3>
            {docError ? (
              <div className="flex items-center gap-2 text-body text-danger">
                <FileText size={16} /> {t('settings.plugins.loadError')}
              </div>
            ) : displayBody === null ? (
              <div className="text-body text-ink-tertiary">…</div>
            ) : displayBody === '' ? (
              <div className="text-meta text-ink-tertiary">{t('settings.plugins.noDocBody')}</div>
            ) : (
              <MarkdownBody content={displayBody} components={markdownComponents} />
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ComponentList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <div className="rounded-md border border-border bg-surface-subtle p-3">
      <div className="text-meta font-medium text-ink-secondary">{title}</div>
      {items.length === 0 ? (
        <div className="mt-1 text-caption text-ink-tertiary">{empty}</div>
      ) : (
        <ul className="mt-1 max-h-28 list-inside list-disc overflow-y-auto text-caption text-ink">
          {items.map((item) => (
            <li key={item} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
