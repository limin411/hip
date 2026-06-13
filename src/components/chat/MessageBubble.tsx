import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { formatClockTime, formatAbsolute } from '@/lib/datetime'
import { Avatar } from '@/components/ui/Avatar'
import { StreamingCursor } from './StreamingCursor'
import { MessageActions } from './MessageActions'
import { CodeBlock } from './CodeBlock'
import { TurnTimeline } from './TurnTimeline'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { useProvidersStore } from '@/store/providersStore'
import { computeCost, formatUsd } from '@/lib/usageCost'

const REMARK_PLUGINS = [remarkGfm]
const MD_COMPONENTS: Components = { pre: CodeBlock }

interface MessageBubbleProps {
  message: Message
  streaming?: boolean
  isLastAssistant?: boolean
}

export function MessageBubble({ message, streaming, isLastAssistant }: MessageBubbleProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const isUser = message.role === 'user'
  const activeRate = useProvidersStore((s) => {
    const am = s.config.activeModel
    return am ? s.catalog[am.providerID]?.models[am.modelID]?.cost : undefined
  })

  return (
    <div className="group flex gap-3">
      {isUser ? (
        <Avatar name={t('chat.user')} size={28} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-white">
          AI
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-meta font-medium text-ink-secondary">
          <span>{isUser ? t('chat.you') : 'hip'}</span>
          {message.timestamp > 0 && (
            <span className="text-caption font-normal text-ink-tertiary" title={formatAbsolute(message.timestamp, locale)} data-testid="message-time">
              {formatClockTime(message.timestamp, locale)}
            </span>
          )}
          {message.stopped && (
            <Badge data-testid="stopped-badge">{t('chat.stopped')}</Badge>
          )}
        </div>
        <div
          className={cn(
            'max-w-none text-prose leading-relaxed text-ink',
            '[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-meta',
            '[&_code]:font-mono [&_code]:text-meta',
            '[&_table]:my-2 [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
            '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5',
          )}
        >
          {message.role === 'assistant' && (
            <TurnTimeline steps={message.timeline} toolCalls={message.toolCalls} agentRuns={message.agentRuns} />
          )}
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>{message.content}</ReactMarkdown>
          {streaming && <StreamingCursor />}
        </div>
        {!streaming && (
          <div className="mt-1 flex items-center gap-2">
            <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
            {message.role === 'assistant' && message.usage && (
              <span
                data-testid="message-usage"
                title={t('chat.usage.io', { input: message.usage.inputTokens, output: message.usage.outputTokens })}
                className="text-caption text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"
              >
                {t('chat.usage.tokens', { total: message.usage.totalTokens })}
                {(() => {
                  const cost = computeCost(message.usage, activeRate)
                  return cost === null ? null : ` · ${t('chat.usage.cost', { cost: formatUsd(cost) })}`
                })()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
