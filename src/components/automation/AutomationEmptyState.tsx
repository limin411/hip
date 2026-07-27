import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Sparkles, Zap } from 'lucide-react'
import type { SkillMeta } from '@hip/protocol'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { useSkillsStore } from '@/store/skillsStore'
import { AutomationTemplateGrid } from './AutomationTemplateGrid'
import type { AutomationTemplate } from './templates'

export type SkillSeedDraft = {
  name: string
  prompt: string
  skillIds: string[]
}

export type AutomationEmptyStateProps = {
  onStartBlank: () => void
  onSelectTemplate: (template: AutomationTemplate) => void
  onCreateFromSkill: (seed: SkillSeedDraft) => void
}

function skillIsDisabled(id: string, enabled: Record<string, boolean>): boolean {
  // Missing id is treated as enabled (skillsStore / SkillsConfig contract).
  return enabled[id] === false
}

function skillInvocable(s: SkillMeta): boolean {
  return s.userInvocable !== false
}

export function AutomationEmptyState({
  onStartBlank,
  onSelectTemplate,
  onCreateFromSkill,
}: AutomationEmptyStateProps) {
  const { t } = useTranslation()
  const skills = useSkillsStore((s) => s.skills)
  const enabled = useSkillsStore((s) => s.enabled)
  const loaded = useSkillsStore((s) => s.loaded)
  const loadSkills = useSkillsStore((s) => s.load)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!loaded) void loadSkills()
  }, [loaded, loadSkills])

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills
      .filter(skillInvocable)
      .filter((s) => {
        if (!q) return true
        return (
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
        )
      })
  }, [skills, query])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4"
      data-testid="automation-empty-state"
    >
      <EmptyState
        icon={Zap}
        tier="professional"
        title={t('automation.emptyTitle')}
        description={t('automation.emptyDesc')}
        action={{
          label: t('automation.startCta'),
          onClick: onStartBlank,
        }}
        data-testid="automation-empty-hero"
      />

      <section className="mx-auto w-full max-w-4xl">
        <h2 className="mb-2 text-body font-semibold text-ink">
          {t('automation.templatesHeading')}
        </h2>
        <p className="mb-3 text-meta text-ink-tertiary">
          {t('automation.templatesHint')}
        </p>
        <AutomationTemplateGrid onSelect={onSelectTemplate} />
      </section>

      <section className="mx-auto w-full max-w-4xl pb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-body font-semibold text-ink">
              {t('automation.skillsHeading')}
            </h2>
            <p className="text-meta text-ink-tertiary">
              {t('automation.seedOnlyHint')}
            </p>
          </div>
          <div className="relative w-full max-w-xs">
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
        </div>

        {visibleSkills.length === 0 ? (
          <p className="py-6 text-center text-meta text-ink-tertiary" data-testid="automation-skills-empty">
            {loaded ? t('automation.skillsEmpty') : t('automation.loading')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="automation-skills-list">
            {visibleSkills.map((skill) => {
              const disabled = skillIsDisabled(skill.id, enabled)
              return (
                <li
                  key={skill.id}
                  className={cn(
                    'flex items-center gap-3 rounded-md border border-border px-3 py-2',
                    disabled && 'opacity-50',
                  )}
                  data-testid={`automation-skill-row-${skill.id}`}
                >
                  <Sparkles
                    className="h-4 w-4 shrink-0 text-ink-tertiary"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body text-ink">{skill.name}</div>
                    <div className="truncate text-meta text-ink-tertiary">
                      {skill.description || skill.id}
                    </div>
                    {disabled ? (
                      <div className="mt-0.5 text-caption text-warning">
                        {t('automation.skillDisabled')}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    data-testid={`automation-skill-create-${skill.id}`}
                    onClick={() => {
                      if (disabled) return
                      const prompt = t('automation.skillSeedPrompt', {
                        name: skill.name,
                        description: skill.description || skill.name,
                      })
                      onCreateFromSkill({
                        name: t('automation.skillSeedName', { name: skill.name }),
                        prompt,
                        skillIds: [skill.id],
                      })
                    }}
                  >
                    {t('automation.createFromSkill')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
