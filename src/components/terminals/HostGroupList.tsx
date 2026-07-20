import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Server, Trash2, Plug } from 'lucide-react'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export interface HostGroupListProps {
  groups: HostGroup[]
  hosts: TerminalHost[]
  onEditHost: (host: TerminalHost) => void
  onDeleteHost: (host: TerminalHost) => void
  onRenameGroup: (group: HostGroup) => void
  onDeleteGroup: (group: HostGroup) => void
}

/** Flat group list with hosts under each section (K19 — no nesting). */
export function HostGroupList({
  groups,
  hosts,
  onEditHost,
  onDeleteHost,
  onRenameGroup,
  onDeleteGroup,
}: HostGroupListProps) {
  const { t } = useTranslation()

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    [groups],
  )

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

  return (
    <div className="flex flex-col gap-5" data-testid="host-group-list">
      {sortedGroups.map((group) => {
        const groupHosts = hostsByGroup.get(group.id) ?? []
        return (
          <section key={group.id} data-testid={`host-group-${group.id}`}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                {group.name}
              </h3>
              <span className="text-caption text-ink-tertiary">
                {t('terminals.hostsCount', { count: groupHosts.length })}
              </span>
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
            {groupHosts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-meta text-ink-tertiary">
                {t('terminals.groupEmpty')}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {groupHosts.map((h) => (
                  <HostRow
                    key={h.id}
                    host={h}
                    onEdit={onEditHost}
                    onDelete={onDeleteHost}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {(ungrouped.length > 0 || sortedGroups.length === 0) && hosts.length > 0 ? (
        <section data-testid="host-group-ungrouped">
          {sortedGroups.length > 0 ? (
            <div className="mb-2 flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                {t('terminals.ungrouped')}
              </h3>
              <span className="text-caption text-ink-tertiary">
                {t('terminals.hostsCount', { count: ungrouped.length })}
              </span>
            </div>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {ungrouped.map((h) => (
              <HostRow key={h.id} host={h} onEdit={onEditHost} onDelete={onDeleteHost} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function HostRow({
  host,
  onEdit,
  onDelete,
}: {
  host: TerminalHost
  onEdit: (h: TerminalHost) => void
  onDelete: (h: TerminalHost) => void
}) {
  const { t } = useTranslation()
  const subtitle = `${host.username}@${host.hostname}:${host.port}`

  return (
    <li
      data-testid={`host-row-${host.id}`}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5',
        'transition-colors hover:bg-state-hover/40',
      )}
    >
      <Server size={15} className="shrink-0 text-ink-tertiary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{host.label}</div>
        <div className="truncate font-mono text-caption text-ink-tertiary">{subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled
          title={t('terminals.sshComingSoon')}
          data-testid={`host-connect-${host.id}`}
        >
          <Plug size={13} aria-hidden />
          {t('terminals.connect')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={`host-edit-${host.id}`}
          title={t('terminals.editHost')}
          onClick={() => onEdit(host)}
        >
          <Pencil size={14} aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={`host-delete-${host.id}`}
          title={t('terminals.deleteHost')}
          onClick={() => onDelete(host)}
        >
          <Trash2 size={14} aria-hidden />
        </Button>
      </div>
    </li>
  )
}
