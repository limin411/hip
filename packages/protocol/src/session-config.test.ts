import { describe, it, expect } from 'vitest'
import { normalizeSessionConfig, SESSION_CONFIG_DEFAULTS } from './session-config.js'

const base = { llmProvider: 'deepseek', model: 'm', tools: [] as string[] }

describe('normalizeSessionConfig', () => {
  it('fills defaults when optional fields are undefined', () => {
    const out = normalizeSessionConfig({ ...base })
    expect(out.permissionMode).toBe(SESSION_CONFIG_DEFAULTS.permissionMode)
    expect(out.enableStickyApproval).toBe(SESSION_CONFIG_DEFAULTS.enableStickyApproval)
    expect(out.useEventSource).toBe(SESSION_CONFIG_DEFAULTS.useEventSource)
    expect(out.orchMode).toBe(SESSION_CONFIG_DEFAULTS.orchMode)
    expect(out.llmProvider).toBe('deepseek')
    expect(out.model).toBe('m')
    expect(out.tools).toEqual([])
  })

  it('preserves explicit values including falsy booleans', () => {
    const out = normalizeSessionConfig({
      ...base,
      permissionMode: 'chat',
      enableStickyApproval: false,
      useEventSource: false,
      orchMode: 'dag',
    })
    expect(out.permissionMode).toBe('chat')
    expect(out.enableStickyApproval).toBe(false)
    expect(out.useEventSource).toBe(false)
    expect(out.orchMode).toBe('dag')
  })

  it('does not strip unrelated optional fields', () => {
    const out = normalizeSessionConfig({
      ...base,
      cwd: '/tmp/proj',
      surface: 'code',
      language: 'zh-CN',
    })
    expect(out.cwd).toBe('/tmp/proj')
    expect(out.surface).toBe('code')
    expect(out.language).toBe('zh-CN')
  })
})
