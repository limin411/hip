import type { AutomationTrigger, AutomationTriggerKind } from '@/domain/automations'

/**
 * Soft warnings shown in the editor for certain templates.
 * `no_work_items_context` — agent does not auto-load work-items catalog.
 * `needs_edit_permission` — code-oriented templates may need edit permission.
 */
export type AutomationTemplateSoftWarning =
  | 'no_work_items_context'
  | 'needs_edit_permission'

export type AutomationTemplate = {
  id: string
  nameKey: string
  descriptionKey: string
  cadence: AutomationTriggerKind
  defaultTrigger: AutomationTrigger
  /** i18n key for the default prompt body */
  promptKey: string
  requiresProject: boolean
  softWarnings?: AutomationTemplateSoftWarning[]
}

const dailyMorning: AutomationTrigger = { kind: 'daily', hour: 9, minute: 0 }
const weeklyMonday: AutomationTrigger = {
  kind: 'weekly',
  weekday: 1,
  hour: 9,
  minute: 0,
}

/**
 * hip-oriented automation templates (empty-state gallery).
 * Prompt bodies live in i18n under `automation.templates.<id>.prompt`.
 */
export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'daily-standup',
    nameKey: 'automation.templates.dailyStandup.name',
    descriptionKey: 'automation.templates.dailyStandup.description',
    cadence: 'daily',
    defaultTrigger: dailyMorning,
    promptKey: 'automation.templates.dailyStandup.prompt',
    requiresProject: false,
  },
  {
    id: 'weekly-review',
    nameKey: 'automation.templates.weeklyReview.name',
    descriptionKey: 'automation.templates.weeklyReview.description',
    cadence: 'weekly',
    defaultTrigger: weeklyMonday,
    promptKey: 'automation.templates.weeklyReview.prompt',
    requiresProject: false,
  },
  {
    id: 'code-review',
    nameKey: 'automation.templates.codeReview.name',
    descriptionKey: 'automation.templates.codeReview.description',
    cadence: 'daily',
    defaultTrigger: dailyMorning,
    promptKey: 'automation.templates.codeReview.prompt',
    requiresProject: true,
    softWarnings: ['needs_edit_permission'],
  },
  {
    id: 'deps-audit',
    nameKey: 'automation.templates.depsAudit.name',
    descriptionKey: 'automation.templates.depsAudit.description',
    cadence: 'weekly',
    defaultTrigger: weeklyMonday,
    promptKey: 'automation.templates.depsAudit.prompt',
    requiresProject: true,
  },
  {
    id: 'doc-refresh',
    nameKey: 'automation.templates.docRefresh.name',
    descriptionKey: 'automation.templates.docRefresh.description',
    cadence: 'weekly',
    defaultTrigger: weeklyMonday,
    promptKey: 'automation.templates.docRefresh.prompt',
    requiresProject: true,
    softWarnings: ['needs_edit_permission'],
  },
  {
    id: 'inbox-triage',
    nameKey: 'automation.templates.inboxTriage.name',
    descriptionKey: 'automation.templates.inboxTriage.description',
    cadence: 'daily',
    defaultTrigger: dailyMorning,
    promptKey: 'automation.templates.inboxTriage.prompt',
    requiresProject: false,
    softWarnings: ['no_work_items_context'],
  },
  {
    id: 'perf-pass',
    nameKey: 'automation.templates.perfPass.name',
    descriptionKey: 'automation.templates.perfPass.description',
    cadence: 'weekly',
    defaultTrigger: weeklyMonday,
    promptKey: 'automation.templates.perfPass.prompt',
    requiresProject: true,
  },
  {
    id: 'skill-bootstrap',
    nameKey: 'automation.templates.skillBootstrap.name',
    descriptionKey: 'automation.templates.skillBootstrap.description',
    cadence: 'manual',
    defaultTrigger: { kind: 'manual' },
    promptKey: 'automation.templates.skillBootstrap.prompt',
    requiresProject: false,
  },
] as const

export function getAutomationTemplate(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id)
}
