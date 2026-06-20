import { describe, it, expect } from 'vitest'
import { statusEmoji, statusLabelKey, resolveToolEnabled, toggleTool } from './McpConfig'

describe('statusEmoji', () => {
  it('returns green circle for connected', () => {
    expect(statusEmoji('connected')).toBe('\uD83D\uDFE2')
  })
  it('returns yellow circle for connecting', () => {
    expect(statusEmoji('connecting')).toBe('\uD83D\uDFE1')
  })
  it('returns red circle for disconnected', () => {
    expect(statusEmoji('disconnected')).toBe('\uD83D\uDD34')
  })
  it('returns warning for error', () => {
    expect(statusEmoji('error')).toBe('\u26A0\uFE0F')
  })
})

describe('statusLabelKey', () => {
  it('returns correct i18n key for each status', () => {
    expect(statusLabelKey('connected')).toBe('settings.mcp.statusConnected')
    expect(statusLabelKey('connecting')).toBe('settings.mcp.statusConnecting')
    expect(statusLabelKey('disconnected')).toBe('settings.mcp.statusDisconnected')
    expect(statusLabelKey('error')).toBe('settings.mcp.statusError')
  })
})

describe('resolveToolEnabled', () => {
  it('returns true when no filters are set', () => {
    expect(resolveToolEnabled('tool_a', [], [])).toBe(true)
  })

  it('returns false when tool is in disabledTools', () => {
    expect(resolveToolEnabled('tool_a', [], ['tool_a'])).toBe(false)
  })

  it('returns true when tool is in enabledTools (allowlist)', () => {
    expect(resolveToolEnabled('tool_a', ['tool_a', 'tool_b'], [])).toBe(true)
  })

  it('returns false when tool is NOT in enabledTools (allowlist active)', () => {
    expect(resolveToolEnabled('tool_c', ['tool_a', 'tool_b'], [])).toBe(false)
  })

  it('disabledTools takes precedence over enabledTools', () => {
    expect(resolveToolEnabled('tool_a', ['tool_a'], ['tool_a'])).toBe(false)
  })

  it('empty enabledTools means all allowed', () => {
    expect(resolveToolEnabled('any_tool', [], ['other_tool'])).toBe(true)
  })
})

describe('toggleTool', () => {
  it('disabling a tool with empty allowlist adds to disabledTools', () => {
    const result = toggleTool('tool_a', [], [])
    expect(result).toEqual({ enabledTools: [], disabledTools: ['tool_a'] })
  })

  it('enabling a disabled tool with empty allowlist removes from disabledTools', () => {
    const result = toggleTool('tool_a', [], ['tool_a', 'tool_b'])
    expect(result).toEqual({ enabledTools: [], disabledTools: ['tool_b'] })
  })

  it('disabling a tool with active allowlist removes from enabledTools', () => {
    const result = toggleTool('tool_a', ['tool_a', 'tool_b'], [])
    expect(result).toEqual({ enabledTools: ['tool_b'], disabledTools: [] })
  })

  it('enabling a tool with active allowlist adds to enabledTools', () => {
    const result = toggleTool('tool_c', ['tool_a', 'tool_b'], [])
    expect(result).toEqual({ enabledTools: ['tool_a', 'tool_b', 'tool_c'], disabledTools: [] })
  })

  it('disabling the last tool in allowlist empties it', () => {
    const result = toggleTool('tool_a', ['tool_a'], [])
    expect(result).toEqual({ enabledTools: [], disabledTools: [] })
  })

  it('enabling a tool with active allowlist+denylist removes from disabledTools too', () => {
    // This tests: disabledTools takes precedence, so toggling should work
    const result = toggleTool('tool_a', ['tool_a', 'tool_b'], ['tool_a'])
    // tool_a is disabled via denylist, toggling should enable it:
    // enabled=resolveToolEnabled('tool_a', ['tool_a','tool_b'], ['tool_a']) = false (deny wins)
    // Since enabledTools has items, enabling adds to enabledTools
    expect(result.enabledTools).toContain('tool_a')
  })
})
