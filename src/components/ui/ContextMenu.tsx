import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger
/** Groups label+items so Radix roving-focus keeps keyboard nav within/between groups. */
export const ContextMenuGroup = ContextMenuPrimitive.Group

export const ContextMenuContent = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        'z-50 min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-menu',
        'origin-[var(--radix-context-menu-content-transform-origin)] data-[state=open]:animate-menu-in',
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = 'ContextMenuContent'

export const ContextMenuItem = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-ink outline-none transition-colors',
      'focus:bg-surface-muted data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
))
ContextMenuItem.displayName = 'ContextMenuItem'

export const ContextMenuSeparator = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-border', className)} {...props} />
))
ContextMenuSeparator.displayName = 'ContextMenuSeparator'

export const ContextMenuLabel = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-caption font-medium text-ink-tertiary', className)}
    {...props}
  />
))
ContextMenuLabel.displayName = 'ContextMenuLabel'

/** Display-only shortcut hint (no binding). Place as last child of ContextMenuItem. */
export const ContextMenuShortcut = forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('ml-auto shrink-0 font-mono text-caption tracking-wide text-ink-tertiary', className)}
      {...props}
    />
  ),
)
ContextMenuShortcut.displayName = 'ContextMenuShortcut'
