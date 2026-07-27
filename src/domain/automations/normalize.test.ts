import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_NAME_MAX,
  AUTOMATION_PROMPT_MAX,
  clampUtf8Bytes,
  emptyAutomationsCatalog,
  emptyAutomationRunsLog,
  normalizeAutomation,
  normalizeCatalog,
  normalizeRunsLog,
  normalizeTrigger,
  utf8ByteLength,
} from './normalize'
import { mintAutomationId, mintAutomationRunId } from './ids'

describe('normalizeTrigger', () => {
  it('defaults invalid to manual', () => {
    expect(normalizeTrigger(null)).toEqual({ kind: 'manual' })
    expect(normalizeTrigger({})).toEqual({ kind: 'manual' })
    expect(normalizeTrigger({ kind: 'hourly' })).toEqual({ kind: 'manual' })
  })

  it('clamps daily hour/minute', () => {
    expect(normalizeTrigger({ kind: 'daily', hour: 25, minute: -1 })).toEqual({
      kind: 'daily',
      hour: 23,
      minute: 0,
    })
    expect(normalizeTrigger({ kind: 'daily', hour: 10, minute: 30 })).toEqual({
      kind: 'daily',
      hour: 10,
      minute: 30,
    })
  })

  it('clamps weekly weekday 0–6', () => {
    expect(
      normalizeTrigger({ kind: 'weekly', weekday: 9, hour: 8, minute: 0 }),
    ).toEqual({ kind: 'weekly', weekday: 6, hour: 8, minute: 0 })
    expect(
      normalizeTrigger({ kind: 'weekly', weekday: 0, hour: 10, minute: 0 }),
    ).toEqual({ kind: 'weekly', weekday: 0, hour: 10, minute: 0 })
  })
})

