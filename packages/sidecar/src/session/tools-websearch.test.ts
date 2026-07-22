import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as dns } from 'node:dns'
import { buildTools } from './tools.js'
import { NetworkPolicy } from './network-policy.js'
import { HIP_PRODUCT_VERSION } from './product/content.js'
import { _resetExaSession } from './tools/web.js'

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      resolve: vi.fn().mockResolvedValue(['1.1.1.1']),
    },
  }
})

const mockResolve = vi.mocked(dns.resolve)

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-ws-'))
  _resetExaSession()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
  _resetExaSession()
})

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockResponse(body: string, opts?: { status?: number; headers?: Record<string, string> }) {
  const status = opts?.status ?? 200
  const hdrs = opts?.headers ?? {}
  return {
    ok: status < 400,
    status,
    text: async () => body,
    json: async () => { try { return JSON.parse(body) } catch { return {} } },
    headers: {
      get: (name: string) => hdrs[name.toLowerCase()] ?? null,
    },
  }
}

function mockExaCall(initResponseBody: unknown, searchResultText: string) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === 'https://mcp.exa.ai/mcp') {
      const body = JSON.parse((init?.body as string) || '{}')
      if (body.method === 'initialize') {
        return Promise.resolve(mockResponse(JSON.stringify(initResponseBody), {
          headers: { 'mcp-session-id': 'test-session' },
        }))
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(mockResponse('', { status: 202 }))
      }
      if (body.method === 'tools/call') {
        return Promise.resolve(mockResponse(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: searchResultText }] },
        })))
      }
    }
    return Promise.resolve(mockResponse('unexpected url', { status: 500 }))
  })
}

/** Mock fetch where Exa fails (all MCP calls return errors), DDG succeeds. */
function mockExaDown() {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === 'https://mcp.exa.ai/mcp') {
      return Promise.resolve(mockResponse('unavailable', { status: 503 }))
    }
    if (url.startsWith('https://api.duckduckgo.com/')) {
      return Promise.resolve(mockResponse(JSON.stringify({ AbstractText: 'ddg fallback result' })))
    }
    return Promise.resolve(mockResponse('ok', { status: 200 }))
  })
}

