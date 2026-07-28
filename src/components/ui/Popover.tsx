import * as PopoverPrimitive from '@radix-ui/react-popover'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { menuMotion } from './motionClasses'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverClose = PopoverPrimitive.Close

export const PopoverContent = forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, style, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // z-index must win over Modal (z-50). Inline style reaches the positioned
      // layer more reliably than Tailwind alone on some Radix wrapper setups.
      // Caller may raise further (e.g. ModelSelectField uses 100).
      style={{ zIndex: 60, ...style }}
      className={cn(
        'z-[60] w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 shadow-menu outline-none',
        'origin-[var(--radix-popover-content-transform-origin)]',
        menuMotion,
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'
