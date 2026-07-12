import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { listCatalogItems } from './catalog'
import {
  defaultContextMenuPrefs,
  loadPrefs,
  resetPrefs,
  savePrefs,
} from './prefs'
import type { ContextKind, ContextMenuItemMeta, ContextMenuPrefs } from './types'

/** Stable display order of kinds that currently have catalog entries. */
const KIND_SECTION_ORDER: ContextKind[] = [
  'message',
  'codeBlock',
  'sessionTab',
  'sessionHistory',
  'fileEntry',
]

const KIND_LABEL_KEY = {
  message: 'settings.contextMenu.kinds.message',
  codeBlock: 'settings.contextMenu.kinds.codeBlock',
  sessionTab: 'settings.contextMenu.kinds.sessionTab',
  sessionHistory: 'settings.contextMenu.kinds.sessionHistory',
  fileEntry: 'settings.contextMenu.kinds.fileEntry',
} as const satisfies Partial<Record<ContextKind, string>>

type KindLabelKey = (typeof KIND_LABEL_KEY)[keyof typeof KIND_LABEL_KEY]

/** Reorder catalog meta by preferred id list (unknown ids keep relative order after). */
export function orderCatalogMeta(
  items: ContextMenuItemMeta[],
  order?: string[],
): ContextMenuItemMeta[] {
  if (!order?.length || items.length <= 1) return items.slice()
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered: ContextMenuItemMeta[] = []
  const used = new Set<string>()
  for (const id of order) {
    const item = byId.get(id)
    if (item && !used.has(id)) {
      ordered.push(item)
      used.add(id)
    }
  }
  for (const item of items) {
    if (!used.has(item.id)) ordered.push(item)
  }
  return ordered
}

/** Kinds present in the static catalog, in section order (extras last). */
export function catalogKinds(): ContextKind[] {
  const present = new Set(listCatalogItems().map((m) => m.kind))
  const ordered = KIND_SECTION_ORDER.filter((k) => present.has(k))
  for (const k of present) {
    if (!ordered.includes(k)) ordered.push(k)
  }
  return ordered
}

function persist(prefs: ContextMenuPrefs): ContextMenuPrefs {
  savePrefs(prefs)
  return prefs
}

export function ContextMenuSettings() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<ContextMenuPrefs>(() => loadPrefs())

  const kinds = useMemo(() => catalogKinds(), [])

  /** Catalog labelKey values are static i18n paths; cast for typed t(). */
  const itemLabel = useCallback(
    (labelKey: string) => String(t(labelKey as 'contextMenu.message.copy')),
    [t],
  )

  const kindLabel = useCallback(
    (kind: ContextKind): string => {
      const key = KIND_LABEL_KEY[kind as keyof typeof KIND_LABEL_KEY] as KindLabelKey | undefined
      return key ? t(key) : kind
    },
    [t],
  )

  const update = useCallback((next: ContextMenuPrefs) => {
    setPrefs(persist(next))
  }, [])

  const setVisible = useCallback(
    (id: string, visible: boolean) => {
      const disabled = new Set(prefs.disabledIds)
      if (visible) disabled.delete(id)
      else disabled.add(id)
      update({ ...prefs, disabledIds: [...disabled] })
    },
    [prefs, update],
  )

  const moveItem = useCallback(
    (kind: ContextKind, id: string, direction: -1 | 1) => {
      const catalog = listCatalogItems(kind)
      const current = orderCatalogMeta(catalog, prefs.orderByKind?.[kind]).map((m) => m.id)
      const index = current.indexOf(id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return
      const nextOrder = current.slice()
      const tmp = nextOrder[index]!
      nextOrder[index] = nextOrder[target]!
      nextOrder[target] = tmp
      update({
        ...prefs,
        orderByKind: { ...prefs.orderByKind, [kind]: nextOrder },
      })
    },
    [prefs, update],
  )

  const handleReset = useCallback(() => {
    resetPrefs()
    setPrefs(defaultContextMenuPrefs())
  }, [])

  const disabled = useMemo(() => new Set(prefs.disabledIds), [prefs.disabledIds])

  return (
    <div className="border-t border-border px-6 py-5" data-testid="context-menu-settings">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.contextMenu.title')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">
            {t('settings.contextMenu.description')}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          data-testid="context-menu-settings-reset"
        >
          {t('settings.contextMenu.reset')}
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-5">
        {kinds.map((kind) => {
          const items = orderCatalogMeta(listCatalogItems(kind), prefs.orderByKind?.[kind])
          if (items.length === 0) return null
          return (
            <div key={kind} data-testid={`context-menu-settings-kind-${kind}`}>
              <div className="mb-2 text-body font-medium text-ink-secondary">
                {kindLabel(kind)}
              </div>
              <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface">
                {items.map((item, index) => {
                  const visible = !disabled.has(item.id)
                  const inputId = `ctx-menu-item-${item.id}`
                  const label = itemLabel(item.labelKey)
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5',
                        index > 0 && 'border-t border-border/60',
                      )}
                      data-testid={`context-menu-settings-item-${item.id}`}
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 rounded border-border text-accent focus:ring-accent/60"
                        checked={visible}
                        onChange={(e) => setVisible(item.id, e.target.checked)}
                        aria-label={t('settings.contextMenu.showItem', { label })}
                        data-testid={`context-menu-settings-visible-${item.id}`}
                      />
                      <label
                        htmlFor={inputId}
                        className={cn(
                          'min-w-0 flex-1 cursor-pointer truncate text-body text-ink',
                          !visible && 'text-ink-tertiary line-through',
                        )}
                      >
                        {label}
                      </label>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary',
                            'hover:bg-surface-muted hover:text-ink',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                            'disabled:pointer-events-none disabled:opacity-30',
                          )}
                          disabled={index === 0}
                          onClick={() => moveItem(kind, item.id, -1)}
                          aria-label={t('settings.contextMenu.moveUp', { label })}
                          data-testid={`context-menu-settings-up-${item.id}`}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary',
                            'hover:bg-surface-muted hover:text-ink',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                            'disabled:pointer-events-none disabled:opacity-30',
                          )}
                          disabled={index === items.length - 1}
                          onClick={() => moveItem(kind, item.id, 1)}
                          aria-label={t('settings.contextMenu.moveDown', { label })}
                          data-testid={`context-menu-settings-down-${item.id}`}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
