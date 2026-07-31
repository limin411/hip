import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Transcript reading width — chat and code share one column.
 * `min-w-0` so flex parents can shrink; long tables/code respect the cap.
 */
export const CHAT_COLUMN_CLASS = 'mx-auto w-full min-w-0 max-w-4xl'

/**
 * Composer / input dock width — narrower than the transcript column
 * so the input card does not span the full reading width on large screens.
 * Use for InputBar, NewConversation composer, and sticky chrome above the dock.
 */
export const COMPOSER_COLUMN_CLASS = 'mx-auto w-full min-w-0 max-w-2xl'

/**
 * Centered reading column for transcript and composer chrome.
 * Padding is owned by the parent (`px-4` alongside this class).
 */
export function ChatColumn({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(CHAT_COLUMN_CLASS, className)} data-testid="chat-column">
      {children}
    </div>
  )
}
