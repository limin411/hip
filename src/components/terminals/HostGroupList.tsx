import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, Pencil, Plus, Server, Trash2, Plug } from 'lucide-react'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { sortGroupsByName } from '@/lib/hostGroupUi'
import { EmptyState } from '@/components/ui/EmptyState'
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

/** Left group nav + right host list for the selected group. */
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
  const showUngrouped = ungrouped.length > 0 || sortedGroups.length === 0

  const navKeys = useMemo(() => {
    const keys = sortedGroups.map((g) => g.id)
    if (showUngrouped) keys.push(UNGROUPED_KEY)
    return keys
  }, [sortedGroups, showUngrouped])

  const [selectedKey, setSelectedKey] = useState<string>(() => navKeys[0] ?? UNGROUPED_KEY)

  // Keep selection valid when groups/hosts change.
  useEffect(() => {
    if (navKeys.length === 0) return
    if (!navKeys.includes(selectedKey)) {
      setSelectedKey(navKeys[0])
    }
  }, [navKeys, selectedKey])

  const selectedGroup =
    selectedKey === UNGROUPED_KEY
      ? null
      : (sortedGroups.find((g) => g.id === selectedKey) ?? null)

  const selectedHosts =
    selectedKey === UNGROUPED_KEY
      ? ungrouped
      : (hostsByGroup.get(selectedKey) ?? [])

  const selectedGroupIdForAdd =
    selectedKey === UNGROUPED_KEY ? null : selectedKey

  return (
    <div
      className="flex h-full min-h-0 flex-1 overflow-hidden"
      data-testid="host-group-list"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="host-group-detail">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <h3 className="min-w-0 flex-1 truncate text-body font-medium text-ink">
            {selectedGroup ? selectedGroup.name : t('terminals.ungrouped')}
          </h3>
          <span className="shrink-0 text-caption text-ink-tertiary">
            {t('terminals.hostsCount', { count: selectedHosts.length })}
          </span>
          {onAddHost ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid={
                selectedKey === UNGROUPED_KEY
                  ? 'host-add-ungrouped'
                  : `host-add-${selectedKey}`
              }
              onClick={() => onAddHost(selectedGroupIdForAdd)}
            >
              <Plus size={14} aria-hidden />
              {t('terminals.addHost')}
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selectedHosts.length === 0 ? (
            <EmptyState
              icon={Folder}
              tier="professional"
              title={t('terminals.groupEmpty')}
              className="py-10"
              data-testid="host-group-empty"
              action={
                onAddHost
                  ? {
                      label: t('terminals.addHost'),
                      onClick: () => onAddHost(selectedGroupIdForAdd),
                      'data-testid':
                        selectedKey === UNGROUPED_KEY
                          ? 'host-add-ungrouped-empty'
                          : `host-add-${selectedKey}-empty`,
                    }
                  : undefined
              }
            />
          ) : (
            <ul className="flex flex-col gap-1" data-testid="host-list">
              {selectedHosts.map((h) => (
                <li key={h.id}>
                  <HostRow
                    host={h}
                    onEdit={onEditHost}
                    onDelete={onDeleteHost}
                    onConnect={onConnectHost}
                    connectBusy={connectBusy}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside
        className="flex w-52 shrink-0 flex-col border-l border-border bg-surface-subtle/40"
        data-testid="host-group-nav"
      >
        <nav
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
          aria-label={t('terminals.groupsNavAria')}
        >
          {sortedGroups.map((group) => {
            const count = (hostsByGroup.get(group.id) ?? []).length
            const selected = selectedKey === group.id
            return (
              <div
                key={group.id}
                data-testid={`host-group-${group.id}`}
                className={cn(
                  'group/nav flex items-center gap-0.5 rounded-lg pr-0.5',
                  selected && 'bg-state-active',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`host-group-select-${group.id}`}
                  onClick={() => setSelectedKey(group.id)}
                  className={cn(
                    'flex h-[var(--row-h-sidebar)] min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-meta font-medium transition-colors',
                    'text-ink-secondary hover:bg-state-hover hover:text-ink',
                    selected && 'text-ink',
                  )}
                >
                  <Folder size={15} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="shrink-0 tabular-nums text-caption text-ink-tertiary">
                    {count}
                  </span>
                </button>
                <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover/nav:opacity-100 group-focus-within/nav:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
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
                    className="h-7 w-7"
                    data-testid={`host-group-delete-${group.id}`}
                    title={t('terminals.deleteGroup')}
                    onClick={() => onDeleteGroup(group)}
                  >
                    <Trash2 size={13} aria-hidden />
                  </Button>
                </div>
              </div>
            )
          })}

          {showUngrouped ? (
            <div
              data-testid="host-group-ungrouped"
              className={cn(
                'flex items-center rounded-lg',
                selectedKey === UNGROUPED_KEY && 'bg-state-active',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selectedKey === UNGROUPED_KEY}
                data-testid="host-group-select-ungrouped"
                onClick={() => setSelectedKey(UNGROUPED_KEY)}
                className={cn(
                  'flex h-[var(--row-h-sidebar)] min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-meta font-medium transition-colors',
                  'text-ink-secondary hover:bg-state-hover hover:text-ink',
                  selectedKey === UNGROUPED_KEY && 'text-ink',
                )}
              >
                <Server size={15} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t('terminals.ungrouped')}</span>
                <span className="shrink-0 tabular-nums text-caption text-ink-tertiary">
                  {ungrouped.length}
                </span>
              </button>
            </div>
          ) : null}
        </nav>
      </aside>
    </div>
  )
}

function HostRow({
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
  const activeSessions = useManagedTerminalStore((s) =>
    s.terminals.some((mt) => mt.hostId === host.id),
  )

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
        'group flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-[var(--row-pad-y-session)]',
        'transition-colors hover:border-strong hover:bg-surface-subtle',
        canConnect &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
      )}
    >
      <Server size={16} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {activeSessions ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
              role="img"
              title={t('terminals.connected')}
              aria-label={t('terminals.connected')}
              data-testid={`host-connected-${host.id}`}
            />
          ) : null}
          <span className="truncate text-body font-medium text-ink">{host.label}</span>
        </div>
        <div className="truncate font-mono text-caption text-ink-tertiary">{subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
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
        <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
