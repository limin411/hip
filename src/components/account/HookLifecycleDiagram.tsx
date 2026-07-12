import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
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
  HOOK_EVENT_PATH_NOTE_KEYS,
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
  const isTail = !isHead && data.label === '…'

  return (
    <div
      className={cn(
        'relative text-center',
        isHead ? 'hook-fishbone-head' : 'hook-fishbone-joint',
        isTail && 'min-w-[2.25rem] px-2 text-ink-tertiary',
      )}
      data-testid={isHead ? 'hook-fishbone-head' : `hook-fishbone-joint-${data.label}`}
    >
      <Handle
        id="spine-in"
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-accent opacity-0"
      />
      {isHead ? (
        <>
          <span className="hook-fishbone-head-dot" aria-hidden />
          <span className="text-meta font-semibold tracking-tight">{data.label}</span>
        </>
      ) : (
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-[0.08em]',
            isTail ? 'tracking-normal' : 'text-ink-secondary',
          )}
        >
          {data.label}
        </span>
      )}
      <Handle
        id="spine-out"
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-accent opacity-0"
      />
      {!isHead && (
        <>
          <Handle
            id="rib-left"
            type="source"
            position={Position.Left}
            className="!h-1.5 !w-1.5 !border-0 !bg-accent opacity-0"
          />
          <Handle
            id="rib-right"
            type="source"
            position={Position.Right}
            className="!h-1.5 !w-1.5 !border-0 !bg-accent opacity-0"
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
      className="hook-fishbone-event px-2.5 py-2 text-left"
      data-testid={event ? `hook-diagram-node-${event}` : 'hook-diagram-node'}
      data-configured={configured ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
      title={event ? t(HOOK_EVENT_DESC_KEYS[event]) : data.label}
    >
      <Handle
        id="from-spine-right"
        type="target"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-border opacity-0"
      />
      <Handle
        id="from-spine-left"
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-0 !bg-border opacity-0"
      />
      <div className="flex items-start gap-1.5">
        <span className="hook-fishbone-event-status mt-1.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <code
              className={cn(
                'block min-w-0 flex-1 truncate font-mono text-[11px] font-semibold leading-tight',
                configured ? 'text-accent-strong' : 'text-ink-secondary',
              )}
            >
              {data.label}
            </code>
            <span className="shrink-0 text-ink-tertiary opacity-70">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </div>
          <div className="mt-1">
            {configured ? (
              <span className="hook-fishbone-event-badge on">
                {t('settings.hooks.diagram.configuredBadge')}
                {count > 0 ? ` · ${count}` : ''}
              </span>
            ) : (
              <span className="hook-fishbone-event-badge off">
                {t('settings.hooks.diagram.notConfigured')}
              </span>
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
      className="hook-fishbone-expand mt-3 px-3.5 py-3"
      data-testid="hook-diagram-expand-panel"
      data-event={event}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-meta font-semibold text-ink">{event}</code>
            {sources.length > 0 && (
              <span className="hook-fishbone-event-badge on">
                {sources.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-caption text-ink-tertiary">
            {t(HOOK_EVENT_DESC_KEYS[event])}
          </p>
          <p
            className="mt-1 text-caption text-ink-tertiary"
            data-testid="hook-diagram-path-note"
          >
            {t(HOOK_EVENT_PATH_NOTE_KEYS[event])}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-caption text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          onClick={onClose}
          data-testid="hook-diagram-expand-close"
        >
          {t('settings.hooks.diagram.collapse')}
        </button>
      </div>

      {sources.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {sources.map((s) => (
            <li
              key={s.pluginId}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-2.5 py-1.5"
              data-testid={`hook-diagram-source-${s.pluginId}`}
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
        <p className="mt-2 text-meta text-ink-tertiary">{t('settings.hooks.diagram.expandEmptyHint')}</p>
      )}

      <p className="mt-2.5 text-caption text-ink-tertiary">
        {t('settings.hooks.diagram.expandScanDisclaimer')}
      </p>
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
    <div className="hook-fishbone-canvas h-[600px] w-full overflow-hidden rounded-xl border border-border">
      <ReactFlow
        className="hook-fishbone-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.28}
        maxZoom={1.45}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.1}
          color="var(--border)"
        />
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
 * Click an event node to expand/collapse declared plugin sources.
 */
export function HookLifecycleDiagram({ plugins }: HookLifecycleDiagramProps) {
  const { t } = useTranslation()
  const [expandedEvent, setExpandedEvent] = useState<HookEvent | null>(null)
  const byEvent = useMemo(() => sourcesByHookEvent(plugins), [plugins])

  const onToggleEvent = useCallback((event: HookEvent) => {
    setExpandedEvent((prev) => (prev === event ? null : event))
  }, [])

  const sources = expandedEvent ? (byEvent.get(expandedEvent) ?? []) : []

  return (
    <div data-testid="hook-lifecycle-diagram">
      <div
        className="mb-2 flex flex-wrap items-center gap-1.5"
        data-testid="hook-diagram-path-chips"
      >
        <span className="hook-fishbone-legend-chip" data-path="main">
          {t('settings.hooks.diagram.pathMain')}
        </span>
        <span className="hook-fishbone-legend-chip" data-path="subagent">
          {t('settings.hooks.diagram.pathSubagent')}
        </span>
        <span className="hook-fishbone-legend-chip" data-path="workflow">
          {t('settings.hooks.diagram.pathWorkflow')}
        </span>
        <span className="hook-fishbone-legend-chip" data-path="excluded">
          {t('settings.hooks.diagram.pathExcluded')}
        </span>
      </div>
      <p className="mb-2 text-caption text-ink-tertiary">
        {t('settings.hooks.diagram.pathWorkflowNote')}
      </p>

      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="hook-fishbone-legend-chip">
          <span className="inline-block size-2 rounded-full bg-accent shadow-[0_0_0_2px] shadow-accent/20" />
          {t('settings.hooks.diagram.legendConfigured')}
        </span>
        <span className="hook-fishbone-legend-chip">
          <span className="inline-block size-2 rounded-full border border-border bg-surface" />
          {t('settings.hooks.diagram.legendAvailable')}
        </span>
        <span className="text-caption text-ink-tertiary/90">
          · {t('settings.hooks.diagram.clickHint')}
        </span>
        <span
          className="text-caption text-ink-tertiary"
          data-testid="hook-diagram-scan-hint"
        >
          · {t('settings.hooks.diagram.scanHint')}
        </span>
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
