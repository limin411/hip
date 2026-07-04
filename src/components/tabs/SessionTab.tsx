import { useTranslation } from 'react-i18next'
import { MessageSquare, FolderGit2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionVM } from '@/domain'
import { surfaceOf } from '@/lib/sessions'

interface SessionTabProps {
  session: SessionVM
  active: boolean
  onSelect: () => void
  onClose: () => void
}

const ICON = {
  chat: MessageSquare,
  code: FolderGit2,
}

export function SessionTab({ session, active, onSelect, onClose }: SessionTabProps) {
  const { t } = useTranslation()
  const surface = surfaceOf(session.config)
  const Icon = ICON[surface] ?? MessageSquare

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseDown={(e) => e.button === 1 && onClose()}
      className={cn(
        'group flex h-[33px] min-w-[140px] max-w-[200px] items-center gap-2 rounded-t-md border border-transparent border-b-0 px-2.5 text-body transition-colors',
        active
          ? 'bg-app border-border text-ink'
          : 'text-ink-tertiary hover:bg-surface-muted hover:text-ink',
      )}
    >
      <Icon size={14} className={cn('shrink-0', active ? 'text-accent-strong' : 'text-ink-tertiary')} />
      <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('tabs.closeTab')}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            onClose()
          }
        }}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity',
          'group-hover:opacity-100 hover:bg-surface-muted',
        )}
      >
        <X size={12} />
      </span>
    </button>
  )
}
