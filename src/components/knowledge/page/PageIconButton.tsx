import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SpaceIconPicker } from '../SpaceIconPicker'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'

export interface PageIconButtonProps {
  icon: string | null
  onChange: (icon: string | null) => void
  disabled?: boolean
  className?: string
}

export function PageIconButton({
  icon,
  onChange,
  disabled,
  className,
}: PageIconButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="knowledge-page-icon"
          disabled={disabled}
          aria-label={t('knowledge.doc.icon')}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-2xl',
            'text-ink hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
            'disabled:opacity-50',
            className,
          )}
        >
          {icon ? (
            <span aria-hidden>{icon}</span>
          ) : (
            <FileText size={22} className="text-ink-tertiary" strokeWidth={1.5} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" data-testid="knowledge-page-icon-picker">
        <SpaceIconPicker
          value={icon ?? ''}
          onChange={(next) => {
            onChange(next.trim() ? next : null)
            setOpen(false)
          }}
          testIdPrefix="knowledge-page-icon"
        />
      </PopoverContent>
    </Popover>
  )
}
