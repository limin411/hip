import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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

/** Map continuous 0..1 track ratio → nearest discrete level index. */
export function nearestEffortIndex(ratio: number, levelCount: number): number {
  if (levelCount <= 1) return 0
  const max = levelCount - 1
  return Math.round(Math.min(1, Math.max(0, ratio)) * max)
}

/**
 * Composer control for reasoning effort / thinking intensity.
 * Opens a discrete drag slider with snap nodes (Claude Desktop style).
 * Hidden when the current model does not advertise effort levels in the catalog.
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

  const levelName = (level: string) => t(`chat.effort.levels.${level}`, { defaultValue: level })

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
        className="w-[min(300px,calc(100vw-2rem))] p-3.5"
        data-testid="effort-popover"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <label htmlFor={sliderId} className="text-meta font-medium text-ink">
            {t('chat.effort.label')}
          </label>
          <span
            className={cn(
              'text-meta font-semibold tabular-nums transition-colors duration-chrome',
              maxBudget ? 'text-effort-max' : 'text-ink',
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
          onChange={chooseIndex}
          ariaLabel={t('chat.effort.label')}
          levelLabel={levelName}
        />
      </PopoverContent>
    </Popover>
  )
}

interface EffortSliderProps {
  id: string
  levels: readonly string[]
  index: number
  disabled?: boolean
  onChange: (index: number) => void
  ariaLabel: string
  levelLabel: (level: string) => string
}

/**
 * Discrete value slider with continuous drag feel.
 * Thumb follows the pointer while dragging; value snaps to the nearest node
 * on release (and updates live when the nearest stop changes mid-drag).
 */
