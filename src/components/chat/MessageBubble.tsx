import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { formatClockTime, formatAbsolute } from '@/lib/datetime'
import { Avatar } from '@/components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { useActiveSessionId } from '@/domain'
import { StreamingCursor } from './StreamingCursor'
import { MessageActions } from './MessageActions'
import { ArtifactCard } from '@/components/artifact/ArtifactCard'
import { ActivityBar } from './ActivityBar'
import { SubAgentCard, splitAgents } from '@/components/artifact/SubAgentCard'
import { groupByAgent } from '@/lib/turnAgents'
import { cn } from '@/lib/utils'
import { normalizeMessageContent } from '@/lib/normalizeMessageContent'
import { activityElapsedMs, formatElapsed } from '@/lib/activitySummary'
import { MarkdownBody } from './MarkdownBody'

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

interface MessageBubbleProps {
  message: Message
  streaming?: boolean
  isLastAssistant?: boolean
}

export function MessageBubble({ message, streaming, isLastAssistant }: MessageBubbleProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const sessionId = useActiveSessionId()
  const isUser = message.role === 'user'

  // Only assistant turns have a timeline / sub-agent runs; skip the work for user bubbles.
  const nested = isUser ? [] : splitAgents(groupByAgent(message, !!streaming)).nested
  const nestedIds = new Set(nested.map((a) => a.agentId))
  const flatSteps = (message.timeline ?? []).filter((s) => !nestedIds.has(s.agentId))

  const displayContent = useMemo(
    () => (isUser ? message.content : normalizeMessageContent(message.content)),
    [isUser, message.content],
  )

  const hasProcess =
    !isUser &&
    ((message.timeline?.length ?? 0) > 0 ||
      (message.toolCalls?.length ?? 0) > 0 ||
      (message.agentRuns?.length ?? 0) > 0)

  const elapsedMs = useMemo(
    () => (isUser ? null : activityElapsedMs(message.agentRuns)),
    [isUser, message.agentRuns],
  )

  return (
    <DeclarativeContextMenu
      kind="message"
      payload={{
        message,
        isLastAssistant: !!isLastAssistant,
        sessionId,
      }}
      className="group flex gap-3"
      data-testid="message-context-menu"
    >
      {isUser ? (
        <Avatar name={t('chat.user')} size={28} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-on-accent">
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
        </div>
        <div
          className={cn(
            !isUser && 'bg-gradient-to-br from-accent/[0.02] to-accent/[0.04] rounded-lg -mx-2 px-2',
          )}
        >
          {message.role === 'assistant' && (hasProcess || streaming) && (
            <div className="mb-1 text-meta text-ink-tertiary" data-testid="message-process">
              <ActivityBar
                steps={flatSteps}
                toolCalls={message.toolCalls}
                agentRuns={message.agentRuns}
                streaming={streaming}
                stopped={!!message.stopped}
                hasAssistantContent={!!displayContent.trim()}
              />
              {nested.map((a) => (
                <SubAgentCard
                  key={a.agentId}
                  agent={a}
                  showTools={false}
                />
              ))}
            </div>
          )}
          <div data-testid="message-answer">
            <MarkdownBody content={displayContent} />
          </div>
          {isUser && message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-meta"
                  data-testid="message-attachment"
                >
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  {a.size !== undefined && (
                    <span className="text-caption text-ink-tertiary">({formatBytes(a.size)})</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {streaming && <StreamingCursor />}
        </div>
        {!streaming && message.role === 'assistant' && (
          <ArtifactCard toolCalls={message.toolCalls} />
        )}
        {!streaming && (
          <div className="mt-1 flex items-center gap-2">
            <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
            {message.role === 'assistant' && message.memoryCitations && message.memoryCitations.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="memory-citations-chip"
                    className="rounded-full bg-accent/10 px-2 py-0.5 text-caption text-accent outline-none transition-colors hover:bg-accent/15 focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    {t('settings.memory.citationsChip', { count: message.memoryCitations.length })}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[12rem] max-w-[20rem] p-2">
                  <ul data-testid="memory-citations-list" className="space-y-1">
                    {message.memoryCitations.map((c) => (
                      <li
                        key={c.memoryId}
                        className="truncate px-1 py-0.5 text-meta text-ink"
                        title={c.title || c.memoryId}
                      >
                        {c.title || c.memoryId}
                      </li>
                    ))}
                  </ul>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {message.role === 'assistant' && (elapsedMs != null || message.usage) && (
              <span
                data-testid="message-usage"
                title={
                  message.usage
                    ? t('chat.usage.io', { input: message.usage.inputTokens, output: message.usage.outputTokens })
                    : undefined
                }
                className="text-caption text-ink-tertiary"
              >
                {[
                  elapsedMs != null ? t('chat.activity.elapsed', { time: formatElapsed(elapsedMs) }) : null,
                  message.usage ? t('chat.usage.tokens', { total: message.usage.totalTokens }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>
    </DeclarativeContextMenu>
  )
}
