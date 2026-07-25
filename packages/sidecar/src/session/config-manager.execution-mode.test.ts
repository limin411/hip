import { describe, it, expect } from 'vitest'
import type { SessionConfig } from '@hip/protocol'
import { HookRegistry } from './hooks/registry.js'
import { ConfigManager } from './config-manager.js'

function makeMgr(initial: Partial<SessionConfig> = {}) {
  let config: SessionConfig = {
    llmProvider: 'test',
    model: 'm',
    tools: [],
    permissionMode: 'edit',
    ...initial,
  }
  const registry = new HookRegistry()
  const mgr = new ConfigManager(
    () => config,
    (c) => {
      config = c
    },
    () => false,
    false,
    () => {},
    () => false,
    () => false,
    () => {},
    registry,
  )
  return { mgr, getConfig: () => config }
}

describe('ConfigManager executionMode', () => {
  it('setExecutionMode plan dual-writes forcePlan', () => {
    const { mgr, getConfig } = makeMgr()
    expect(mgr.setExecutionMode('plan')).toBe(true)
    expect(getConfig().executionMode).toBe('plan')
    expect(getConfig().forcePlan).toBe(true)
  })

  it('rejects autopilot without full', () => {
    const { mgr, getConfig } = makeMgr({ permissionMode: 'edit' })
    expect(mgr.setExecutionMode('autopilot')).toBe(false)
    expect(getConfig().executionMode).toBeUndefined()
  })

  it('accepts autopilot with full', () => {
    const { mgr, getConfig } = makeMgr({ permissionMode: 'full' })
    expect(mgr.setExecutionMode('autopilot')).toBe(true)
    expect(getConfig().executionMode).toBe('autopilot')
    expect(getConfig().forcePlan).toBe(false)
  })

  it('leaving full clears autopilot', () => {
    const { mgr, getConfig } = makeMgr({ permissionMode: 'full', executionMode: 'autopilot' })
    expect(mgr.setPermissionMode('edit')).toBe(true)
    expect(getConfig().executionMode).toBe('interactive')
    expect(getConfig().forcePlan).toBe(false)
  })

  it('setForcePlan true writes plan mode', () => {
    const { mgr, getConfig } = makeMgr()
    expect(mgr.setForcePlan(true)).toBe(true)
    expect(getConfig().executionMode).toBe('plan')
  })

  it('setForcePlan false preserves autopilot', () => {
    const { mgr, getConfig } = makeMgr({
      permissionMode: 'full',
      executionMode: 'autopilot',
      forcePlan: false,
    })
    expect(mgr.setForcePlan(false)).toBe(true)
    expect(getConfig().executionMode).toBe('autopilot')
  })
})
