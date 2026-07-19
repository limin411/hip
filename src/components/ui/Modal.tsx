import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          // Opt out of required Description when chrome only supplies a title (avoids Radix stderr noise).
          aria-describedby={undefined}
        >
          <div
            className={cn(
              'relative z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-overlay outline-none animate-menu-in',
              !resizable && 'max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg',
              className,
            )}
            style={resizable ? { width: size.width, height: size.height } : undefined}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
              <DialogPrimitive.Title className="text-title font-bold tracking-tight text-ink">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted"
                title={t('common.close')}
              >
                <X size={18} />
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
            {footer && (
              <div className="shrink-0 border-t border-border bg-surface-subtle px-5 py-3">{footer}</div>
            )}
            {resizable &&
              RESIZE_HANDLES.map((h) => (
                <div
                  key={h.dir}
                  onPointerDown={(e) => onResizeStart(h.dir, e)}
                  className={cn('absolute select-none', h.dir.includes('-') ? 'z-20' : 'z-10', h.className)}
                />
              ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
