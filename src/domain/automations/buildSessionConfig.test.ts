import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import { DEFAULT_CONFIG, useDomainStore } from '@/domain/sessionStore'
import type { Automation } from './types'

const isDirectory = vi.fn()

vi.mock('@/ipc/pathExists', () => ({
  isDirectory: (...a: unknown[]) => isDirectory(...a),
}))

import {
  buildSessionConfigFromAutomation,
  isProjectPathReady,
  probeProjectPath,
} from './buildSessionConfig'

const acpAgent = (id: string, overrides?: Partial<AgentConfig>): AgentConfig => ({
  id,
  name: id,
  kind: 'acp',
  command: 'cmd',
  args: [],
  enabled: true,
  ...overrides,
})

function auto(partial: Partial<Automation> & { id: string }): Automation {
  return {
    name: 'Test',
    prompt: 'do thing',
    enabled: true,
    trigger: { kind: 'manual' },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('buildSessionConfigFromAutomation', () => {
  beforeEach(() => {
    isDirectory.mockReset()
    useProjectPathStore.setState({ byKey: {} })
    useProvidersStore.setState({
      catalog: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          api: 'https://api.openai.com/v1',
          models: {
            'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
          },
        },
      },
      config: {
        providers: { openai: { enabled: true } },
        activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
      },
    })
    useHipConfigStore.setState({
      config: {
        version: 1,
        agents: [
          acpAgent('acp-1'),
          acpAgent('disabled-acp', { enabled: false }),
          acpAgent('internal-coder', { kind: 'internal', command: '', prompt: 'x' }),
        ],
      },
      loaded: true,
      error: null,
    })
  })

  it('chat surface when no projectPath; uses active model', async () => {
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_a', projectPath: null }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.surface).toBe('chat')
    expect(r.config.cwd).toBeUndefined()
    expect(r.config.llmProvider).toBe('openai')
    expect(r.config.model).toBe('gpt-4o')
    expect(r.config.permissionMode).toBe('chat')
  })

  it('explicit llmProvider/model wins over active', async () => {
    useProvidersStore.setState({
      catalog: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          api: 'https://api.openai.com/v1',
          models: {
            'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
            'gpt-4.1': { id: 'gpt-4.1', name: 'GPT-4.1' },
          },
        },
      },
      config: {
        providers: { openai: { enabled: true } },
        activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
      },
    })
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_b', llmProvider: 'openai', model: 'gpt-4.1' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.model).toBe('gpt-4.1')
  })

  it('no_model_configured when no active and no pin', async () => {
    useProvidersStore.setState({
      catalog: {},
      config: { providers: {}, activeModel: undefined },
    })
    const r = await buildSessionConfigFromAutomation(auto({ id: 'auto_c' }))
    expect(r).toEqual({ ok: false, error: 'no_model_configured' })
  })

  it('ACP agent omits hip model fields path and sets agentId', async () => {
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_d', agentId: 'acp-1' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.agentId).toBe('acp-1')
  })

  it('stale agentId is omitted; falls back to model', async () => {
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_e', agentId: 'gone' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.agentId).toBeUndefined()
    expect(r.config.llmProvider).toBe('openai')
  })

  it('code surface + permissionMode edit when projectPath present and ok', async () => {
    useProjectPathStore.getState().markOk('/work/proj')
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_f', projectPath: '/work/proj' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.surface).toBe('code')
    expect(r.config.cwd).toBe('/work/proj')
    expect(r.config.permissionMode).toBe('edit')
  })

  it('project_missing when path marked missing', async () => {
    useProjectPathStore.setState({
      byKey: {
        '/gone': { exists: false, checkedAt: Date.now(), inFlight: false },
      },
    })
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_g', projectPath: '/gone' }),
    )
    expect(r).toEqual({ ok: false, error: 'project_missing' })
  })

  it('probes unknown project path and fails when missing', async () => {
    isDirectory.mockResolvedValueOnce(false)
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_h', projectPath: '/probe-me' }),
    )
    expect(isDirectory).toHaveBeenCalled()
    expect(r).toEqual({ ok: false, error: 'project_missing' })
  })

  it('probes unknown project path and succeeds when ok', async () => {
    isDirectory.mockResolvedValueOnce(true)
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_i', projectPath: '/ok-proj' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.cwd).toBe('/ok-proj')
    expect(useProjectPathStore.getState().statusOf('/ok-proj')).toBe('ok')
  })

  it('probeProjectPath returns unknown when isDirectory cannot run', async () => {
    isDirectory.mockResolvedValueOnce(null)
    expect(await probeProjectPath('/maybe')).toBe('unknown')
  })

  it('uses explicit permissionMode when set', async () => {
    useProjectPathStore.getState().markOk('/p')
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_j', projectPath: '/p', permissionMode: 'full' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.permissionMode).toBe('full')
  })
})

