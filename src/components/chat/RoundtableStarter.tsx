import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { useDraftStore } from '@/store/draftStore'
import { ROUNDTABLE_PERSONAS } from '@/lib/roundtable'
import { cn } from '@/lib/utils'

interface RoundtableStarterProps {
  /** Slash skill / skill-arg active — mutually exclusive with roundtable. */
  disabled?: boolean
}

/**
 * Chat empty-state one-shot starter for roundtable framing.
 * Visibility: parent only mounts on chat NewConversation when ROUNDTABLE_STARTER.
 */
export function RoundtableStarter({ disabled = false }: RoundtableStarterProps) {
  const { t } = useTranslation()
  const active = useDraftStore((s) => !!s.draft?.roundtable)
  const setRoundtable = useDraftStore((s) => s.setRoundtable)

  // Mutual exclusion with slash / skill: drop armed state when entry is disabled.
  useEffect(() => {
    if (disabled && active) setRoundtable(false)
  }, [disabled, active, setRoundtable])

  return (
    <div
      className="mt-3 flex w-full flex-col items-center animate-greeting-enter"
      data-testid="roundtable-starter"
    >
      <button
        type="button"
        data-testid="roundtable-chip"
        aria-pressed={active}
        aria-label={t('chat.roundtable.chipAria')}
        disabled={disabled}
        title={disabled ? t('chat.roundtable.disabledHint') : t('chat.roundtable.chipHint')}
        onClick={() => {
          if (disabled) return
          setRoundtable(!active)
        }}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta font-medium',
          'transition-colors duration-chrome focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          active
            ? 'border-effort-max bg-state-hover text-ink shadow-sm'
            : 'border-border bg-surface text-ink-secondary hover:bg-state-hover hover:text-ink',
        )}
      >
        <Users size={14} className={cn(active && 'text-effort-max')} aria-hidden />
        <span className={cn(active && 'effort-max-text')}>{t('chat.roundtable.chip')}</span>
      </button>

      {active && !disabled && (
        <div
          className="mt-2.5 w-full max-w-full rounded-xl border border-border/80 bg-surface-muted/60 px-3 py-2.5"
          data-testid="roundtable-panel"
        >
          <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
            {ROUNDTABLE_PERSONAS.map((id, i) => (
              <span
                key={id}
                data-testid={`roundtable-seat-${id}`}
                className="animate-roundtable-seat inline-flex items-center rounded-md border border-border bg-surface px-2 py-1 text-caption text-ink-secondary"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {t(`chat.roundtable.personas.${id}`)}
              </span>
            ))}
          </div>
          <p className="text-center text-meta leading-snug text-ink-tertiary">
            {t('chat.roundtable.helper')}
          </p>
        </div>
      )}
    </div>
  )
}
