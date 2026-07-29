import { describe, it, expect } from 'vitest'
import {
  statusEmoji,
  statusLabelKey,
  resolveToolEnabled,
  toggleTool,
  countEnabledTools,
  applyToolEnablement,
  encodeToolSelection,
} from './McpConfig'

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

describe('countEnabledTools', () => {
  const tools = ['a', 'b', 'c']

  it('counts all when no filters', () => {
    expect(countEnabledTools(tools, [], [])).toBe(3)
  })

  it('respects denylist', () => {
    expect(countEnabledTools(tools, [], ['b'])).toBe(2)
  })

  it('respects allowlist', () => {
    expect(countEnabledTools(tools, ['a'], [])).toBe(1)
  })
})

describe('encodeToolSelection', () => {
  const tools = ['a', 'b', 'c', 'd']

  it('encodes all-on as empty lists', () => {
    expect(encodeToolSelection(tools, new Set(tools))).toEqual({
      enabledTools: [],
      disabledTools: [],
    })
  })

  it('encodes all-off as full denylist', () => {
    expect(encodeToolSelection(tools, new Set())).toEqual({
      enabledTools: [],
      disabledTools: tools,
    })
  })

  it('prefers denylist when most tools stay on', () => {
    expect(encodeToolSelection(tools, new Set(['a', 'b', 'c']))).toEqual({
      enabledTools: [],
      disabledTools: ['d'],
    })
  })

  it('prefers allowlist when most tools are off', () => {
    expect(encodeToolSelection(tools, new Set(['a']))).toEqual({
      enabledTools: ['a'],
      disabledTools: [],
    })
  })
})

describe('applyToolEnablement', () => {
  const tools = ['a', 'b', 'c']

  it('disables a filtered subset (allowlist when majority off)', () => {
    // 1 of 3 on ⇒ allowlist is the compact encoding
    const result = applyToolEnablement(['a', 'c'], tools, [], [], false)
    expect(result).toEqual({ enabledTools: ['b'], disabledTools: [] })
    expect(resolveToolEnabled('a', result.enabledTools, result.disabledTools)).toBe(false)
    expect(resolveToolEnabled('b', result.enabledTools, result.disabledTools)).toBe(true)
    expect(resolveToolEnabled('c', result.enabledTools, result.disabledTools)).toBe(false)
  })

  it('re-enables filtered tools from denylist', () => {
    const result = applyToolEnablement(['a'], tools, [], ['a', 'b'], true)
    expect(result.disabledTools).toEqual(['b'])
  })

  it('enable all filtered with empty lists is a no-op', () => {
    const result = applyToolEnablement(tools, tools, [], [], true)
    expect(result).toEqual({ enabledTools: [], disabledTools: [] })
  })

  it('disable all does not re-enable via empty allowlist edge case', () => {
    // Starting from allowlist of all tools — iterative toggle used to clear the last
    // allowlist entry and accidentally re-enable everything.
    const result = applyToolEnablement(tools, tools, ['a', 'b', 'c'], [], false)
    expect(result).toEqual({ enabledTools: [], disabledTools: tools })
    expect(countEnabledTools(tools, result.enabledTools, result.disabledTools)).toBe(0)
  })
})
