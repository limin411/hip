import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Sparkles } from 'lucide-react'
import { useSkillsStore } from '@/store/skillsStore'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { SkillSeedDraft } from './AutomationEmptyState'

export type AutomationSkillsSectionProps = {
  onSelectSkill: (seed: SkillSeedDraft) => void
  className?: string
  /** Cap list length for empty-state density. */
  maxVisible?: number
}

/**
 * Searchable skills → prompt-seed only (honesty: does not force skill load at runtime).
 */
export function AutomationSkillsSection({
  onSelectSkill,
  className,
  maxVisible = 24,
}: AutomationSkillsSectionProps) {
  const { t } = useTranslation()
  const skills = useSkillsStore((s) => s.skills)
  const enabled = useSkillsStore((s) => s.enabled)
  const loaded = useSkillsStore((s) => s.loaded)
  const load = useSkillsStore((s) => s.load)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = skills.slice().sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
    if (!q) return list.slice(0, maxVisible)
    return list
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q),
      )
      .slice(0, maxVisible)
  }, [skills, query, maxVisible])

  const seedFromSkill = (id: string, name: string, description: string): SkillSeedDraft => ({
    name: t('automation.skillSeedName', { name }),
    prompt: t('automation.skillSeedPrompt', { name, description }),
    skillIds: [id],
  })

  return (
    <section
      className={cn('mx-auto w-full max-w-4xl', className)}
      data-testid="automation-skills-section"
    >
      <h2 className="mb-1 text-body font-semibold text-ink">
        {t('automation.skillsHeading')}
      </h2>
      <p className="mb-3 text-meta text-ink-tertiary">
        {t('automation.seedOnlyHint')}
      </p>

      <div className="relative mb-3 max-w-md">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-tertiary"
          strokeWidth={1.75}
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('automation.skillsSearch')}
          className="h-8 pl-8"
          data-testid="automation-skills-search"
          aria-label={t('automation.skillsSearch')}
        />
      </div>

      {!loaded ? (
        <p className="text-meta text-ink-tertiary" role="status">
          {t('automation.loading')}
        </p>
      ) : filtered.length === 0 ? (
        <p
          className="text-meta text-ink-tertiary"
          data-testid="automation-skills-empty"
        >
          {t('automation.skillsEmpty')}
        </p>
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2"
          data-testid="automation-skills-list"
        >
          {filtered.map((skill) => {
            const isDisabled = enabled[skill.id] === false
            return (
              <li key={skill.id}>
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-lg border border-border bg-surface p-3',
                    isDisabled && 'opacity-80',
                  )}
                  data-testid={`automation-skill-card-${skill.id}`}
                >
                  <Sparkles
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-tertiary"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-body font-medium text-ink">
                        {skill.name}
                      </span>
                      {isDisabled ? (
                        <span className="text-caption text-warning">
                          {t('automation.skillDisabled')}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-meta text-ink-secondary">
                      {skill.description || skill.id}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      data-testid={`automation-skill-create-${skill.id}`}
                      onClick={() =>
                        onSelectSkill(
                          seedFromSkill(skill.id, skill.name, skill.description),
                        )
                      }
                    >
                      {t('automation.createFromSkill')}
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
