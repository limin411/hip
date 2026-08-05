import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useUiStore } from '@/store/uiStore'
import { useHipConfigStore } from '@/store/hipConfigStore'

const createSession = vi.fn()

vi.mock('@/domain', () => ({
  sessionService: {
    createSession: (...args: unknown[]) => createSession(...args),
  },
}))

import { startTerminalAgentChat } from './terminalAgentSession'

describe('startTerminalAgentChat', () => {
  beforeEach(() => {
    createSession.mockReset()
    createSession.mockReturnValue('sess_new')
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_ssh',
          kind: 'ssh',
          title: 'box',
          hostId: 'host_1',
          remotePath: '/home/u',
          status: 'connected',
          createdAt: 1,
        },
        {
          id: 'tm_local',
          kind: 'local',
          title: 'local',
          cwd: '/tmp',
          status: 'connected',
          createdAt: 1,
        },
      ],
      focusedId: 'tm_ssh',
    })
    useTerminalAgentStore.setState({
      activeSessionByTerminal: {},
      sidebarExpanded: {},
      execFlightByTerminal: {},
    })
    useUiStore.setState({
      terminalPanelOpen: false,
      activeTerminalPanelTab: {},
    })
    useHipConfigStore.setState({
      config: {
        version: 1,
        activeModel: {
          providerID: 'deepseek',
          modelID: 'deepseek-chat',
          baseURL: 'https://api.example',
        },
      },
    })
  })

  it('returns null for missing or non-ssh terminals', async () => {
    expect(await startTerminalAgentChat('tm_missing')).toBeNull()
    expect(await startTerminalAgentChat('tm_local')).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a terminal surface session without activating the domain pointer', async () => {
    const id = await startTerminalAgentChat('tm_ssh', {
      agentId: 'builtin',
      permissionMode: 'edit',
    })
    expect(id).toBe('sess_new')
    expect(createSession).toHaveBeenCalledTimes(1)
    const [config, opts] = createSession.mock.calls[0]
    expect(opts).toEqual({ activate: false })
    expect(config).toMatchObject({
      surface: 'terminal',
      managedTerminalId: 'tm_ssh',
      hostId: 'host_1',
      remotePathHint: '/home/u',
      workspaceMode: 'sandbox',
      cwd: undefined,
      permissionMode: 'edit',
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      baseURL: 'https://api.example',
    })
    expect(config.agentId).toBeUndefined()
    expect(useTerminalAgentStore.getState().activeSessionByTerminal.tm_ssh).toBe('sess_new')
    expect(useUiStore.getState().terminalPanelOpen).toBe(true)
    expect(useUiStore.getState().activeTerminalPanelTab.tm_ssh).toBe('agent')
  })
  it('forwards non-builtin agentId', async () => {
    await startTerminalAgentChat('tm_ssh', { agentId: 'custom-agent' })
    expect(createSession.mock.calls[0][0].agentId).toBe('custom-agent')
  })
})
