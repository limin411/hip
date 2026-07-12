import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import type { HookEvent, PluginMeta } from '@hip/protocol'
import { cn } from '@/lib/utils'
import {
  HOOK_EVENT_DESC_KEYS,
  configuredHookEvents,
  sourcesByHookEvent,
  type HookEventSource,
} from './hookCatalog'
import {
  buildHookFishboneGraph,
  type HookFishboneNode,
  type HookFishboneNodeData,
} from './hookFishbone'
import './HookLifecycleDiagram.css'

// ── Custom nodes ────────────────────────────────────────────────────────────

function SpineNode({ data }: NodeProps<HookFishboneNode>) {
  const isHead = data.kind === 'head'
  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full border px-2 py-1 text-center',
        isHead
          ? 'min-w-[7rem] rounded-lg border-accent/40 bg-accent/10 px-3 py-2 font-semibold text-accent-strong'
          : 'min-w-[3.25rem] border-border bg-surface-muted text-caption font-medium text-ink-tertiary',
      )}
      data-testid={isHead ? 'hook-fishbone-head' : `hook-fishbone-joint-${data.label}`}
    >
      <Handle
        id="spine-in"
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-0 !bg-ink-tertiary opacity-0"
      />
      <span className={cn(isHead ? 'text-meta' : 'text-[10px] uppercase tracking-wide')}>
        {data.label}
      </span>
      <Handle
        id="spine-out"
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-ink-tertiary opacity-0"
      />
      {/* Ribs attach from bottom/top of joints via additional handles */}
      {!isHead && (
        <>
          <Handle
            id="rib-up"
            type="source"
            position={Position.Top}
            className="!h-1.5 !w-1.5 !border-0 !bg-ink-tertiary opacity-0"
          />
          <Handle
            id="rib-down"
            type="source"
            position={Position.Bottom}
            className="!h-1.5 !w-1.5 !border-0 !bg-ink-tertiary opacity-0"
          />
        </>
      )}
    </div>
  )
}

