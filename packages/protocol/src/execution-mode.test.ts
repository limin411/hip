import { describe, it, expect } from 'vitest'
import {
  resolveExecutionMode,
  canSelectAutopilot,
  forcePlanFromExecutionMode,
  isAutopilot,
  executionModeConfigPatch,
  isExecutionMode,
} from './execution-mode.js'

describe('resolveExecutionMode', () => {
  it('defaults to interactive when unset', () => {
    expect(resolveExecutionMode({})).toBe('interactive')
  })

  it('legacy forcePlan true → plan', () => {
    expect(resolveExecutionMode({ forcePlan: true })).toBe('plan')
  })

  it('explicit executionMode wins over forcePlan', () => {
    expect(resolveExecutionMode({ executionMode: 'interactive', forcePlan: true })).toBe('interactive')
    expect(resolveExecutionMode({ executionMode: 'autopilot', forcePlan: true, permissionMode: 'full' })).toBe(
      'autopilot',
    )
  })

  it('coerces autopilot to interactive when permission is not full', () => {
    expect(resolveExecutionMode({ executionMode: 'autopilot', permissionMode: 'edit' })).toBe('interactive')
    expect(resolveExecutionMode({ executionMode: 'autopilot', permissionMode: 'chat' })).toBe('interactive')
    expect(resolveExecutionMode({ executionMode: 'autopilot' })).toBe('interactive')
  })

  it('allows autopilot when permission is full', () => {
    expect(resolveExecutionMode({ executionMode: 'autopilot', permissionMode: 'full' })).toBe('autopilot')
  })
})

describe('canSelectAutopilot', () => {
  it('only full', () => {
    expect(canSelectAutopilot('full')).toBe(true)
    expect(canSelectAutopilot('edit')).toBe(false)
    expect(canSelectAutopilot('chat')).toBe(false)
    expect(canSelectAutopilot(undefined)).toBe(false)
  })
})

describe('helpers', () => {
  it('forcePlanFromExecutionMode', () => {
    expect(forcePlanFromExecutionMode('plan')).toBe(true)
    expect(forcePlanFromExecutionMode('interactive')).toBe(false)
    expect(forcePlanFromExecutionMode('autopilot')).toBe(false)
  })

  it('isAutopilot / isExecutionMode / patch', () => {
    expect(isAutopilot('autopilot')).toBe(true)
    expect(isExecutionMode('plan')).toBe(true)
    expect(isExecutionMode('nope')).toBe(false)
    expect(executionModeConfigPatch('plan')).toEqual({
      executionMode: 'plan',
      forcePlan: true,
      disablePlan: false,
    })
    expect(executionModeConfigPatch('autopilot')).toEqual({
      executionMode: 'autopilot',
      forcePlan: false,
    })
  })
})
