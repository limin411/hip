import { describe, expect, it } from 'vitest'
import { AUTOMATION_TEMPLATES, getAutomationTemplate } from './templates'

describe('AUTOMATION_TEMPLATES', () => {
  it('includes required hip templates with project constraints', () => {
    const ids = AUTOMATION_TEMPLATES.map((t) => t.id)
    expect(ids).toContain('daily-standup')
    expect(ids).toContain('code-review')
    expect(ids).toContain('inbox-triage')
    expect(getAutomationTemplate('code-review')?.requiresProject).toBe(true)
    expect(getAutomationTemplate('daily-standup')?.requiresProject).toBe(false)
    expect(getAutomationTemplate('inbox-triage')?.softWarnings).toContain(
      'no_work_items_context',
    )
  })
})