/** Mock fetch where Exa succeeds but tools/call returns an error. */
function mockExaToolError(errorMessage: string) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url === 'https://mcp.exa.ai/mcp') {
      const body = JSON.parse((init?.body as string) || '{}')
      if (body.method === 'initialize') {
        return Promise.resolve(mockResponse(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'exa-mcp', version: '1.0.0' } },
        }), { headers: { 'mcp-session-id': 'test-session' } }))
      }
      if (body.method === 'notifications/initialized') {
        return Promise.resolve(mockResponse('', { status: 202 }))
      }
      if (body.method === 'tools/call') {
        return Promise.resolve(mockResponse(JSON.stringify({
          jsonrpc: '2.0', id: body.id,
          error: { code: -32000, message: errorMessage },
        })))
      }
    }
    if (url.startsWith('https://api.duckduckgo.com/')) {
      return Promise.resolve(mockResponse(JSON.stringify({ AbstractText: 'ddg fallback' })))
    }
    return Promise.resolve(mockResponse('ok'))
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('web_search tool', () => {
  it('is registered when webSearchEnabled=true', () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    expect(tools.find((t) => t.name === 'web_search')).toBeDefined()
    expect(tools.find((t) => t.name === 'web_fetch')).toBeDefined()
  })

  it('is NOT registered when webSearchEnabled=false', () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: false })
    expect(tools.find((t) => t.name === 'web_search')).toBeUndefined()
    expect(tools.find((t) => t.name === 'web_fetch')).toBeUndefined()
  })

  it('is NOT registered by default (opts omitted)', () => {
    const tools = buildTools(root)
    expect(tools.find((t) => t.name === 'web_search')).toBeUndefined()
    expect(tools.find((t) => t.name === 'web_fetch')).toBeUndefined()
  })

  it('searches via Exa MCP (primary backend, no API key required)', async () => {
    vi.stubGlobal('fetch', mockExaCall(
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'exa-mcp', version: '1.0.0' } } },
      'exa search results',
    ))

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'hello world' }))
    expect(out).toBe('exa search results')
  })

  it('falls back to DDG Instant Answer when Exa is unavailable', async () => {
    vi.stubGlobal('fetch', mockExaDown())

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toMatch(/ddg fallback result/)
  })

  it('falls back to DDG when Exa tool returns an error', async () => {
    vi.stubGlobal('fetch', mockExaToolError('rate limited'))

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toMatch(/ddg fallback/)
  })

  it('passes HIP_EXA_API_KEY as x-api-key header to Exa', async () => {
    process.env.HIP_EXA_API_KEY = 'my-exa-key'
    const mockFetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === 'https://mcp.exa.ai/mcp') {
        const body = JSON.parse((init?.body as string) || '{}')
        if (body.method === 'initialize') {
          return Promise.resolve(mockResponse(JSON.stringify({
            jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'exa-mcp', version: '1.0.0' } },
          }), { headers: { 'mcp-session-id': 'test-session' } }))
        }
        if (body.method === 'notifications/initialized') {
          return Promise.resolve(mockResponse('', { status: 202 }))
        }
        if (body.method === 'tools/call') {
          // Verify x-api-key header is present
          expect((init?.headers as Record<string, string>)?.['x-api-key']).toBe('my-exa-key')
          return Promise.resolve(mockResponse(JSON.stringify({
            jsonrpc: '2.0', id: body.id,
            result: { content: [{ type: 'text', text: 'results with key' }] },
          })))
        }
      }
      return Promise.resolve(mockResponse('unexpected', { status: 500 }))
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toBe('results with key')
    delete process.env.HIP_EXA_API_KEY
  })

  it('returns error when both Exa and DDG fail', async () => {
    const mockFetch = vi.fn(() => Promise.resolve(mockResponse('down', { status: 503 })))
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toMatch(/Error: web search failed/)
  })

  it('rate-limits when policy maxRequestsPerMinute is exceeded (N+1th call)', async () => {
    const fixedTime = 1_000_000
    const policy = new NetworkPolicy(
      { maxRequestsPerMinute: 2 },
      { now: () => fixedTime },
    )
    vi.stubGlobal('fetch', mockExaCall(
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'exa-mcp', version: '1.0.0' } } },
      'search result',
    ))

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    // First 2 calls pass rate limit → call Exa
    const out1 = String(await byName(tools, 'web_search').invoke({ query: 'q1' }))
    expect(out1).toBe('search result')
    const out2 = String(await byName(tools, 'web_search').invoke({ query: 'q2' }))
    expect(out2).toBe('search result')

    // 3rd call (N+1) rate-limited (policy check happens before Exa/DDG)
    const out3 = String(await byName(tools, 'web_search').invoke({ query: 'q3' }))
    expect(out3).toMatch(/rate limit exceeded/i)
  })

  it('clips response to policy maxResponseBytes when smaller than default', async () => {
    const responseText = 'x'.repeat(5000)
    const policy = new NetworkPolicy({ maxResponseBytes: 200 })
    vi.stubGlobal('fetch', mockExaCall(
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'exa-mcp', version: '1.0.0' } } },
      responseText,
    ))

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out.length).toBeLessThanOrEqual(200 + 60)
    expect(out).toContain('truncated')
    expect(out).toContain('0KB')
  })

  it('reuses Exa MCP session across calls', async () => {
    let initCallCount = 0
    const mockFetch = vi.fn((url: string, init?: RequestInit) => {
      if (url === 'https://mcp.exa.ai/mcp') {
        const body = JSON.parse((init?.body as string) || '{}')
        if (body.method === 'initialize') {
          initCallCount++
          return Promise.resolve(mockResponse(JSON.stringify({
            jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'exa-mcp', version: '1.0.0' } },
          }), { headers: { 'mcp-session-id': 'test-session' } }))
        }
        if (body.method === 'notifications/initialized') {
          return Promise.resolve(mockResponse('', { status: 202 }))
        }
        if (body.method === 'tools/call') {
          return Promise.resolve(mockResponse(JSON.stringify({
            jsonrpc: '2.0', id: body.id,
            result: { content: [{ type: 'text', text: `result-${initCallCount}` }] },
          })))
        }
      }
      return Promise.resolve(mockResponse('unexpected', { status: 500 }))
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    // First call initializes session
    const out1 = String(await byName(tools, 'web_search').invoke({ query: 'q1' }))
    expect(out1).toBe('result-1')
    // Second call reuses session (initCallCount stays at 1)
    const out2 = String(await byName(tools, 'web_search').invoke({ query: 'q2' }))
    expect(out2).toBe('result-1')
    expect(initCallCount).toBe(1)
  })
})

