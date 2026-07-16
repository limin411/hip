import { describe, it, expect, beforeEach, vi } from 'vitest'
import { extractPlanTask, runPlanOn, runPlanOff } from './planActions'

const setForcePlan = vi.fn()
const sendMessage = vi.fn()
const selectSession = vi.fn()
const setDraftForcePlan = vi.fn()

vi.mock('../sessionService', () => ({
  sessionService: {
    setForcePlan: (...args: unknown[]) => setForcePlan(...args),
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    selectSession: (...args: unknown[]) => selectSession(...args),
  },
}))

vi.mock('../sessionStore', () => ({
  useDomainStore: {
    getState: () => ({ activeSessionId: 's1' }),
  },
}))

vi.mock('@/store/draftStore', () => ({
  useDraftStore: {
    getState: () => ({ setForcePlan: setDraftForcePlan }),
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

describe('runPlanOn / runPlanOff', () => {
  beforeEach(() => {
    setForcePlan.mockClear()
    sendMessage.mockClear()
    selectSession.mockClear()
    setDraftForcePlan.mockClear()
  })

  it('sets forcePlan on session without sending when no task', () => {
    runPlanOn('s1')
    expect(setForcePlan).toHaveBeenCalledWith('s1', true)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sets forcePlan and sends task when provided', () => {
    runPlanOn('s1', 'fix util')
    expect(setForcePlan).toHaveBeenCalledWith('s1', true)
    expect(sendMessage).toHaveBeenCalledWith('fix util')
  })

  it('sets draft forcePlan when no session', () => {
    runPlanOn(null)
    expect(setDraftForcePlan).toHaveBeenCalledWith(true)
    expect(setForcePlan).not.toHaveBeenCalled()
  })

  it('runPlanOff clears session flag', () => {
    runPlanOff('s1')
    expect(setForcePlan).toHaveBeenCalledWith('s1', false)
  })
})
