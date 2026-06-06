import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface PanelCardProps {
  children: ReactNode
  className?: string
  /** 阴影强度，默认 'pop' */
  shadow?: 'pop' | 'float'
  /** 挂载入场方向，默认 'none' */
  direction?: 'left' | 'right' | 'none'
}

export function PanelCard({
  children,
  className,
  shadow = 'pop',
  direction = 'none',
}: PanelCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col h-full w-full m-2 overflow-hidden rounded-xl border border-border bg-surface transition-shadow duration-200',
        shadow === 'float' ? 'shadow-float' : 'shadow-pop',
        direction === 'left' && 'animate-in-left',
        direction === 'right' && 'animate-in-right',
        className,
      )}
    >
      {children}
    </div>
  )
}
