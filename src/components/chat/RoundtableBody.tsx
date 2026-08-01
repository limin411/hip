import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { RoundtableMeta } from '@hip/protocol'
import { MarkdownBody } from './MarkdownBody'
import {
  looksLikeRoundtableTranscript,
  parseRoundtableSections,
  type RoundtableSection,
} from '@/lib/roundtableSections'
import { cn } from '@/lib/utils'

interface RoundtableBodyProps {
  content: string
  meta?: RoundtableMeta
  streaming?: boolean
}

/**
 * Foldable multi-round transcript for roundtable assistant turns.
 * Stage conclusions and final decision are visually emphasized.
 */
export function RoundtableBody({ content, meta, streaming }: RoundtableBodyProps) {
  const { t } = useTranslation()
  const useSpecial =
    meta?.convened === true || (meta?.engine === 'loop' && looksLikeRoundtableTranscript(content)) || looksLikeRoundtableTranscript(content)

  const sections = useMemo(
    () => (useSpecial ? parseRoundtableSections(content) : null),
    [content, useSpecial],
  )

  if (!useSpecial || !sections || sections.every((s) => s.kind === 'normal')) {
    return <MarkdownBody content={content} />
  }

  return (
    <div className="flex flex-col gap-2" data-testid="roundtable-body">
      {meta?.convened && (
        <div
          className="flex flex-wrap items-center gap-2 text-meta text-ink-tertiary"
          data-testid="roundtable-meta"
        >
          <span className="rounded-md border border-border bg-surface-muted px-1.5 py-0.5 font-medium text-ink-secondary">
            {t('chat.roundtable.badge')}
          </span>
          {meta.roundsRan != null && (
            <span>
              {t('chat.roundtable.metaRounds', {
                ran: meta.roundsRan,
                planned: meta.roundsPlanned ?? meta.roundsRan,
              })}
            </span>
          )}
          {meta.advisorCalls != null && (
            <span>{t('chat.roundtable.metaAdvisors', { count: meta.advisorCalls })}</span>
          )}
          {meta.earlyExit && (
            <span className="text-warning">{t('chat.roundtable.metaEarlyExit')}</span>
          )}
        </div>
      )}
      {sections.map((sec, i) => (
        <RoundtableSectionBlock key={`${sec.kind}-${i}-${sec.title}`} section={sec} streaming={streaming} />
      ))}
    </div>
  )
}

function RoundtableSectionBlock({
  section,
  streaming,
}: {
  section: RoundtableSection
  streaming?: boolean
}) {
  const { t } = useTranslation()
  const isStage = section.kind === 'stage'
  const isDecision = section.kind === 'decision'
  const isRound = section.kind === 'round'
  const foldable = isRound || section.kind === 'plan'
  const [open, setOpen] = useState(section.defaultOpen || !!streaming)

  if (!foldable) {
    return (
      <section
        data-testid={`roundtable-section-${section.kind}`}
        className={cn(
          isStage &&
            'rounded-lg border-l-4 border-l-effort-max border border-border/80 bg-surface-muted/50 px-3 py-2',
          isDecision &&
            'rounded-lg border border-effort-max/40 bg-surface-muted/40 px-3 py-2',
        )}
      >
        {section.title ? (
          <h3
            className={cn(
              'mb-1.5 text-body font-semibold text-ink',
              isStage && 'effort-max-text',
              isDecision && 'text-ink',
            )}
          >
            {section.title}
          </h3>
        ) : null}
        {section.body.trim() ? <MarkdownBody content={section.body} /> : null}
      </section>
    )
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      data-testid={`roundtable-section-${section.kind}`}
      className="rounded-lg border border-border/80 bg-surface/40"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-meta font-medium text-ink-secondary hover:bg-state-hover">
        <ChevronRight
          size={14}
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-ink">
          {section.title || t('chat.roundtable.sectionFallback')}
        </span>
      </summary>
      {section.body.trim() ? (
        <div className="border-t border-border/60 px-3 py-2">
          <MarkdownBody content={section.body} />
        </div>
      ) : null}
    </details>
  )
}