describe('isProjectPathReady', () => {
  beforeEach(() => {
    isDirectory.mockReset()
    useProjectPathStore.setState({ byKey: {} })
  })

  it('passes an empty path — chat fire, nothing to check', async () => {
    expect(await isProjectPathReady('')).toBe(true)
    expect(isDirectory).not.toHaveBeenCalled()
  })

  it('probes an unknown path and passes when it exists', async () => {
    isDirectory.mockResolvedValueOnce(true)
    expect(await isProjectPathReady('/ok-proj')).toBe(true)
  })

  it('fails a known-missing path without probing', async () => {
    useProjectPathStore.setState({
      byKey: {
        '/gone': { exists: false, checkedAt: Date.now(), inFlight: false },
      },
    })
    expect(await isProjectPathReady('/gone')).toBe(false)
    expect(isDirectory).not.toHaveBeenCalled()
  })

  it('fails when the probe cannot run (never pass on unknown)', async () => {
    isDirectory.mockResolvedValueOnce(null)
    expect(await isProjectPathReady('/maybe')).toBe(false)
  })
})

describe('buildSessionConfigFromAutomation — owning conversation fallback', () => {
  beforeEach(() => {
    useDomainStore.setState({ sessions: [], activeSessionId: null })
  })

  it('inherits the owning conversation cwd for a row persisted without projectPath', async () => {
    useProjectPathStore.getState().markOk('/work/proj')
    useDomainStore.getState().createSession('sess_owner', {
      ...DEFAULT_CONFIG,
      surface: 'code',
      cwd: '/work/proj',
    })

    // Regression: the composer persisted `sessionId` only, and the fire's surface
    // is derived from the project path alone — so a task configured inside a
    // project conversation fired its run into Chats.
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_legacy', sessionId: 'sess_owner' }),
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.surface).toBe('code')
    expect(r.config.cwd).toBe('/work/proj')
  })

  it('lets an explicit projectPath win over the owning conversation cwd', async () => {
    useProjectPathStore.getState().markOk('/explicit')
    useProjectPathStore.getState().markOk('/owner-cwd')
    useDomainStore.getState().createSession('sess_owner', {
      ...DEFAULT_CONFIG,
      surface: 'code',
      cwd: '/owner-cwd',
    })

    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_pin', sessionId: 'sess_owner', projectPath: '/explicit' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.cwd).toBe('/explicit')
  })

  it('stays a chat fire when the owning conversation is gone', async () => {
    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_gone', sessionId: 'sess_deleted' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.surface).toBe('chat')
    expect(r.config.cwd).toBeUndefined()
  })

  it('stays a chat fire for a sandbox conversation with no project path', async () => {
    useDomainStore.getState().createSession('sess_chat', {
      ...DEFAULT_CONFIG,
      surface: 'chat',
    })

    const r = await buildSessionConfigFromAutomation(
      auto({ id: 'auto_chat', sessionId: 'sess_chat' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.surface).toBe('chat')
  })
})
