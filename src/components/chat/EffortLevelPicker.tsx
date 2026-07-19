import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, Check } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId, useActiveSessionStatus, sessionService } from '@/domain'
import { activeModelKey } from '@/lib/modelKey'
import { clampEffortForKey, effortLevelsForKey, resolveEffort } from '@/lib/modelEffort'
import { cn } from '@/lib/utils'

/**
 * Composer chip for reasoning effort / thinking intensity.
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
  const levelLabel = t(`chat.effort.levels.${current}`, { defaultValue: current })
  const chipText = t('chat.effort.chip', { level: levelLabel })

  const choose = (effort: string) => {
    if (busy) return
    if (activeId && session) sessionService.setEffort(activeId, effort)
    else setDraftEffort(effort)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip
          active={current !== 'medium' && current !== 'none'}
          title={busy ? t('chat.effort.busyTitle') : t('chat.effort.label')}
          aria-label={chipText}
          data-testid="effort-chip"
          disabled={busy}
          aria-disabled={busy}
        >
          <Gauge size={13} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
          <span className="max-w-[160px] truncate" data-testid="effort-chip-label">
            <span className="text-ink-tertiary">{t('chat.effort.chipPrefix')}</span>
            <span className="mx-0.5 text-ink-tertiary" aria-hidden>
              ·
            </span>
            <span>{levelLabel}</span>
          </span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {levels.map((level) => {
          const label = t(`chat.effort.levels.${level}`, { defaultValue: level })
          const desc = t(`chat.effort.desc.${level}`, { defaultValue: '' })
          return (
            <DropdownMenuItem
              key={level}
              onSelect={() => choose(level)}
              className="flex-col items-start gap-0.5"
              data-testid={`effort-level-${level}`}
              disabled={busy}
            >
              <div className="flex items-center gap-2">
                <Check size={14} className={cn('shrink-0', current === level ? 'opacity-100' : 'opacity-0')} />
                <span>{label}</span>
              </div>
              {desc ? (
                <span className="pl-6 text-meta text-ink-tertiary">{desc}</span>
              ) : null}
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