function HookEventNode({ data }: NodeProps<HookFishboneNode>) {
  const { t } = useTranslation()
  const configured = !!data.configured
  const expanded = !!data.expanded
  const count = data.sourceCount ?? 0
  const event = data.event as HookEvent | undefined

  return (
    <div
      className={cn(
        'cursor-pointer rounded-md border px-2 py-1.5 text-left shadow-sm transition-colors',
        'hover:ring-2 hover:ring-accent/30',
        configured
          ? 'border-accent/50 bg-accent/10 text-accent-strong'
          : 'border-border bg-surface text-ink-secondary',
        expanded && 'ring-2 ring-accent/50',
      )}
      data-testid={event ? `hook-diagram-node-${event}` : 'hook-diagram-node'}
      data-configured={configured ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
      title={event ? t(HOOK_EVENT_DESC_KEYS[event]) : data.label}
    >
      {/* Ribs from spine: events above receive from Bottom; events below from Top */}
      <Handle
        id="from-spine"
        type="target"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-border opacity-0"
      />
      <Handle
        id="from-spine-top"
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-border opacity-0"
      />
      <div className="flex items-start gap-1">
        <span className="mt-0.5 shrink-0 text-ink-tertiary">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <div className="min-w-0 flex-1">
          <code className="block truncate font-mono text-caption font-medium leading-tight">
            {data.label}
          </code>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-none">
            {configured ? (
              <span className="font-medium text-accent">
                {t('settings.hooks.diagram.configuredBadge')}
                {count > 0 ? ` · ${count}` : ''}
              </span>
            ) : (
              <span className="text-ink-tertiary">{t('settings.hooks.diagram.notConfigured')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  spine: SpineNode,
  hookEvent: HookEventNode,
}

// ── Detail panel ────────────────────────────────────────────────────────────

function ExpandPanel({
  event,
  sources,
  onClose,
}: {
  event: HookEvent
  sources: HookEventSource[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="mt-3 rounded-lg border border-accent/30 bg-surface px-3 py-3"
      data-testid="hook-diagram-expand-panel"
      data-event={event}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <code className="font-mono text-meta font-semibold text-ink">{event}</code>
            <span className="text-caption text-ink-tertiary">
              {sources.length > 0
                ? t('settings.hooks.diagram.expandSources', { count: sources.length })
                : t('settings.hooks.diagram.expandEmpty')}
            </span>
          </div>
          <p className="mt-1 text-meta text-ink-secondary">{t(HOOK_EVENT_DESC_KEYS[event])}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-caption text-ink-tertiary hover:bg-surface-muted hover:text-ink"
          onClick={onClose}
          data-testid="hook-diagram-expand-close"
        >
          {t('settings.hooks.diagram.collapse')}
        </button>
      </div>

      {sources.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {sources.map((s) => (
            <li
              key={s.pluginId}
              className="flex items-start gap-2 rounded-md border border-border bg-surface-subtle px-2.5 py-2"
              data-testid={`hook-diagram-source-${s.pluginId}`}
            >
              <Package size={14} className="mt-0.5 shrink-0 text-ink-tertiary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-meta font-medium text-ink">{s.name}</div>
                <div className="truncate font-mono text-caption text-ink-tertiary" title={s.dir}>
                  {s.dir}
                </div>
              </div>
              <span className="shrink-0 text-caption text-ink-tertiary">
                {t('settings.hooks.hookCount', { count: s.hookCount })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-meta text-ink-tertiary">{t('settings.hooks.diagram.expandEmptyHint')}</p>
      )}
    </div>
  )
}

// ── Canvas ──────────────────────────────────────────────────────────────────

function FishboneCanvas({
  plugins,
  expandedEvent,
  onToggleEvent,
}: {
  plugins: PluginMeta[]
  expandedEvent: HookEvent | null
  onToggleEvent: (event: HookEvent) => void
}) {
  const configuredEvents = useMemo(() => configuredHookEvents(plugins), [plugins])
  const byEvent = useMemo(() => sourcesByHookEvent(plugins), [plugins])

  const { nodes, edges } = useMemo(
    () =>
      buildHookFishboneGraph({
        configuredEvents,
        sourcesByEvent: byEvent,
        expandedEvent,
      }),
    [configuredEvents, byEvent, expandedEvent],
  )

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_evt: MouseEvent, node) => {
      const data = node.data as HookFishboneNodeData
      if (data.kind !== 'event' || !data.event) return
      onToggleEvent(data.event)
    },
    [onToggleEvent],
  )

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-md border border-border bg-surface">
      <ReactFlow
        className="hook-fishbone-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.35}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

// ── Public component ────────────────────────────────────────────────────────

export interface HookLifecycleDiagramProps {
  plugins: PluginMeta[]
}

/**
 * Fishbone lifecycle diagram of hip agent hooks (React Flow).
 * Click an event node to expand/collapse configured plugin sources.
 */
export function HookLifecycleDiagram({ plugins }: HookLifecycleDiagramProps) {
  const { t } = useTranslation()
  const [expandedEvent, setExpandedEvent] = useState<HookEvent | null>(null)
  const byEvent = useMemo(() => sourcesByHookEvent(plugins), [plugins])
  const configuredEvents = useMemo(() => configuredHookEvents(plugins), [plugins])
  const configuredCount = configuredEvents.size

  const onToggleEvent = useCallback((event: HookEvent) => {
    setExpandedEvent((prev) => (prev === event ? null : event))
  }, [])

  const sources = expandedEvent ? (byEvent.get(expandedEvent) ?? []) : []

  return (
    <div
      className="rounded-lg border border-border bg-surface-subtle p-4"
      data-testid="hook-lifecycle-diagram"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-meta font-semibold text-ink">{t('settings.hooks.diagram.title')}</div>
          <p className="mt-0.5 text-meta text-ink-tertiary">{t('settings.hooks.diagram.subtitleFishbone')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-meta text-ink-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm border border-accent/50 bg-accent/10" />
            {t('settings.hooks.diagram.legendConfigured')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm border border-border bg-surface" />
            {t('settings.hooks.diagram.legendAvailable')}
          </span>
          <span className="text-caption">
            {t('settings.hooks.diagram.ariaLabel', { count: configuredCount })}
          </span>
        </div>
      </div>

      <ReactFlowProvider>
        <FishboneCanvas
          plugins={plugins}
          expandedEvent={expandedEvent}
          onToggleEvent={onToggleEvent}
        />
      </ReactFlowProvider>

      {expandedEvent && (
        <ExpandPanel
          event={expandedEvent}
          sources={sources}
          onClose={() => setExpandedEvent(null)}
        />
      )}
    </div>
  )
}
