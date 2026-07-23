import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId, useActiveSessionStatus, sessionService } from '@/domain'
import { activeModelKey } from '@/lib/modelKey'
import { clampEffortForKey, effortLevelsForKey, resolveEffort } from '@/lib/modelEffort'
import { cn } from '@/lib/utils'

/**
 * Max-tier effort levels get Claude-style purple holographic glow on the slider.
 * `max` always; `xhigh` only when it is the top of the model’s scale (no higher `max`).
 */
export function isMaxBudgetEffort(level: string, levels: readonly string[]): boolean {
  if (level === 'max') return true
  if (level !== 'xhigh') return false
  return levels[levels.length - 1] === 'xhigh'
}

/**
 * Composer control for reasoning effort / thinking intensity.
 * Opens a discrete drag slider (Claude Desktop style). Hidden when the current
 * model does not advertise effort levels in the catalog.
 */
export function EffortLevelPicker() {
  const { t } = useTranslation()
  const draftEffort = useDraftStore((s) => s.draft?.effort)
  const draftModelKey = useDraftStore((s) => s.draft?.modelKey)
  const setDraftEffort = useDraftStore((s) => s.setEffort)
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const status = useActiveSessionStatus()
  const busy = status === 'running'
  const [open, setOpen] = useState(false)
  const sliderId = useId()

  const modelKey =
    activeId && session
      ? session.config.model
        ? `${session.config.llmProvider}/${session.config.model}`
        : activeModelKey(config)
      : (draftModelKey ?? activeModelKey(config))

  const levels = effortLevelsForKey(catalog, modelKey)
  const stored = activeId && session ? session.config.effort : draftEffort

  // Keep stored effort aligned with the *current* model (model switch, catalog refresh).
  // Display-only resolveEffort is not enough — config.effort is what the sidecar sends.
  useEffect(() => {
    if (busy) return
    const next = clampEffortForKey(catalog, modelKey, stored)
    if (next === (stored || undefined)) return
    if (activeId && session) sessionService.setEffort(activeId, next ?? null)
    else setDraftEffort(next)
  }, [activeId, session, busy, catalog, modelKey, stored, setDraftEffort])

  if (!levels) return null

  const current = resolveEffort(stored, levels) ?? defaultFallback(levels)
  const currentIndex = Math.max(0, levels.indexOf(current))
  const levelLabel = t(`chat.effort.levels.${current}`, { defaultValue: current })
  const chipText = t('chat.effort.chip', { level: levelLabel })
  const desc = t(`chat.effort.desc.${current}`, { defaultValue: '' })
  const maxBudget = isMaxBudgetEffort(current, levels)

  const choose = (effort: string) => {
    if (busy) return
    if (activeId && session) sessionService.setEffort(activeId, effort)
    else setDraftEffort(effort)
  }

  const chooseIndex = (index: number) => {
    const next = levels[index]
    if (next) choose(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <ComposerChip
          active={false}
          title={busy ? t('chat.effort.busyTitle') : t('chat.effort.label')}
          aria-label={chipText}
          data-testid="effort-chip"
          disabled={busy}
          aria-disabled={busy}
          className={cn(maxBudget && 'text-effort-max')}
        >
          <Gauge
            size={13}
            strokeWidth={1.75}
            className={cn('shrink-0 opacity-80', maxBudget && 'effort-max-icon')}
            aria-hidden
          />
          <span className="max-w-[160px] truncate" data-testid="effort-chip-label">
            <span className={cn(maxBudget ? 'text-effort-max opacity-90' : 'text-ink-tertiary')}>
              {t('chat.effort.chipPrefix')}
            </span>
            <span className={cn('mx-0.5', maxBudget ? 'text-effort-max opacity-80' : 'text-ink-tertiary')} aria-hidden>
              ·
            </span>
            <span className={cn(maxBudget && 'font-semibold')}>{levelLabel}</span>
          </span>
        </ComposerChip>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(280px,calc(100vw-2rem))] p-3"
        data-testid="effort-popover"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <label htmlFor={sliderId} className="text-meta font-medium text-ink">
            {t('chat.effort.label')}
          </label>
          <span
            className={cn(
              'text-meta font-medium tabular-nums',
              maxBudget ? 'text-effort-max' : 'text-ink-secondary',
            )}
            data-testid="effort-current-label"
          >
            {levelLabel}
          </span>
        </div>

        <EffortSlider
          id={sliderId}
          levels={levels}
          index={currentIndex}
          disabled={busy}
          maxBudget={maxBudget}
          onChange={chooseIndex}
          ariaLabel={t('chat.effort.label')}
          levelAriaLabel={(level) => {
            const label = t(`chat.effort.levels.${level}`, { defaultValue: level })
            return t('chat.effort.chip', { level: label })
          }}
        />

        {desc ? (
          <p className="mt-2 text-caption leading-snug text-ink-tertiary" data-testid="effort-desc">
            {desc}
          </p>
        ) : null}

        {/* Discrete hit targets for tests + keyboard-friendly ticks */}
        <div className="mt-2 flex justify-between gap-0.5" role="group" aria-label={t('chat.effort.label')}>
          {levels.map((level, i) => {
            const label = t(`chat.effort.levels.${level}`, { defaultValue: level })
            const selected = i === currentIndex
            const tickMax = isMaxBudgetEffort(level, levels)
            return (
              <button
                key={level}
                type="button"
                data-testid={`effort-level-${level}`}
                disabled={busy}
                aria-pressed={selected}
                title={label}
                onClick={() => choose(level)}
                className={cn(
                  'min-w-0 flex-1 truncate rounded px-0.5 py-0.5 text-center text-caption transition-colors duration-chrome',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  selected
                    ? tickMax
                      ? 'font-semibold text-effort-max'
                      : 'font-semibold text-ink'
                    : 'text-ink-tertiary hover:text-ink-secondary',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface EffortSliderProps {
  id: string
  levels: readonly string[]
  index: number
  disabled?: boolean
  maxBudget: boolean
  onChange: (index: number) => void
  ariaLabel: string
  levelAriaLabel: (level: string) => string
}

function EffortSlider({
  id,
  levels,
  index,
  disabled,
  maxBudget,
  onChange,
  ariaLabel,
  levelAriaLabel,
}: EffortSliderProps) {
  const max = Math.max(0, levels.length - 1)
  const pct = max === 0 ? 0 : (index / max) * 100

  const ticks = useMemo(
    () => levels.map((_, i) => (max === 0 ? 0 : (i / max) * 100)),
    [levels, max],
  )

  return (
    <div className="select-none px-0.5 py-1">
      <div
        className={cn(
          'relative h-7',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
        data-testid="effort-slider-track"
      >
        {/* Rail */}
        <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-chrome',
              maxBudget ? 'effort-max-track' : 'bg-ink/70',
            )}
            style={{ width: `${pct}%` }}
            data-testid="effort-slider-fill"
            data-max-budget={maxBudget ? 'true' : 'false'}
          />
        </div>

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <span
            key={levels[i]}
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
              i <= index
                ? maxBudget
                  ? 'bg-white/90'
                  : 'bg-surface'
                : 'bg-ink-tertiary/40',
            )}
            style={{ left: `${t}%` }}
          />
        ))}

        {/* Thumb */}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface shadow-sm transition-[left,box-shadow,border-color] duration-chrome',
            maxBudget ? 'effort-max-thumb border-effort-max' : 'border-ink/80',
          )}
          style={{ left: `${pct}%` }}
          data-testid="effort-slider-thumb"
        />

        {/* Native range: interaction + a11y; visuals are the layers above */}
        <input
          id={id}
          type="range"
          min={0}
          max={max}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={levelAriaLabel(levels[index] ?? '')}
          data-testid="effort-slider"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

function defaultFallback(levels: string[]): string {
  return levels.includes('medium') ? 'medium' : levels[0]!
}
