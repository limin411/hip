import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import type { HookEvent } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import {
  HOOK_EVENT_DESC_KEYS,
  HOOK_EVENT_PATH_NOTE_KEYS,
  HOOK_EVENT_PHASES,
  configuredHookEvents,
  pluginsWithHooks,
  sourcesByHookEvent,
  totalConfiguredHookCount,
  type HookEventSource,
} from './hookCatalog'

/**
 * Read-only hooks settings: lifecycle event list + click-to-expand sources.
 * Configuration is done by editing plugin files, not this page.
 */
export function HookConfig() {
  const { t } = useTranslation()
  const { plugins, loaded, load } = usePluginsStore()
  const [expandedEvent, setExpandedEvent] = useState<HookEvent | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const sources = pluginsWithHooks(plugins)
  const total = totalConfiguredHookCount(plugins)
  const configured = useMemo(() => configuredHookEvents(plugins), [plugins])
  const byEvent = useMemo(() => sourcesByHookEvent(plugins), [plugins])
  const configuredCount = configured.size

  const onToggleEvent = useCallback((event: HookEvent) => {
    setExpandedEvent((prev) => (prev === event ? null : event))
  }, [])

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

      <div className="mt-4 flex flex-wrap items-center gap-1.5" data-testid="hook-list-path-chips">
        <span className="rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-caption text-ink-tertiary">
          {t('settings.hooks.diagram.pathMain')}
        </span>
        <span className="rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-caption text-ink-tertiary">
          {t('settings.hooks.diagram.pathSubagent')}
        </span>
        <span className="rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-caption text-ink-tertiary">
          {t('settings.hooks.diagram.pathWorkflow')}
        </span>
        <span className="rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-caption text-ink-tertiary">
          {t('settings.hooks.diagram.pathExcluded')}
        </span>
      </div>
      <p className="mt-1.5 text-caption text-ink-tertiary">
        {t('settings.hooks.diagram.pathWorkflowNote')}
        {' · '}
        <span data-testid="hook-list-scan-hint">{t('settings.hooks.diagram.scanHint')}</span>
      </p>

      <div className="mt-5 space-y-5" data-testid="hook-event-list">
        {HOOK_EVENT_PHASES.map((phase) => (
          <section key={phase.id} data-testid={`hook-phase-${phase.id}`}>
            <h3 className="mb-2 text-meta font-medium text-ink-secondary">{t(phase.labelKey as never)}</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {phase.events.map((event) => {
                const eventSources = byEvent.get(event) ?? []
                const isConfigured = configured.has(event)
                const isExpanded = expandedEvent === event
                return (
                  <HookEventRow
                    key={event}
                    event={event}
                    configured={isConfigured}
                    expanded={isExpanded}
                    sources={eventSources}
                    onToggle={() => onToggleEvent(event)}
                  />
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {loaded && sources.length === 0 && (
        <p className="mt-3 text-meta text-ink-tertiary" data-testid="hooks-configured-empty">
          {t('settings.hooks.configuredEmptyHint')}
        </p>
      )}
    </div>
  )
}

function HookEventRow({
  event,
  configured,
  expanded,
  sources,
  onToggle,
}: {
  event: HookEvent
  configured: boolean
  expanded: boolean
  sources: HookEventSource[]
  onToggle: () => void
}) {
  const { t } = useTranslation()

  return (
    <li data-testid={`hook-list-row-${event}`} data-configured={configured ? 'true' : 'false'}>
      <button
        type="button"
        className={cn(
          'flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors',
          'hover:bg-surface-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50',
          expanded && 'bg-surface-muted/40',
        )}
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid={`hook-list-toggle-${event}`}
      >
        <span className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            configured
              ? 'bg-accent shadow-[0_0_0_2px] shadow-accent/20'
              : 'border border-border bg-surface',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code
              className={cn(
                'font-mono text-meta font-semibold',
                configured ? 'text-accent-strong' : 'text-ink-secondary',
              )}
            >
              {event}
            </code>
            {configured ? (
              <Badge variant="accent" size="sm">
                {t('settings.hooks.diagram.configuredBadge')}
                {sources.length > 0 ? ` · ${sources.length}` : ''}
              </Badge>
            ) : (
              <Badge size="sm">{t('settings.hooks.diagram.notConfigured')}</Badge>
            )}
          </div>
          {!expanded && (
            <p className="mt-0.5 line-clamp-1 text-caption text-ink-tertiary">
              {t(HOOK_EVENT_DESC_KEYS[event])}
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div
          className="border-t border-border/70 bg-surface-subtle/50 px-3.5 py-3 pl-12"
          data-testid="hook-list-expand-panel"
          data-event={event}
        >
          <p className="text-caption text-ink-secondary">{t(HOOK_EVENT_DESC_KEYS[event])}</p>
          <p className="mt-1.5 text-caption text-ink-tertiary" data-testid="hook-list-path-note">
            {t(HOOK_EVENT_PATH_NOTE_KEYS[event])}
          </p>

          {sources.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5">
              {sources.map((s) => (
                <li
                  key={s.pluginId}
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-2.5 py-1.5"
                  data-testid={`hook-list-source-${s.pluginId}`}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-ink-tertiary">
                    <Package size={13} />
                  </span>
                  <span className="truncate text-meta font-medium text-ink">{s.name}</span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-caption text-ink-tertiary"
                    title={s.dir}
                  >
                    {s.dir}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-meta text-ink-tertiary">
              {t('settings.hooks.diagram.expandEmptyHint')}
            </p>
          )}

          <p className="mt-2.5 text-caption text-ink-tertiary">
            {t('settings.hooks.diagram.expandScanDisclaimer')}
          </p>
        </div>
      )}
    </li>
  )
}
