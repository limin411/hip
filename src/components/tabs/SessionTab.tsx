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
    <div
      data-testid="session-tab"
      className={cn(
        'group flex h-[28px] min-w-[140px] max-w-[200px] items-center gap-1 rounded-md px-2.5 text-body transition-colors',
        active
          ? 'bg-state-active text-ink'
          : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
      )}
    >
      <div
        role="tab"
        tabIndex={0}
        aria-selected={active}
        onClick={onSelect}
        onMouseDown={(e) => e.button === 1 && onClose()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2 outline-none"
      >
        <Icon
          size={14}
          data-testid="surface-icon"
          aria-label={surface}
          className={cn('shrink-0', active ? 'text-accent-strong' : 'text-ink-tertiary')}
        />
        <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
      </div>
      <button
        type="button"
        aria-label={t('tabs.closeTab')}
        onClick={onClose}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity',
          'group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-muted',
        )}
      >
        <X size={12} />
      </button>
    </div>
  )
}