describe('normalizeCatalog', () => {
  it('returns empty catalog for invalid raw', () => {
    expect(normalizeCatalog(null)).toEqual(emptyAutomationsCatalog())
    expect(normalizeCatalog('x').automations).toEqual([])
    expect(normalizeCatalog({ version: 2 }).version).toBe(1)
  })

  it('keeps valid automation and drops bad ids', () => {
    const id = mintAutomationId()
    const cat = normalizeCatalog({
      version: 1,
      automations: [
        {
          id: 'not_auto',
          name: 'bad',
          prompt: 'x',
          enabled: true,
          trigger: { kind: 'manual' },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id,
          name: '  Hello  ',
          prompt: 'do stuff',
          enabled: true,
          trigger: { kind: 'daily', hour: 9, minute: 0 },
          createdAt: 10,
          updatedAt: 20,
          nextRunAt: 99,
        },
      ],
    })
    expect(cat.automations).toHaveLength(1)
    expect(cat.automations[0]!.id).toBe(id)
    expect(cat.automations[0]!.name).toBe('Hello')
    expect(cat.automations[0]!.trigger).toEqual({
      kind: 'daily',
      hour: 9,
      minute: 0,
    })
    expect(cat.automations[0]!.nextRunAt).toBe(99)
  })

  it('dedupes by id (first wins)', () => {
    const id = mintAutomationId()
    const cat = normalizeCatalog({
      version: 1,
      automations: [
        {
          id,
          name: 'first',
          prompt: '',
          enabled: true,
          trigger: { kind: 'manual' },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id,
          name: 'second',
          prompt: '',
          enabled: false,
          trigger: { kind: 'manual' },
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    })
    expect(cat.automations).toHaveLength(1)
    expect(cat.automations[0]!.name).toBe('first')
  })

  it('clamps name length and prompt UTF-8 bytes', () => {
    const id = mintAutomationId()
    const longName = 'n'.repeat(AUTOMATION_NAME_MAX + 20)
    const longPrompt = 'p'.repeat(AUTOMATION_PROMPT_MAX + 50)
    const a = normalizeAutomation({
      id,
      name: longName,
      prompt: longPrompt,
      enabled: true,
      trigger: { kind: 'manual' },
      createdAt: 1,
      updatedAt: 1,
    })
    expect(a!.name).toHaveLength(AUTOMATION_NAME_MAX)
    expect(utf8ByteLength(a!.prompt)).toBe(AUTOMATION_PROMPT_MAX)
  })

  it('clamps CJK prompt by UTF-8 bytes', () => {
    const id = mintAutomationId()
    const over = '字'.repeat(Math.floor(AUTOMATION_PROMPT_MAX / 3) + 100)
    expect(utf8ByteLength(over)).toBeGreaterThan(AUTOMATION_PROMPT_MAX)
    const a = normalizeAutomation({
      id,
      name: 'cjk',
      prompt: over,
      enabled: true,
      trigger: { kind: 'manual' },
      createdAt: 1,
      updatedAt: 1,
    })
    expect(utf8ByteLength(a!.prompt)).toBeLessThanOrEqual(AUTOMATION_PROMPT_MAX)
    expect(clampUtf8Bytes(over, AUTOMATION_PROMPT_MAX)).toBe(a!.prompt)
  })

  it('normalizes optional fields and skillIds', () => {
    const id = mintAutomationId()
    const a = normalizeAutomation({
      id,
      name: 'x',
      prompt: 'y',
      enabled: false,
      trigger: { kind: 'manual' },
      projectPath: '  /tmp/proj  ',
      llmProvider: 'openai',
      model: 'gpt',
      agentId: '  ',
      permissionMode: 'full',
      skillIds: ['s1', 's1', '  s2  ', '', 3, 's3'],
      templateId: null,
      lastStatus: 'waiting_user',
      lastError: 'missed_over_6h',
      lastSessionId: 'sess_1',
      lastRunAt: 123,
      nextRunAt: null,
      createdAt: 1,
      updatedAt: 2,
    })
    expect(a!.enabled).toBe(false)
    expect(a!.projectPath).toBe('/tmp/proj')
    expect(a!.llmProvider).toBe('openai')
    expect(a!.model).toBe('gpt')
    expect(a!.agentId).toBeUndefined()
    expect(a!.permissionMode).toBe('full')
    expect(a!.skillIds).toEqual(['s1', 's2', 's3'])
    expect(a!.templateId).toBeNull()
    expect(a!.lastStatus).toBe('waiting_user')
    expect(a!.lastError).toBe('missed_over_6h')
    expect(a!.lastSessionId).toBe('sess_1')
    expect(a!.lastRunAt).toBe(123)
    expect(a!.nextRunAt).toBeNull()
  })
})

describe('normalizeRunsLog', () => {
  it('empty for invalid', () => {
    expect(normalizeRunsLog(null)).toEqual(emptyAutomationRunsLog())
  })

  it('keeps valid runs and drops bad', () => {
    const rid = mintAutomationRunId()
    const aid = mintAutomationId()
    const log = normalizeRunsLog({
      version: 1,
      runs: [
        { id: 'bad', automationId: aid, status: 'running', trigger: 'manual', startedAt: 1 },
        {
          id: rid,
          automationId: aid,
          status: 'succeeded',
          trigger: 'schedule',
          startedAt: 10,
          finishedAt: 20,
          sessionId: 's1',
          error: null,
        },
        {
          id: rid,
          automationId: aid,
          status: 'failed',
          trigger: 'manual',
          startedAt: 99,
        },
      ],
    })
    expect(log.runs).toHaveLength(1)
    expect(log.runs[0]).toMatchObject({
      id: rid,
      automationId: aid,
      status: 'succeeded',
      trigger: 'schedule',
      startedAt: 10,
      finishedAt: 20,
      sessionId: 's1',
    })
  })

  it('coerces unknown status/trigger', () => {
    const rid = mintAutomationRunId()
    const aid = mintAutomationId()
    const r = normalizeRunsLog({
      version: 1,
      runs: [
        {
          id: rid,
          automationId: aid,
          status: 'weird',
          trigger: 'cron',
          startedAt: 1,
        },
      ],
    }).runs[0]!
    expect(r.status).toBe('pending')
    expect(r.trigger).toBe('manual')
  })
})
