import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { modalMotion, overlayMotion } from './motionClasses'
import { useResizableBox, type Size, type ResizeDir } from './useResizableBox'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  resizable?: boolean
  defaultSize?: Size
  minSize?: Size
  storageKey?: string
  /** When true, header X is disabled and Escape/outside dismiss is prevented (busy operations). */
  closeDisabled?: boolean
}

/**
 * Portaled floating layers (Popover / Dropdown / Select) render outside Dialog.Content.
 * Without this guard, picking a day in DateField counts as "outside" and closes the modal.
 */
function isPortaledFloatingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      [
        '[data-radix-popper-content-wrapper]',
        '[data-radix-menu-content]',
        '[data-radix-select-content]',
        '[role="listbox"]',
        // DateField month panel (createPortal to body)
        '[data-date-field-panel]',
        // ModelSelectField panel (createPortal to body; includes search input)
        '[data-model-select-panel]',
      ].join(','),
    ),
  )
}

const DEFAULT_SIZE: Size = { width: 960, height: 700 }
const DEFAULT_MIN: Size = { width: 600, height: 440 }

const RESIZE_HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: 'top', className: 'inset-x-0 top-0 h-1.5 cursor-ns-resize' },
  { dir: 'bottom', className: 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize' },
  { dir: 'left', className: 'inset-y-0 left-0 w-1.5 cursor-ew-resize' },
  { dir: 'right', className: 'inset-y-0 right-0 w-1.5 cursor-ew-resize' },
  { dir: 'top-left', className: 'top-0 left-0 h-3 w-3 cursor-nwse-resize' },
  { dir: 'top-right', className: 'top-0 right-0 h-3 w-3 cursor-nesw-resize' },
  { dir: 'bottom-left', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
  { dir: 'bottom-right', className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
]

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
  resizable,
  defaultSize,
  minSize,
  storageKey,
  closeDisabled = false,
}: ModalProps) {
  const { t } = useTranslation()
  const { size, onResizeStart } = useResizableBox({
    enabled: !!resizable,
    defaultSize: defaultSize ?? DEFAULT_SIZE,
    minSize: minSize ?? DEFAULT_MIN,
    storageKey,
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]',
            overlayMotion,
          )}
        />
        {/*
          Content must NOT be full-viewport hit-target. A full-screen Content at z-50 sits
          above portaled Popovers (wrapper often has z-index:auto) and steals day/today
          clicks in DateField — keep the panel sized to its width/height (or h-fit).

          Center with inset + m-auto, not left/top 50% + -translate-*. modalMotion animates
          the individual `scale` property; combining that with transform-based centering
          still flashes the panel to the bottom-right before snapping to center (same
          class of bug as the command palette — see GlobalCommandPalette).
        */}
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-50 m-auto flex h-fit max-h-[85vh] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-overlay outline-none',
            modalMotion,
            !resizable && 'max-w-lg',
            className,
          )}
          style={resizable ? { width: size.width, height: size.height } : undefined}
          // Opt out of required Description when chrome only supplies a title (avoids Radix stderr noise).
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (closeDisabled) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (closeDisabled || isPortaledFloatingTarget(e.target)) {
              e.preventDefault()
            }
          }}
          onFocusOutside={(e) => {
            // DateField / menus portal outside Dialog.Content; keep focus trap from
            // dismissing the modal when those layers receive focus.
            if (closeDisabled || isPortaledFloatingTarget(e.target)) {
              e.preventDefault()
            }
          }}
          onInteractOutside={(e) => {
            if (closeDisabled || isPortaledFloatingTarget(e.target)) {
              e.preventDefault()
            }
          }}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
            <DialogPrimitive.Title className="text-title font-semibold tracking-tight text-ink">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              disabled={closeDisabled}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-[background-color,color,transform] duration-chrome ease-out hover:bg-state-hover hover:text-ink active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                closeDisabled && 'pointer-events-none opacity-40',
              )}
              title={t('common.close')}
              data-testid="modal-close"
            >
              <X size={16} strokeWidth={1.75} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-border bg-surface-subtle/80 px-5 py-3">
              {footer}
            </div>
          )}
          {resizable &&
            RESIZE_HANDLES.map((h) => (
              <div
                key={h.dir}
                onPointerDown={(e) => onResizeStart(h.dir, e)}
                className={cn('absolute select-none', h.dir.includes('-') ? 'z-20' : 'z-10', h.className)}
              />
            ))}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
