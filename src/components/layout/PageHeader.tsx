import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  className?: string
}

export function PageHeader({ title, className }: PageHeaderProps) {
  const navigate = useNavigate()
  return (
    <div className={cn('flex h-14 shrink-0 items-center gap-3 border-b border-border px-4', className)}>
      <button
        onClick={() => navigate('/app')}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted"
        title="返回"
      >
        <ArrowLeft size={18} />
      </button>
      <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
    </div>
  )
}
