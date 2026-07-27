import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emptyAutomationsCatalog, emptyAutomationRunsLog } from '@/domain/automations/normalize'
import { mintAutomationId, mintAutomationRunId } from '@/domain/automations/ids'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import {
  listAutomations,
  saveAutomations,
  listAutomationRuns,
  saveAutomationRuns,
} from './automations'

describe('automations IPC', () => {
  beforeEach(() => invoke.mockReset())

  it('listAutomations invokes automations_list and normalizes', async () => {
    const id = mintAutomationId()
    invoke.mockResolvedValueOnce({
      version: 1,
      automations: [
        {
          id,
          name: '  Hello  ',
          prompt: 'do stuff',
          enabled: true,
          trigger: { kind: 'daily', hour: 9, minute: 0 },
          createdAt: 1,
          updatedAt: 2,
          nextRunAt: 99,
        },
      ],
    })
    const cat = await listAutomations()
    expect(invoke).toHaveBeenCalledWith('automations_list')
    expect(cat.version).toBe(1)
    expect(cat.automations).toHaveLength(1)
    expect(cat.automations[0]?.id).toBe(id)
    expect(cat.automations[0]?.name).toBe('Hello')
    expect(cat.automations[0]?.trigger).toEqual({ kind: 'daily', hour: 9, minute: 0 })
  })

  it('listAutomations normalizes malformed rows via domain normalizeCatalog', async () => {
    const id = mintAutomationId()
    invoke.mockResolvedValueOnce({
      version: 1,
      automations: [
        { id: 'nope', name: 'bad' },
        {
          id,
          name: 'ok',
          prompt: 'x',
          enabled: true,
          trigger: { kind: 'manual' },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    const cat = await listAutomations()
    expect(cat.automations).toHaveLength(1)
    expect(cat.automations[0]?.id).toBe(id)
  })

  it('listAutomations propagates IPC errors', async () => {
    invoke.mockRejectedValueOnce(new Error('no automations dir'))
    await expect(listAutomations()).rejects.toThrow('no automations dir')
  })

  it('saveAutomations invokes automations_save with flat { catalog } payload', async () => {
    invoke.mockResolvedValueOnce(undefined)
    const catalog = emptyAutomationsCatalog()
    await saveAutomations(catalog)
    expect(invoke).toHaveBeenCalledWith('automations_save', { catalog })
  })

  it('listAutomationRuns invokes automation_runs_list and normalizes', async () => {
    const autoId = mintAutomationId()
    const runId = mintAutomationRunId()
    invoke.mockResolvedValueOnce({
      version: 1,
      runs: [
        {
          id: runId,
          automationId: autoId,
          status: 'succeeded',
          trigger: 'manual',
          startedAt: 10,
          finishedAt: 20,
          sessionId: 'sess_1',
        },
      ],
    })
    const log = await listAutomationRuns()
    expect(invoke).toHaveBeenCalledWith('automation_runs_list')
    expect(log.version).toBe(1)
    expect(log.runs).toHaveLength(1)
    expect(log.runs[0]?.id).toBe(runId)
    expect(log.runs[0]?.automationId).toBe(autoId)
    expect(log.runs[0]?.status).toBe('succeeded')
  })

  it('listAutomationRuns drops invalid run rows', async () => {
    const autoId = mintAutomationId()
    const runId = mintAutomationRunId()
    invoke.mockResolvedValueOnce({
      version: 1,
      runs: [
        { id: 'bad', automationId: autoId, status: 'succeeded', trigger: 'manual', startedAt: 1 },
        {
          id: runId,
          automationId: autoId,
          status: 'failed',
          trigger: 'schedule',
          startedAt: 2,
          error: 'x',
        },
      ],
    })
    const log = await listAutomationRuns()
    expect(log.runs).toHaveLength(1)
    expect(log.runs[0]?.id).toBe(runId)
  })

  it('listAutomationRuns propagates IPC errors', async () => {
    invoke.mockRejectedValueOnce(new Error('no automations dir'))
    await expect(listAutomationRuns()).rejects.toThrow('no automations dir')
  })

  it('saveAutomationRuns invokes automation_runs_save with flat { log } payload', async () => {
    invoke.mockResolvedValueOnce(undefined)
    const log = emptyAutomationRunsLog()
    await saveAutomationRuns(log)
    expect(invoke).toHaveBeenCalledWith('automation_runs_save', { log })
  })
})
