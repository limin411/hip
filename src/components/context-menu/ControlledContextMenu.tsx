import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'
import { createContextMenuBuildContext } from './buildContext'
import { CONTEXT_MENUS } from './feature'
import { ContextMenuIcon } from './icons'
import { buildContextMenuItems } from './registry'
import type { ContextKind, ContextMenuItemDef, ContextPayloadMap, ContextRequest } from './types'

export type ControlledContextMenuProps<K extends ContextKind> = {
  kind: K
  payload: ContextPayloadMap[K]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Client (viewport) coordinates for the virtual anchor. */
  point: { x: number; y: number } | null
}

function payloadSessionId(payload: unknown): string | null | undefined {
  if (payload && typeof payload === 'object' && 'sessionId' in payload) {
    return (payload as { sessionId?: string | null }).sessionId
  }
  return undefined
}

const anchorStyle: CSSProperties = {
  position: 'fixed',
  width: 0,
  height: 0,
  padding: 0,
  margin: 0,
  border: 'none',
  overflow: 'hidden',
  pointerEvents: 'none',
  opacity: 0,
}

/**
 * Point-anchored registry menu for hosts that cannot use ContextMenuTrigger
 * (e.g. xterm canvas: intercept `contextmenu`, open at {clientX, clientY}).
 *
 * Spike API choice (PR-9):
 * - Radix ContextMenu is pointer-event/trigger based; controlled `open` alone does not
 *   place content at an arbitrary point without a real contextmenu on a Trigger.
 * - Point-anchored DropdownMenu with a fixed zero-size virtual trigger is the reliable
 *   pattern. Same surface tokens as DropdownMenuContent (matches ContextMenu chrome).
 * - Always `modal={false}` (same as DeclarativeContextMenu).
 * - Empty resolved items → force closed (no empty chrome).
 */
export function ControlledContextMenu<K extends ContextKind>({
  kind,
  payload,
  open,
  onOpenChange,
  point,
}: ControlledContextMenuProps<K>) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ContextMenuItemDef[]>([])

  const built = useMemo(() => {
    if (!open || !CONTEXT_MENUS) return [] as ContextMenuItemDef[]
    const ctx = createContextMenuBuildContext(t, {
      sessionId: payloadSessionId(payload),
    })
    return buildContextMenuItems({ kind, payload } as ContextRequest, ctx)
  }, [open, kind, payload, t])

  useLayoutEffect(() => {
    setItems(built)
    if (open && built.length === 0) {
      onOpenChange(false)
    }
  }, [built, open, onOpenChange])

  // Keep anchor coords in sync while open (parent may set point + open together).
  const left = point?.x ?? 0
  const top = point?.y ?? 0

  useEffect(() => {
    if (!open) setItems([])
  }, [open])

  if (!CONTEXT_MENUS) return null

  const menuOpen = open && items.length > 0

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          data-testid="controlled-context-menu-anchor"
          style={{ ...anchorStyle, left, top }}
        />
      </DropdownMenuTrigger>
      {items.length > 0 ? (
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={0}
          alignOffset={0}
          data-testid="controlled-context-menu-content"
          // Virtual anchor must not steal focus on dismiss — keep xterm / host focused.
          onCloseAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          {items.map((item) => (
            <ControlledMenuItemRow key={item.id} item={item} />
          ))}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  )
}

function ControlledMenuItemRow({ item }: { item: ContextMenuItemDef }) {
  return (
    <>
      {item.separatorBefore ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        data-testid={`context-menu-item-${item.id}`}
        disabled={item.disabled}
        title={item.disabledReason}
        className={cn(item.danger && 'text-danger focus:bg-danger/10')}
        onSelect={() => {
          void Promise.resolve(item.run()).catch(() => {})
        }}
      >
        {item.icon ? <ContextMenuIcon name={item.icon} /> : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </DropdownMenuItem>
    </>
  )
}
