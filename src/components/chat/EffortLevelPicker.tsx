import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Gauge } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId, useActiveSessionStatus, sessionService } from '@/domain'
import { activeModelKey } from '@/lib/modelKey'
import { clampEffortForKey, effortLevelsForKey, resolveEffort } from '@/lib/modelEffort'
import { cn } from '@/lib/utils'

/**
 * High-tier effort levels get Claude-style purple holographic chrome.
 *
 * Count-based (catalog order, 1-based rank):
 * - Model has ≤4 levels → nothing glows.
 * - Model has 5+ levels → the 5th level and every level after it glow
 *   (index ≥ 4), so e.g. a 6-level Claude scale lights both 5th and 6th (`ultra`).
 * Independent of the string id (`max` / `xhigh` / `ultra` / …).
 */
export function isMaxBudgetEffort(level: string, levels: readonly string[]): boolean {
  if (levels.length <= 4) return false
  const index = levels.indexOf(level)
  if (index < 0) return false
  return index >= 4
}

/**
 * Step effort index from a wheel/keyboard delta.
 * Positive step → higher effort; clamps at ends (no wrap).
 */
export function stepEffortIndex(index: number, step: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(length - 1, Math.max(0, index + step))
}

/**
 * Mini intensity meter: `filled` of `total` ticks so list rows still read as an ordered scale.
 * Pure helper — exported for unit tests.
 */
export function EffortIntensityMeter({
  index,
  total,
  maxBudget,
  className,
}: {
  index: number
  total: number
  maxBudget?: boolean
  className?: string
}) {
  const n = Math.max(1, total)
  const filled = Math.min(n, Math.max(0, index + 1))
  return (
    <span
      className={cn('flex shrink-0 items-end gap-px', className)}
      aria-hidden
      data-testid="effort-intensity-meter"
      data-filled={filled}
      data-total={n}
    >
      {Array.from({ length: n }, (_, i) => {
        const on = i < filled
        const isTopTick = i === n - 1
        return (
          <span
            key={i}
            className={cn(
              'w-[2.5px] rounded-[1px] transition-colors duration-chrome',
              i === 0 && 'h-1',
              i === 1 && 'h-1.5',
              i >= 2 && i < n - 1 && 'h-2',
              isTopTick && 'h-2.5',
              n <= 2 && i === 0 && 'h-1.5',
              n <= 2 && i === 1 && 'h-2.5',
              on
                ? maxBudget && isTopTick
                  ? 'bg-effort-max-node'
                  : maxBudget
                    ? 'bg-effort-max-node opacity-80'
                    : 'bg-ink'
                : 'bg-ink-tertiary/30',
            )}
          />
        )
      })}
    </span>
  )
}

