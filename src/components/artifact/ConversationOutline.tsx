import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTree } from 'lucide-react'
import { useActiveMessages } from '@/domain'
import { collectUserTurns } from '@/lib/conversationOutline'
import { jumpToTranscriptMessage } from '@/lib/transcriptJump'
import { cn } from '@/lib/utils'

/**
 * Right-panel directory of the user's sent turns. Click jumps the transcript
 * immediately (sync scroll) and lights the ChatPane landing highlight.
 */
export function ConversationOutline() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const turns = useMemo(() => collectUserTurns(messages), [messages])

  if (turns.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
        data-testid="conversation-outline-empty"
        role="status"
      >
        <ListTree size={22} className="text-ink-tertiary" aria-hidden />
        <p className="text-body text-ink-tertiary">{t('artifact.outlineEmpty')}</p>
      </div>
    )
  }

  return (
    <nav
      className="flex h-full min-h-0 flex-col"
      data-testid="conversation-outline"
      aria-label={t('artifact.outline')}
    >
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1.5">
        {turns.map((turn) => (
          <li key={turn.id} className="m-0 p-0">
            <button
              type="button"
              data-testid={`conversation-outline-item-${turn.id}`}
              data-message-jump={turn.id}
              title={turn.label}
              onClick={() => jumpToTranscriptMessage(turn.id)}
              className={cn(
                'mb-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors',
                'hover:bg-state-hover',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
              )}
            >
              <span
                className="w-5 shrink-0 text-right font-mono text-meta leading-none tabular-nums text-ink-tertiary"
                aria-hidden
              >
                {turn.index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-meta leading-none text-ink">
                {turn.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
