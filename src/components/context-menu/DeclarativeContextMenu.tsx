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
  /**
   * Classes on the trigger wrapper div (layout-affecting).
   * Prefer putting flex/grid/size classes here — the host always wraps children in an extra box
   * for data-context-menu-* attrs and asChild.
   */
  className?: string
  /** Optional test id on the trigger wrapper */
  'data-testid'?: string
  /** e.g. false on session tabs inside the titlebar drag region */
  'data-tauri-drag-region'?: string
}

function payloadSessionId(payload: unknown): string | null | undefined {
  if (payload && typeof payload === 'object' && 'sessionId' in payload) {
    return (payload as { sessionId?: string | null }).sessionId
  }
  return undefined
}

/**
 * Registry-driven context menu host.
 *
 * - Always `modal={false}` to avoid stuck body pointer-events when an item opens a Modal.
 * - Prevents open when resolved items are empty (no empty chrome).
 * - Empty open attempt still consumes the browser `contextmenu` event (Radix Trigger) —
 *   no OS menu either. Surface PRs must only wrap nodes expected to have items (or always
 *   provide at least one action); do not wrap broad empty chrome.
 * - Providers own error UX for `run()`; the host swallows unhandled rejections so a failed
 *   async action does not become an unhandled promise rejection.
 */
export function DeclarativeContextMenu<K extends ContextKind>({
  kind,
  payload,
  children,
  className,
  'data-testid': testId,
  'data-tauri-drag-region': tauriDragRegion,
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
      const built = buildContextMenuItems(
        { kind, payload } as { kind: ContextKind; payload: ContextPayloadMap[ContextKind] },
        ctx,
      )
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

  // Feature-off: still apply layout className so surfaces that put flex/group/relative
  // on the host do not break when CONTEXT_MENUS is rolled back.
  if (!CONTEXT_MENUS) {
    return (
      <div className={cn(className)} data-testid={testId}>
        {children}
      </div>
    )
  }

  return (
    <ContextMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          className={cn(className)}
          data-context-menu-root=""
          data-context-menu-kind={kind}
          data-testid={testId}
          data-tauri-drag-region={tauriDragRegion}
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
          // Providers should toast on failure; catch avoids unhandled rejection noise.
          void Promise.resolve(item.run()).catch(() => {})
        }}
      >
        {item.icon ? <ContextMenuIcon name={item.icon} /> : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.shortcut ? <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    </>
  )
}
