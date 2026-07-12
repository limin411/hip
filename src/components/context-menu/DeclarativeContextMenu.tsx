import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/ContextMenu'
import { cn } from '@/lib/utils'
import { createContextMenuBuildContext } from './buildContext'
import { CONTEXT_MENUS } from './feature'
import { ContextMenuIcon } from './icons'
import { buildContextMenuItems } from './registry'
import type { ContextKind, ContextMenuItemDef, ContextPayloadMap } from './types'

export type DeclarativeContextMenuProps<K extends ContextKind> = {
  kind: K
  payload: ContextPayloadMap[K]
  children: ReactNode
  className?: string
  /** Optional test id on the trigger wrapper */
  'data-testid'?: string
}

function payloadSessionId(payload: unknown): string | null | undefined {
  if (payload && typeof payload === 'object' && 'sessionId' in payload) {
    return (payload as { sessionId?: string | null }).sessionId
  }
  return undefined
}

/**
 * Registry-driven context menu host.
 * Always modal={false} to avoid stuck body pointer-events when an item opens a Modal.
 * Prevents open when resolved items are empty (no empty chrome).
 */
export function DeclarativeContextMenu<K extends ContextKind>({
  kind,
  payload,
  children,
  className,
  'data-testid': testId,
}: DeclarativeContextMenuProps<K>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ContextMenuItemDef[]>([])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setOpen(false)
        return
      }
      if (!CONTEXT_MENUS) {
        setOpen(false)
        return
      }
      const ctx = createContextMenuBuildContext(t, {
        sessionId: payloadSessionId(payload),
      })
      const built = buildContextMenuItems({ kind, payload } as { kind: ContextKind; payload: ContextPayloadMap[ContextKind] }, ctx)
      if (built.length === 0) {
        setOpen(false)
        setItems([])
        return
      }
      setItems(built)
      setOpen(true)
    },
    [kind, payload, t],
  )

  if (!CONTEXT_MENUS) {
    return <>{children}</>
  }

  return (
    <ContextMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          className={cn(className)}
          data-context-menu-root=""
          data-context-menu-kind={kind}
          data-testid={testId}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      {items.length > 0 ? (
        <ContextMenuContent data-testid="context-menu-content">
          {items.map((item) => (
            <ContextMenuItemRow key={item.id} item={item} />
          ))}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  )
}

function ContextMenuItemRow({ item }: { item: ContextMenuItemDef }) {
  return (
    <>
      {item.separatorBefore ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        data-testid={`context-menu-item-${item.id}`}
        disabled={item.disabled}
        title={item.disabledReason}
        className={cn(item.danger && 'text-danger focus:bg-danger/10')}
        onSelect={() => {
          void item.run()
        }}
      >
        {item.icon ? <ContextMenuIcon name={item.icon} /> : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.shortcut ? <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    </>
  )
}
