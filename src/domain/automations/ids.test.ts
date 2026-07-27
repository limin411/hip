import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_ID_RE,
  AUTOMATION_RUN_ID_RE,
  isAutomationId,
  isAutomationRunId,
  mintAutomationId,
  mintAutomationRunId,
} from './ids'

describe('automation ids', () => {
  it('validates prefixes', () => {
    expect(isAutomationId('auto_abc')).toBe(true)
    expect(isAutomationId('auto_')).toBe(false)
    expect(isAutomationId('arun_x')).toBe(false)
    expect(isAutomationRunId('arun_xyz')).toBe(true)
    expect(isAutomationRunId('auto_xyz')).toBe(false)
  })

  it('minted ids match regexes', () => {
    for (let i = 0; i < 5; i++) {
      expect(AUTOMATION_ID_RE.test(mintAutomationId())).toBe(true)
      expect(AUTOMATION_RUN_ID_RE.test(mintAutomationRunId())).toBe(true)
    }
  })
})
