import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string
  size?: number
  shape?: 'circle' | 'square'
  /** Apply brand accent background to initials fallback (no effect when src is set). */
  gradient?: boolean
  /** Apply hover ring border for clickable affordance. */
  ring?: boolean
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase()
}

export function Avatar({ name, src, size = 32, shape = 'circle', gradient, ring, className }: AvatarProps) {
  const hasGradient = gradient && !src
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        !hasGradient && 'bg-accent-subtle text-meta text-accent-strong',
        hasGradient && 'text-meta text-on-accent',
        ring && 'ring-1 ring-transparent hover:ring-border',
        className,
      )}
      style={
        hasGradient
          ? { width: size, height: size, background: 'var(--accent)' }
          : { width: size, height: size }
      }
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}
