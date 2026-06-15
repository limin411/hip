import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string
  size?: number
  shape?: 'circle' | 'square'
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase()
}

export function Avatar({ name, src, size = 32, shape = 'circle', className }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-accent-subtle text-meta font-semibold text-accent-strong',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}
