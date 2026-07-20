import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { formatClockTime, formatAbsolute } from '@/lib/datetime'
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
import { normalizeMessageContent } from '@/lib/normalizeMessageContent'
import { activityElapsedMs, formatElapsed } from '@/lib/activitySummary'
import { MarkdownBody } from './MarkdownBody'
import { TRANSCRIPT_INTERLEAVED_BLOCKS } from './feature'
import { hasRenderableSupervisorText } from '@/lib/timelineFilter'
import { cn } from '@/lib/utils'

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Muted system notice row (background task notifications). Pure — no hooks. */
function NoticeRowImpl({ content }: { content: string }) {
  return (
    <div className="my-1 w-fit px-0 py-0.5 text-meta text-ink-tertiary" data-testid="chat-notice">
      {content}
    </div>
  )
}

/** Memoized notice row — only re-renders when `content` changes. */
export const NoticeRow = memo(NoticeRowImpl)
NoticeRow.displayName = 'NoticeRow'

interface MessageBubbleProps {
  message: Message
  streaming?: boolean
  isLastAssistant?: boolean
  /** Hide in-bubble TodoChecklist when sticky PlanProgressPanel shows the live plan. */
  hidePlan?: boolean
}

/**
 * Render-relevant equality for a Message. Prefers reference equality (store keeps
 * unchanged message objects stable); falls back to field identity for nested arrays
 * that the store also replaces only when they change.
 */
export function messageRenderEqual(a: Message, b: Message): boolean {
  if (a === b) return true
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.timestamp === b.timestamp &&
    a.stopped === b.stopped &&
    a.agentId === b.agentId &&
    a.timeline === b.timeline &&
    a.toolCalls === b.toolCalls &&
    a.agentRuns === b.agentRuns &&
    a.attachments === b.attachments &&
    a.memoryCitations === b.memoryCitations &&
    a.usage === b.usage
  )
}

/** Custom memo compare: id + content + timeline + toolCalls + status-relevant flags. */
export function areMessageBubblePropsEqual(
  prev: MessageBubbleProps,
  next: MessageBubbleProps,
): boolean {
  return (
    prev.streaming === next.streaming &&
    prev.isLastAssistant === next.isLastAssistant &&
    prev.hidePlan === next.hidePlan &&
    messageRenderEqual(prev.message, next.message)
  )
}

/** Chat message bubble for user|assistant. Prefer routing `role:'notice'` via {@link NoticeRow}. */
function MessageBubbleImpl({ message, streaming, isLastAssistant, hidePlan }: MessageBubbleProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const sessionId = useActiveSessionId()
  const isUser = message.role === 'user'
  const isNotice = message.role === 'notice'

  // Only assistant turns have a timeline / sub-agent runs; skip the work for user/notice bubbles.
  // Nested subagents still get SubAgentCard summaries; TurnTimeline receives the full timeline
  // so per-agent tool order is preserved (not stripped before ActivityBar).
  const nested = isUser || isNotice ? [] : splitAgents(groupByAgent(message, !!streaming)).nested

  const displayContent = useMemo(
    () => (isUser || isNotice ? message.content : normalizeMessageContent(message.content)),
    [isUser, isNotice, message.content],
  )

  const hasProcess =
    !isUser &&
    !isNotice &&
    ((message.timeline?.length ?? 0) > 0 ||
      (message.toolCalls?.length ?? 0) > 0 ||
      (message.agentRuns?.length ?? 0) > 0)

  // PR-5 / KD-2 / O4–O5: enable TurnBlocks only when flag is on AND there is at least
  // one non-empty supervisor text step (after sanitize+normalize). Avoids flattening
  // multi-agent chrome for ACP/old turns, and blank answers when all text is whitespace.
  // Flag off always uses legacy content body; text steps are skipped in TurnTimeline.
  const interleavedBlocks =
    TRANSCRIPT_INTERLEAVED_BLOCKS &&
    !isUser &&
    hasRenderableSupervisorText(message.timeline)
  const hideAnswerBody = interleavedBlocks

  const elapsedMs = useMemo(
    () => (isUser || isNotice ? null : activityElapsedMs(message.agentRuns)),
    [isUser, isNotice, message.agentRuns],
  )

  // After all hooks — Rules of Hooks safe if role ever flips on the same instance.
  if (isNotice) return <NoticeRow content={message.content} />

  return (
    <DeclarativeContextMenu
      kind="message"
      payload={{
        message,
        isLastAssistant: !!isLastAssistant,
        sessionId,
      }}
      className="min-w-0 w-full"
      data-testid="message-context-menu"
    >
      {/* CLI-style: role + time on one quiet meta line */}
      <div className="mb-1.5 flex min-h-[var(--trail-min-h)] items-center gap-[var(--meta-gap)] text-meta leading-5 text-ink-tertiary">
        <span className="font-medium text-ink-secondary" data-testid="message-role">
          {isUser ? t('chat.you') : 'hip'}
        </span>
        {message.timestamp > 0 && (
          <span className="font-normal tabular-nums" title={formatAbsolute(message.timestamp, locale)} data-testid="message-time">
            {formatClockTime(message.timestamp, locale)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        {message.role === 'assistant' && (hasProcess || streaming) && (
          // O3: when interleaved, do not force text-meta/tertiary on the whole process
          // region so supervisor text blocks keep primary answer weight (MarkdownBody ink).
          <div
            className={cn('mb-1', !interleavedBlocks && 'text-meta text-ink-tertiary')}
            data-testid="message-process"
            data-interleaved={interleavedBlocks ? 'true' : undefined}
          >
            <ActivityBar
              steps={message.timeline}
              toolCalls={message.toolCalls}
              agentRuns={message.agentRuns}
              streaming={streaming}
              stopped={!!message.stopped}
              hasAssistantContent={!!displayContent.trim()}
              hidePlan={hidePlan}
              interleaved={interleavedBlocks}
            />
            {nested.map((a) => (
              <SubAgentCard
                key={a.agentId}
                agent={a}
                showTools={!!streaming || a.status === 'running'}
              />
            ))}
          </div>
        )}
        {!hideAnswerBody && (
          <div data-testid="message-answer">
            <MarkdownBody content={displayContent} />
          </div>
        )}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1 border border-border bg-surface-muted px-2 py-1 text-meta"
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
        <div className="mt-1 flex min-h-[var(--trail-min-h)] items-center gap-[var(--meta-gap)] text-meta leading-5">
          <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
          {message.role === 'assistant' && message.memoryCitations && message.memoryCitations.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="memory-citations-chip"
                  className="bg-accent/10 px-1.5 py-0.5 text-meta leading-5 text-accent outline-none transition-colors hover:bg-accent/15 focus-visible:ring-1 focus-visible:ring-accent"
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
              className="text-ink-tertiary"
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
    </DeclarativeContextMenu>
  )
}

/** Memoized bubble — skips re-render when message + streaming/last/hidePlan flags are equal. */
export const MessageBubble = memo(MessageBubbleImpl, areMessageBubblePropsEqual)
MessageBubble.displayName = 'MessageBubble'

export type { MessageBubbleProps }