/**
 * Composer control for reasoning effort / thinking intensity.
 * Compact dropdown list; wheel on the chip steps levels.
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

  const modelKey =
    activeId && session
      ? session.config.model
        ? `${session.config.llmProvider}/${session.config.model}`
        : activeModelKey(config)
      : (draftModelKey ?? activeModelKey(config))

  const levels = effortLevelsForKey(catalog, modelKey)
  const stored = activeId && session ? session.config.effort : draftEffort
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Latest values for non-passive wheel listeners (chip + open menu).
  const wheelRef = useRef({
    busy: false,
    levels: null as string[] | null,
    currentIndex: 0,
    chooseIndex: (_i: number) => {},
  })

  // Keep stored effort aligned with the *current* model (model switch, catalog refresh).
  useEffect(() => {
    if (busy) return
    const next = clampEffortForKey(catalog, modelKey, stored)
    if (next === (stored || undefined)) return
    if (activeId && session) sessionService.setEffort(activeId, next ?? null)
    else setDraftEffort(next)
  }, [activeId, session, busy, catalog, modelKey, stored, setDraftEffort])

  const choose = (effort: string) => {
    if (busy) return
    if (activeId && session) sessionService.setEffort(activeId, effort)
    else setDraftEffort(effort)
  }

  const current =
    levels != null
      ? (resolveEffort(stored, levels) ?? defaultFallback(levels))
      : ''
  const currentIndex =
    levels != null && current ? Math.max(0, levels.indexOf(current)) : 0

  const chooseIndex = (index: number) => {
    if (!levels) return
    const next = levels[index]
    if (next) choose(next)
  }

  wheelRef.current = { busy, levels, currentIndex, chooseIndex }

  /** Scroll up → higher effort; scroll down → lower. */
  const handleWheelStep = (e: WheelEvent) => {
    const { busy: isBusy, levels: lv, currentIndex: idx, chooseIndex: stepTo } =
      wheelRef.current
    if (isBusy || !lv || lv.length <= 1) return false
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX) || e.deltaY === 0) return false
    e.preventDefault()
    e.stopPropagation()
    // Scroll down the list → higher effort; scroll up → lower (matches menu order).
    const step = e.deltaY > 0 ? 1 : -1
    const next = stepEffortIndex(idx, step, lv.length)
    if (next !== idx) stepTo(next)
    return true
  }

  // Chip: non-passive listener (React onWheel is passive in many browsers).
  useEffect(() => {
    if (!levels) return
    const el = chipRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      handleWheelStep(e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [levels != null])

  // Open menu (portaled): capture-phase on document so wheel over the panel steps levels.
  useEffect(() => {
    if (!open || !levels) return
    const onWheel = (e: WheelEvent) => {
      const menu = menuRef.current
      if (!menu) return
      const target = e.target
      if (!(target instanceof Node) || !menu.contains(target)) return
      handleWheelStep(e)
    }
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => document.removeEventListener('wheel', onWheel, { capture: true })
  }, [open, levels != null])

  if (!levels) return null

  const levelLabel = t(`chat.effort.levels.${current}`, { defaultValue: current })
  const chipText = t('chat.effort.chip', { level: levelLabel })
  const maxBudget = isMaxBudgetEffort(current, levels)
  const currentDesc = t(`chat.effort.desc.${current}`, { defaultValue: '' })

  const chipTitle = busy
    ? t('chat.effort.busyTitle')
    : currentDesc
      ? `${t('chat.effort.label')}\n${currentDesc}`
      : t('chat.effort.label')

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <ComposerChip
          ref={chipRef}
          active={false}
          title={chipTitle}
          aria-label={chipText}
          data-testid="effort-chip"
          disabled={busy}
          aria-disabled={busy}
          className={cn(maxBudget && 'text-effort-max effort-max-chip')}
        >
          <Gauge
            size={13}
            strokeWidth={1.75}
            className={cn('shrink-0', maxBudget && 'effort-max-icon')}
            aria-hidden
          />
          <span className="max-w-[160px] truncate" data-testid="effort-chip-label">
            <span className={cn(maxBudget ? 'effort-max-text opacity-95' : 'text-ink-tertiary')}>
              {t('chat.effort.chipPrefix')}
            </span>
            <span
              className={cn(
                'mx-0.5',
                maxBudget ? 'text-effort-max opacity-70' : 'text-ink-tertiary',
              )}
              aria-hidden
            >
              ·
            </span>
            <span className={cn(maxBudget ? 'effort-max-text font-semibold' : undefined)}>
              {levelLabel}
            </span>
          </span>
        </ComposerChip>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        ref={menuRef}
        align="start"
        className="min-w-[12rem] w-auto max-w-[min(20rem,calc(100vw-2rem))]"
        data-testid="effort-menu"
      >
        <div className="flex items-baseline justify-between gap-3 px-2.5 py-1">
          <span className="shrink-0 text-caption font-medium text-ink-tertiary">
            {t('chat.effort.title', { defaultValue: t('chat.effort.label') })}
          </span>
          {currentDesc ? (
            <span
              className={cn(
                'min-w-0 truncate text-caption text-right leading-snug',
                maxBudget ? 'text-effort-max opacity-80' : 'text-ink-tertiary',
              )}
              data-testid="effort-current-desc"
              title={currentDesc}
            >
              {currentDesc}
            </span>
          ) : null}
        </div>

        {levels.map((level, i) => {
          const selected = level === current
          // Glow only when this high-tier level is the active selection.
          const glow = selected && isMaxBudgetEffort(level, levels)
          const name = t(`chat.effort.levels.${level}`, { defaultValue: level })
          const desc = t(`chat.effort.desc.${level}`, { defaultValue: '' })

          return (
            <DropdownMenuItem
              key={level}
              disabled={busy}
              onSelect={() => choose(level)}
              title={desc || undefined}
              className={cn('gap-2 py-1', glow && 'bg-state-hover')}
              data-testid={`effort-level-${level}`}
              data-selected={selected ? 'true' : 'false'}
              data-max-budget={glow ? 'true' : 'false'}
            >
              <Check
                size={13}
                className={cn(
                  'shrink-0',
                  selected
                    ? glow
                      ? 'text-effort-max opacity-100'
                      : 'opacity-100'
                    : 'opacity-0',
                )}
                aria-hidden
              />

              <EffortIntensityMeter
                index={i}
                total={levels.length}
                maxBudget={glow}
              />

              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-meta',
                  selected && 'font-medium',
                  glow ? 'effort-max-text' : 'text-ink',
                )}
              >
                {name}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function defaultFallback(levels: string[]): string {
  return levels.includes('medium') ? 'medium' : levels[0]!
}
