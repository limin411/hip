import { describe, it, expect } from 'vitest'
import { configFromDraft } from './sessionService'

describe('configFromDraft', () => {
  it('null draft → default config, no agentId', () => {
    const cfg = configFromDraft(null)
    expect(cfg.agentId).toBeUndefined()
  })
  it('project draft keeps cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '' })
    expect(cfg.cwd).toBe('/p')
  })
  it('draft with an external agentId folds it in', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'agent-9' })
    expect(cfg.agentId).toBe('agent-9')
  })
  it("built-in agentId is treated as no external agent", () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'builtin' })
    expect(cfg.agentId).toBeUndefined()
  })
})