function EffortSlider({
  id,
  levels,
  index,
  disabled,
  onChange,
  ariaLabel,
  levelLabel,
}: EffortSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const lastCommitted = useRef(index)
  /** Continuous 0..1 while dragging; null when resting on a discrete stop. */
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const dragRatioRef = useRef<number | null>(null)

  const max = Math.max(0, levels.length - 1)
  const restingRatio = max === 0 ? 0 : index / max
  const ratio = dragRatio ?? restingRatio
  const nearest = nearestEffortIndex(ratio, levels.length)
  const pct = ratio * 100
  const active = dragRatio !== null
  const visualMaxBudget = isMaxBudgetEffort(levels[nearest] ?? '', levels)

  const stops = useMemo(
    () => levels.map((level, i) => ({ level, i, pct: max === 0 ? 0 : (i / max) * 100 })),
    [levels, max],
  )

  useEffect(() => {
    lastCommitted.current = index
  }, [index])

  const ratioFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    return x / rect.width
  }, [])

  const commitNearest = useCallback(
    (r: number, { force = false }: { force?: boolean } = {}) => {
      if (disabled) return
      const next = nearestEffortIndex(r, levels.length)
      if (!force && next === lastCommitted.current) return
      lastCommitted.current = next
      onChange(next)
    },
    [disabled, levels.length, onChange],
  )

  /** Follow finger continuously; commit discrete value when nearest stop changes. */
  const setVisual = useCallback(
    (r: number) => {
      const clamped = Math.min(1, Math.max(0, r))
      dragRatioRef.current = clamped
      setDragRatio(clamped)
      commitNearest(clamped)
    },
    [commitNearest],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      dragging.current = false
      const r = dragRatioRef.current ?? ratioFromClientX(e.clientX)
      commitNearest(r, { force: true })
      dragRatioRef.current = null
      // Clear continuous ratio → thumb eases back to the discrete stop.
      setDragRatio(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [commitNearest, ratioFromClientX],
  )

  const startDrag = (clientX: number, target: HTMLElement, pointerId: number) => {
    if (disabled || max === 0) return
    dragging.current = true
    target.setPointerCapture(pointerId)
    setVisual(ratioFromClientX(clientX))
  }

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-effort-node]')) return
    e.preventDefault()
    startDrag(e.clientX, e.currentTarget, e.pointerId)
  }

  const onNodePointerDown = (e: React.PointerEvent, i: number) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const track = trackRef.current
    if (!track) {
      lastCommitted.current = i
      onChange(i)
      return
    }
    dragging.current = true
    track.setPointerCapture(e.pointerId)
    // Start continuous slide from this node.
    setVisual(max === 0 ? 0 : i / max)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    setVisual(ratioFromClientX(e.clientX))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'Home') {
      e.preventDefault()
      const next = e.key === 'Home' ? 0 : Math.max(0, index - 1)
      lastCommitted.current = next
      onChange(next)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'End') {
      e.preventDefault()
      const next = e.key === 'End' ? max : Math.min(max, index + 1)
      lastCommitted.current = next
      onChange(next)
    }
  }

  // Continuous position along the scale (for fill/node “reached” while dragging).
  const continuousIndex = ratio * max

  return (
    <div className="select-none px-1">
      <div
        ref={trackRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={nearest}
        aria-valuetext={levelLabel(levels[nearest] ?? '')}
        aria-disabled={disabled || undefined}
        data-testid="effort-slider"
        data-dragging={active ? 'true' : 'false'}
        className={cn(
          'relative h-8 touch-none outline-none',
          'focus-visible:ring-2 focus-visible:ring-ink/15 focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-md',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {/* Rail */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-muted"
          data-testid="effort-slider-track"
          aria-hidden
        />

        {/* Fill follows finger continuously while dragging */}
        <div
          className={cn(
            'pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full will-change-[width]',
            active
              ? 'transition-none'
              : 'transition-[width,background] duration-content ease-out',
            visualMaxBudget ? 'effort-max-track' : 'bg-ink/75',
          )}
          style={{ width: `${pct}%` }}
          data-testid="effort-slider-fill"
          data-max-budget={visualMaxBudget ? 'true' : 'false'}
          aria-hidden
        />

        {/* Snap nodes — landmarks; thumb slides freely between them */}
        {stops.map(({ level, i, pct: stopPct }) => {
          const reached = continuousIndex + 0.02 >= i
          const selected = !active && i === index
          const near = active && nearest === i
          const nodeMax = isMaxBudgetEffort(level, levels)
          return (
            <button
              key={level}
              type="button"
              data-effort-node=""
              data-testid={`effort-level-${level}`}
              disabled={disabled}
              tabIndex={-1}
              aria-label={levelLabel(level)}
              title={levelLabel(level)}
              onPointerDown={(e) => onNodePointerDown(e, i)}
              onClick={(e) => {
                e.stopPropagation()
                if (disabled || dragging.current) return
                lastCommitted.current = i
                onChange(i)
              }}
              className={cn(
                'absolute top-1/2 z-[1] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center',
                'rounded-full focus-visible:outline-none',
                'disabled:cursor-not-allowed',
              )}
              style={{ left: `${stopPct}%` }}
            >
              <span
                className={cn(
                  'block rounded-full transition-[transform,background-color,box-shadow,width,height] duration-chrome',
                  selected || near
                    ? cn(
                        'h-2.5 w-2.5',
                        nodeMax || visualMaxBudget
                          ? 'bg-effort-max-node effort-max-node-selected'
                          : 'bg-ink shadow-sm',
                      )
                    : reached
                      ? cn(
                          'h-[5px] w-[5px]',
                          visualMaxBudget ? 'bg-white/90' : 'bg-surface ring-1 ring-ink/25',
                        )
                      : 'h-[5px] w-[5px] bg-ink-tertiary/40',
                )}
                aria-hidden
              />
            </button>
          )
        })}

        {/* Thumb — free while dragging, ease-out snap on release */}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface will-change-[left]',
            active
              ? 'h-4 w-4 transition-none'
              : 'h-3.5 w-3.5 transition-[left,width,height,box-shadow,border-color] duration-content ease-out',
            visualMaxBudget ? 'effort-max-thumb border-effort-max' : 'border-ink/85 shadow-sm',
          )}
          style={{ left: `${pct}%` }}
          data-testid="effort-slider-thumb"
          aria-hidden
        />
      </div>

      {/* End caps only */}
      {levels.length > 1 ? (
        <div className="mt-1 flex justify-between px-0.5" aria-hidden>
          <span className="text-caption text-ink-tertiary">{levelLabel(levels[0]!)}</span>
          <span
            className={cn(
              'text-caption',
              isMaxBudgetEffort(levels[max]!, levels) ? 'text-effort-max' : 'text-ink-tertiary',
            )}
          >
            {levelLabel(levels[max]!)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function defaultFallback(levels: string[]): string {
  return levels.includes('medium') ? 'medium' : levels[0]!
}
