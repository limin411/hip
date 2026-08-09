import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { modalMotion, overlayMotion } from './motionClasses'
import { useResizableBox, type Size, type ResizeDir } from './useResizableBox'

/** Visual/behavior role. Omit for legacy (current full scrim + max-w-lg) behavior. */
export type ModalVariant = 'shell' | 'task' | 'confirm'

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
  /**
   * Visual/behavior role. **Default: undefined = legacy** (full scrim + blur,
   * max-w-lg when not resizable). Never defaults to `confirm`.
   */
  variant?: ModalVariant
  /**
   * When true, confirm/task use nested stacking policy (light scrim, no blur).
   * Shell always uses full-strength scrim.
   * Confirm auto-nests when a footer overlay shell is open unless explicitly false.
   */
  nested?: boolean
  /**
   * Extra Esc handler (e.g. Settings L2 pop). Called after closeDisabled check.
   * Return true (or call preventDefault) to stop the shell from closing.
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => boolean | void
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
/** Medium default for task variant when resizable. */
const TASK_DEFAULT_SIZE: Size = { width: 720, height: 560 }
const TASK_DEFAULT_MIN: Size = { width: 480, height: 360 }

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
  variant,
  nested,
  onEscapeKeyDown,
}: ModalProps) {
  const { t } = useTranslation()
  // Confirm is never resizable regardless of prop.
  const effectiveResizable = variant === 'confirm' ? false : !!resizable
  const resolvedDefault =
    defaultSize ?? (variant === 'task' ? TASK_DEFAULT_SIZE : DEFAULT_SIZE)
  const resolvedMin = minSize ?? (variant === 'task' ? TASK_DEFAULT_MIN : DEFAULT_MIN)

  const { size, onResizeStart } = useResizableBox({
    enabled: effectiveResizable,
    defaultSize: resolvedDefault,
    minSize: resolvedMin,
    storageKey,
  })

  // Confirm auto-nests over footer shells unless caller forces nested={false}.
  const overlayOpen = useUiStore((s) => s.overlay != null)
  const effectiveNested =
    nested ?? (variant === 'confirm' && overlayOpen)

  // Nested confirm/task: light scrim without blur. Shell and legacy always full strength.
  const useLightScrim = effectiveNested && (variant === 'confirm' || variant === 'task')

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50',
            useLightScrim
              ? 'bg-overlay-light'
              : 'bg-overlay',
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
            'fixed inset-0 z-50 m-auto flex h-fit flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-overlay outline-none',
            modalMotion,
            // Size constraints by variant. Omit variant → legacy (max-w-lg when not resizable).
            variant === 'shell'
              ? 'max-h-[100dvh]'
              : variant === 'confirm'
                ? 'max-h-[85vh] w-[calc(100vw-2rem)] max-w-sm'
                : variant === 'task'
                  ? cn(
                      'max-h-[85vh] w-[calc(100vw-2rem)]',
                      !effectiveResizable && 'max-w-2xl',
                    )
                  : cn(
                      'max-h-[85vh] w-[calc(100vw-2rem)]',
                      !effectiveResizable && 'max-w-lg',
                    ),
            className,
          )}
          style={effectiveResizable ? { width: size.width, height: size.height } : undefined}
          // Opt out of required Description when chrome only supplies a title (avoids Radix stderr noise).
          aria-describedby={undefined}
          // Shell Esc gate (PR3): document.querySelector('[data-confirm-dialog]')
          {...(variant === 'confirm' ? { 'data-confirm-dialog': true } : {})}
          onEscapeKeyDown={(e) => {
            if (closeDisabled) {
              e.preventDefault()
              return
            }
            // Caller-handled Esc (Settings L2 pop, etc.).
            if (onEscapeKeyDown?.(e as unknown as KeyboardEvent)) {
              e.preventDefault()
              return
            }
            // Shell Esc gate: when a Confirm dialog is open (sibling Dialog.Root),
            // do not also close the shell — Esc should dismiss confirm first.
            if (
              variant === 'shell' &&
              typeof document !== 'undefined' &&
              document.querySelector('[data-confirm-dialog]')
            ) {
              e.preventDefault()
            }
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
                'flex h-7 w-7 items-center justify-center rounded-sm text-ink-tertiary transition-[background-color,color] duration-chrome ease-out hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                closeDisabled && 'pointer-events-none opacity-40',
              )}
              title={t('common.close')}
              data-testid="modal-close"
            >
              <X size={16} strokeWidth={1.75} />
            </DialogPrimitive.Close>
          </div>
          {/*
            Use flex-auto (1 1 auto), not flex-1 (1 1 0%). With h-fit / content-sized
            panels, flex-basis 0% + min-h-0 collapses the body to 0 height so only the
            title bar remains (large resizable dialogs, etc.).
            flex-auto keeps content height for non-resizable modals and still fills
            remaining space when height is fixed (resizable).
            Shell: flex column so large panels can fill height without outer scroll.
          */}
          <div
            className={cn(
              'min-h-0 flex-auto',
              variant === 'shell' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
            )}
          >
            {children}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-border bg-surface-subtle/80 px-5 py-3">
              {footer}
            </div>
          )}
          {effectiveResizable &&
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
