import { describe, it, expect, beforeEach, vi } from 'vitest'
import { extractPlanTask, runPlanOn, runPlanOff, runAutopilot, runInteractive } from './planActions'

const setExecutionMode = vi.fn((_id: string, _mode: string) => true)
const sendMessage = vi.fn()
const selectSession = vi.fn()
const setDraftExecutionMode = vi.fn((_mode: string) => true)

vi.mock('../sessionService', () => ({
  sessionService: {
    setExecutionMode: (id: string, mode: string) => setExecutionMode(id, mode),
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    selectSession: (...args: unknown[]) => selectSession(...args),
  },
}))

vi.mock('../sessionStore', () => ({
  useDomainStore: {
    getState: () => ({
      activeSessionId: 's1',
      sessions: [
        {
          id: 's1',
          config: { permissionMode: 'full', llmProvider: 'x', model: 'm', tools: [] },
        },
      ],
    }),
  },
}))

vi.mock('@/store/draftStore', () => ({
  useDraftStore: {
    getState: () => ({
      setExecutionMode: setDraftExecutionMode,
      draft: { permissionMode: 'edit' },
    }),
  },
}))

vi.mock('sonner', () => ({ toast: { message: vi.fn() } }))
vi.mock('@/i18n', () => ({
  default: { t: (k: string) => k },
}))

describe('extractPlanTask', () => {
  it('returns trailing task text', () => {
    expect(extractPlanTask('/plan fix HasPrefixes')).toBe('fix HasPrefixes')
  })
  it('returns undefined when no trailing text', () => {
    expect(extractPlanTask('/plan')).toBeUndefined()
    expect(extractPlanTask('hello /plan')).toBeUndefined()
  })
})

describe('runPlanOn / runPlanOff / runAutopilot', () => {
  beforeEach(() => {
    setExecutionMode.mockClear().mockReturnValue(true)
    sendMessage.mockClear()
    selectSession.mockClear()
    setDraftExecutionMode.mockClear().mockReturnValue(true)
  })

  it('sets plan mode on session without sending when no task', () => {
    runPlanOn('s1')
    expect(setExecutionMode).toHaveBeenCalledWith('s1', 'plan')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sets plan mode and sends task when provided', () => {
    runPlanOn('s1', 'fix util')
    expect(setExecutionMode).toHaveBeenCalledWith('s1', 'plan')
    expect(sendMessage).toHaveBeenCalledWith('fix util')
  })

  it('sets draft execution mode when no session', () => {
    runPlanOn(null)
    expect(setDraftExecutionMode).toHaveBeenCalledWith('plan')
    expect(setExecutionMode).not.toHaveBeenCalled()
  })

  it('runPlanOff switches to interactive', () => {
    runPlanOff('s1')
    expect(setExecutionMode).toHaveBeenCalledWith('s1', 'interactive')
  })

  it('runInteractive switches to interactive', () => {
    runInteractive('s1')
    expect(setExecutionMode).toHaveBeenCalledWith('s1', 'interactive')
  })

  it('runAutopilot on full permission session', () => {
    expect(runAutopilot('s1')).toBe(true)
    expect(setExecutionMode).toHaveBeenCalledWith('s1', 'autopilot')
  })

  it('runAutopilot rejects draft without full permission', () => {
    expect(runAutopilot(null)).toBe(false)
    expect(setDraftExecutionMode).not.toHaveBeenCalled()
  })
})