describe('web_fetch tool', () => {
  it('returns fetched content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html>hello</html>',
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example.com' }))
    expect(out).toBe('<html>hello</html>')
    expect(mockFetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
      headers: { 'User-Agent': `hip/${HIP_PRODUCT_VERSION}` },
    }))
  })

  it('clips output to 64KB', async () => {
    const longText = 'a'.repeat(100_000)
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => longText,
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example.com' }))
    expect(out.length).toBeLessThanOrEqual(64 * 1024 + 60)
    expect(out).toContain('truncated')
  })

  it('handles HTTP 404 gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example.com/nope' }))
    expect(out).toMatch(/status 404/)
  })

  it('handles timeout gracefully', async () => {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'TimeoutError'
    const mockFetch = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://slow.example.com' }))
    expect(out).toMatch(/timed out/i)
  })

  it('passes AbortSignal with 30s timeout', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'ok' })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    await byName(tools, 'web_fetch').invoke({ url: 'https://example.com' })

    const callSignal = mockFetch.mock.calls[0][1].signal
    expect(callSignal).toBeInstanceOf(AbortSignal)
    expect(callSignal.aborted).toBe(false)
  })

  it('succeeds when networkPolicy is present', async () => {
    mockResolve.mockResolvedValue(['1.1.1.1'])
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html>hello</html>',
    })
    vi.stubGlobal('fetch', mockFetch)

    const policy = new NetworkPolicy()
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example.com' }))
    expect(out).toBe('<html>hello</html>')
  })

  it('rate-limits N+1th call when maxRequestsPerMinute is 1', async () => {
    mockResolve.mockResolvedValue(['1.1.1.1'])
    const fixedTime = 1_000_000
    const policy = new NetworkPolicy(
      { maxRequestsPerMinute: 1 },
      { now: () => fixedTime },
    )
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'content',
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    // 1st call (N) succeeds
    const out1 = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example.com' }))
    expect(out1).toBe('content')

    // 2nd call (N+1) rate-limited
    const out2 = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example2.com' }))
    expect(out2).toMatch(/rate limit exceeded/i)
  })

  it('clips response to maxResponseBytes when smaller than WEB_OUTPUT_CAP', async () => {
    mockResolve.mockResolvedValue(['1.1.1.1'])
    const responseText = 'y'.repeat(5000)
    const policy = new NetworkPolicy({ maxResponseBytes: 150 })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => responseText,
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://example.com' }))
    expect(out.length).toBeLessThanOrEqual(150 + 60)
    expect(out).toContain('truncated')
    expect(out).toContain('0KB')
  })
})

describe('web_fetch SSRF protection', () => {
  it('rejects http:// scheme', async () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'http://example.com' }))
    expect(out).toMatch(/scheme.*http.*not allowed/i)
  })

  it('rejects file:// scheme', async () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'file:///etc/passwd' }))
    expect(out).toMatch(/scheme.*file.*not allowed/i)
  })

  it('rejects bare IPv4 addresses', async () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://1.2.3.4/' }))
    expect(out).toMatch(/bare IP.*not allowed/i)
  })

  it('rejects bare IPv4 private addresses with private error', async () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://10.0.0.1/' }))
    expect(out).toMatch(/private.internal IP/i)
  })

  it('rejects bare IPv4 link-local address (169.254.x.x)', async () => {
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://169.254.169.254/' }))
    expect(out).toMatch(/private.internal IP/i)
  })

  it('rejects URLs resolving to private IPs via DNS', async () => {
    mockResolve.mockResolvedValue(['10.0.0.5'])
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://internal.example.com/' }))
    expect(out).toMatch(/private.internal IP.*10\.0\.0\.5/i)
  })

  it('rejects URLs resolving to 127.0.0.1 via DNS', async () => {
    mockResolve.mockResolvedValue(['127.0.0.1'])
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://localhost.evil.com/' }))
    expect(out).toMatch(/private.internal IP.*127\.0\.0\.1/i)
  })

  it('rejects DNS resolution failure', async () => {
    mockResolve.mockRejectedValue(new Error('ENOTFOUND'))
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_fetch').invoke({ url: 'https://nonexistent.invalid/' }))
    expect(out).toMatch(/DNS resolution failed/i)
  })
})
