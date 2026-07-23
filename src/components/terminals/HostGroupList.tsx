import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Pencil, Plus, Server, Trash2, Plug } from 'lucide-react'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import { sortGroupsByName } from '@/lib/hostGroupUi'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export interface HostGroupListProps {
  groups: HostGroup[]
  hosts: TerminalHost[]
  onEditHost: (host: TerminalHost) => void
  onDeleteHost: (host: TerminalHost) => void
  onRenameGroup: (group: HostGroup) => void
  onDeleteGroup: (group: HostGroup) => void
  onConnectHost?: (host: TerminalHost) => void
  /** Create host; `groupId` null = ungrouped. */
  onAddHost?: (groupId: string | null) => void
  connectBusy?: boolean
}

const UNGROUPED_KEY = '__ungrouped__'

const hostGridClass =
  'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

/** Flat group list with hosts as cards under each collapsible section (K19 — no nesting). */
export function HostGroupList({
  groups,
  hosts,
  onEditHost,
  onDeleteHost,
  onRenameGroup,
  onDeleteGroup,
  onConnectHost,
  onAddHost,
  connectBusy,
}: HostGroupListProps) {
  const { t } = useTranslation()
  /** Collapsed group keys (missing = expanded). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Product rule: always name ascending (ignore stored `sort`).
  const sortedGroups = useMemo(() => sortGroupsByName(groups), [groups])

  const hostsByGroup = useMemo(() => {
    const map = new Map<string | null, TerminalHost[]>()
    map.set(null, [])
    for (const g of sortedGroups) map.set(g.id, [])
    for (const h of hosts) {
      const key = h.groupId && map.has(h.groupId) ? h.groupId : null
      const list = map.get(key) ?? []
      list.push(h)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label) || a.hostname.localeCompare(b.hostname))
    }
    return map
  }, [hosts, sortedGroups])

  const ungrouped = hostsByGroup.get(null) ?? []

  const isExpanded = (key: string) => collapsed[key] !== true
  const toggle = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="flex flex-col gap-5" data-testid="host-group-list">
      {sortedGroups.map((group) => {
        const groupHosts = hostsByGroup.get(group.id) ?? []
        const open = isExpanded(group.id)
        return (
          <section key={group.id} data-testid={`host-group-${group.id}`}>
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                data-testid={`host-group-toggle-${group.id}`}
                aria-expanded={open}
                title={open ? t('terminals.collapseGroup') : t('terminals.expandGroup')}
                onClick={() => toggle(group.id)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left',
                  'transition-colors hover:bg-state-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                )}
              >
                {open ? (
                  <ChevronDown size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                )}
                <h3 className="min-w-0 flex-1 truncate text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                  {group.name}
                </h3>
                <span className="shrink-0 text-caption text-ink-tertiary">
                  {t('terminals.hostsCount', { count: groupHosts.length })}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid={`host-group-rename-${group.id}`}
                title={t('terminals.renameGroup')}
                onClick={() => onRenameGroup(group)}
              >
                <Pencil size={13} aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid={`host-group-delete-${group.id}`}
                title={t('terminals.deleteGroup')}
                onClick={() => onDeleteGroup(group)}
              >
                <Trash2 size={13} aria-hidden />
              </Button>
            </div>
            {open ? (
              <div className={hostGridClass}>
                {groupHosts.map((h) => (
                  <HostCard
                    key={h.id}
                    host={h}
                    onEdit={onEditHost}
                    onDelete={onDeleteHost}
                    onConnect={onConnectHost}
                    connectBusy={connectBusy}
                  />
                ))}
                {onAddHost ? (
                  <AddHostCard
                    testId={`host-add-${group.id}`}
                    onClick={() => onAddHost(group.id)}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        )
      })}

      {(ungrouped.length > 0 || sortedGroups.length === 0) && hosts.length > 0 ? (
        <section data-testid="host-group-ungrouped">
          {sortedGroups.length > 0 ? (
            <>
              <div className="mb-2 flex items-center gap-1">
                <button
                  type="button"
                  data-testid="host-group-toggle-ungrouped"
                  aria-expanded={isExpanded(UNGROUPED_KEY)}
                  title={
                    isExpanded(UNGROUPED_KEY)
                      ? t('terminals.collapseGroup')
                      : t('terminals.expandGroup')
                  }
                  onClick={() => toggle(UNGROUPED_KEY)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left',
                    'transition-colors hover:bg-state-hover',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  )}
                >
                  {isExpanded(UNGROUPED_KEY) ? (
                    <ChevronDown size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                  )}
                  <h3 className="min-w-0 flex-1 truncate text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                    {t('terminals.ungrouped')}
                  </h3>
                  <span className="shrink-0 text-caption text-ink-tertiary">
                    {t('terminals.hostsCount', { count: ungrouped.length })}
                  </span>
                </button>
              </div>
              {isExpanded(UNGROUPED_KEY) ? (
                <div className={hostGridClass}>
                  {ungrouped.map((h) => (
                    <HostCard
                      key={h.id}
                      host={h}
                      onEdit={onEditHost}
                      onDelete={onDeleteHost}
                      onConnect={onConnectHost}
                      connectBusy={connectBusy}
                    />
                  ))}
                  {onAddHost ? (
                    <AddHostCard
                      testId="host-add-ungrouped"
                      onClick={() => onAddHost(null)}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className={hostGridClass}>
              {ungrouped.map((h) => (
                <HostCard
                  key={h.id}
                  host={h}
                  onEdit={onEditHost}
                  onDelete={onDeleteHost}
                  onConnect={onConnectHost}
                  connectBusy={connectBusy}
                />
              ))}
              {onAddHost ? (
                <AddHostCard
                  testId="host-add-ungrouped"
                  onClick={() => onAddHost(null)}
                />
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

function HostCard({
  host,
  onEdit,
  onDelete,
  onConnect,
  connectBusy,
}: {
  host: TerminalHost
  onEdit: (h: TerminalHost) => void
  onDelete: (h: TerminalHost) => void
  onConnect?: (h: TerminalHost) => void
  connectBusy?: boolean
}) {
  const { t } = useTranslation()
  const subtitle = `${host.username}@${host.hostname}:${host.port}`
  const canConnect = Boolean(onConnect) && !connectBusy

  return (
    <div
      data-testid={`host-row-${host.id}`}
      role={canConnect ? 'button' : undefined}
      tabIndex={canConnect ? 0 : undefined}
      onClick={() => {
        if (canConnect) onConnect?.(host)
      }}
      onKeyDown={(e) => {
        if (!canConnect) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onConnect?.(host)
        }
      }}
      className={cn(
        'group relative flex min-h-[120px] flex-col rounded-lg border border-border bg-surface p-4',
        'transition-colors hover:bg-surface-subtle',
        canConnect && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-ink-tertiary">
          <Server size={18} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-ink">{host.label}</div>
          <div className="mt-0.5 truncate font-mono text-caption text-ink-tertiary">{subtitle}</div>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canConnect}
          title={t('terminals.connect')}
          data-testid={`host-connect-${host.id}`}
          onClick={(e) => {
            e.stopPropagation()
            onConnect?.(host)
          }}
        >
          <Plug size={13} aria-hidden />
          {t('terminals.connect')}
        </Button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid={`host-edit-${host.id}`}
            title={t('terminals.editHost')}
            onClick={(e) => {
              e.stopPropagation()
              onEdit(host)
            }}
          >
            <Pencil size={14} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid={`host-delete-${host.id}`}
            title={t('terminals.deleteHost')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(host)
            }}
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}

function AddHostCard({
  testId,
  onClick,
}: {
  testId: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border',
        'bg-transparent px-4 py-6 text-ink-tertiary',
        'transition-colors hover:border-ink/25 hover:bg-state-hover/40 hover:text-ink-secondary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border">
        <Plus size={18} aria-hidden />
      </span>
      <span className="text-meta font-medium">{t('terminals.addHost')}</span>
    </button>
  )
}
