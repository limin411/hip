import { describe, it, expect } from 'vitest'
import { buildMcpDraft, isMcpDraftValid, mcpConfigToForm, type McpForm } from './mcpServerDraft'

const base: McpForm = {
  name: 'My Server',
  transport: 'stdio',
  command: 'my-mcp',
  args: '--flag a',
  env: [{ key: 'TOKEN', value: 'x' }],
  url: '',
  headers: [],
  enabled: true,
  enabledTools: [],
  disabledTools: [],
}

describe('isMcpDraftValid', () => {
  it('stdio requires a name and a command', () => {
    expect(isMcpDraftValid(base)).toBe(true)
    expect(isMcpDraftValid({ ...base, command: '   ' })).toBe(false)
    expect(isMcpDraftValid({ ...base, name: '' })).toBe(false)
  })
  it('sse/http require a name and a url, not a command', () => {
    const sse: McpForm = { ...base, transport: 'sse', command: '', url: 'https://x/mcp' }
    expect(isMcpDraftValid(sse)).toBe(true)
    expect(isMcpDraftValid({ ...sse, url: '  ' })).toBe(false)
    const http: McpForm = { ...base, transport: 'http', command: '', url: 'https://x/mcp' }
    expect(isMcpDraftValid(http)).toBe(true)
  })
})

describe('buildMcpDraft', () => {
  it('stdio emits command/args/env, drops url/headers', () => {
    const d = buildMcpDraft(base)
    expect(d).toEqual({
      name: 'My Server',
      transport: 'stdio',
      command: 'my-mcp',
      args: ['--flag', 'a'],
      env: { TOKEN: 'x' },
      enabled: true,
    })
    expect('url' in d).toBe(false)
    expect('headers' in d).toBe(false)
  })
  it('sse/http emit url/headers, drop command/args/env', () => {
    const d = buildMcpDraft({
      ...base,
      transport: 'http',
      command: 'ignored',
      url: 'https://x/mcp',
      headers: [{ key: 'Authorization', value: 'Bearer t' }],
    })
    expect(d).toEqual({
      name: 'My Server',
      transport: 'http',
      url: 'https://x/mcp',
      headers: { Authorization: 'Bearer t' },
      enabled: true,
    })
    expect('command' in d).toBe(false)
  })
  it('omits empty env/headers maps and empty args', () => {
    const d = buildMcpDraft({ ...base, args: '   ', env: [{ key: '', value: '' }] })
    expect('args' in d).toBe(false)
    expect('env' in d).toBe(false)
  })
})

describe('mcpConfigToForm', () => {
  it('round-trips a stdio config back into editable form', () => {
    const f = mcpConfigToForm({
      id: 's1',
      name: 'My Server',
      transport: 'stdio',
      command: 'my-mcp',
      args: ['--flag', 'a'],
      env: { TOKEN: 'x' },
      enabled: false,
    })
    expect(f).toEqual({
      name: 'My Server',
      transport: 'stdio',
      command: 'my-mcp',
      args: '--flag a',
      env: [{ key: 'TOKEN', value: 'x' }],
      url: '',
      headers: [],
      enabled: false,
      enabledTools: [],
      disabledTools: [],
    })
  })
})
