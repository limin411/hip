import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { Avatar } from '@/components/ui/Avatar'
import { StreamingCursor } from './StreamingCursor'
import { MessageActions } from './MessageActions'
import { CodeBlock } from './CodeBlock'
import { TurnTimeline } from './TurnTimeline'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  message: Message
  streaming?: boolean
  isLastAssistant?: boolean
}

export function MessageBubble({ message, streaming, isLastAssistant }: MessageBubbleProps) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'

  return (
    <div className="group flex gap-3">
      {isUser ? (
        <Avatar name={t('chat.user')} size={28} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
          AI
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
          <span>{isUser ? t('chat.you') : 'hip'}</span>
          {message.stopped && (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-normal text-ink-tertiary" data-testid="stopped-badge">
              {t('chat.stopped')}
            </span>
          )}
        </div>
        <div
          className={cn(
            'max-w-none text-[14px] leading-relaxed text-ink',
            '[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]',
            '[&_code]:font-mono [&_code]:text-[12.5px]',
            '[&_table]:my-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
            '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-1.5',
          )}
        >
          {message.role === 'assistant' && (
            <TurnTimeline steps={message.timeline} toolCalls={message.toolCalls} agentRuns={message.agentRuns} />
          )}
          <ReactMarkdown components={{ pre: CodeBlock }}>{message.content}</ReactMarkdown>
          {streaming && <StreamingCursor />}
        </div>
        {!streaming && <MessageActions message={message} isLastAssistant={!!isLastAssistant} />}
      </div>
    </div>
  )
}
