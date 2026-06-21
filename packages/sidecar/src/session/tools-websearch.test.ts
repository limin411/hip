import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as dns } from 'node:dns'
import { buildTools } from './tools.js'
import { NetworkPolicy } from './network-policy.js'

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
const savedEnv = { ...process.env }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-ws-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
  // Restore any env vars mutated during tests
  process.env = { ...savedEnv, ...process.env }
})

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

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

  it('returns error when API key is not configured', async () => {
    delete process.env.HIP_WEBSEARCH_API_KEY
    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toMatch(/API key not configured/i)
  })

  it('calls fetch with correct URL and API key header', async () => {
    process.env.HIP_WEBSEARCH_API_KEY = 'test-key'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ AbstractText: 'result text' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    await byName(tools, 'web_search').invoke({ query: 'hello world' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('hello%20world'),
      expect.objectContaining({ headers: { 'X-Api-Key': 'test-key' } }),
    )
  })

  it('returns text result on success', async () => {
    process.env.HIP_WEBSEARCH_API_KEY = 'test-key'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'search result content',
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toBe('search result content')
  })

  it('returns error on HTTP non-ok status', async () => {
    process.env.HIP_WEBSEARCH_API_KEY = 'test-key'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out).toMatch(/status 429/)
  })

  it('rate-limits when policy maxRequestsPerMinute is exceeded (N+1th call)', async () => {
    process.env.HIP_WEBSEARCH_API_KEY = 'test-key'
    const fixedTime = 1_000_000
    const policy = new NetworkPolicy(
      { maxRequestsPerMinute: 2 },
      { now: () => fixedTime },
    )
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'search result',
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    // First 2 calls succeed
    const out1 = String(await byName(tools, 'web_search').invoke({ query: 'q1' }))
    expect(out1).toBe('search result')
    const out2 = String(await byName(tools, 'web_search').invoke({ query: 'q2' }))
    expect(out2).toBe('search result')

    // 3rd call (N+1) rate-limited
    const out3 = String(await byName(tools, 'web_search').invoke({ query: 'q3' }))
    expect(out3).toMatch(/rate limit exceeded/i)
  })

  it('clips response to policy maxResponseBytes when smaller than default', async () => {
    process.env.HIP_WEBSEARCH_API_KEY = 'test-key'
    const responseText = 'x'.repeat(5000)
    const policy = new NetworkPolicy({ maxResponseBytes: 200 })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => responseText,
    })
    vi.stubGlobal('fetch', mockFetch)

    const tools = buildTools(root, undefined, undefined, undefined, { webSearchEnabled: true, networkPolicy: policy })
    const out = String(await byName(tools, 'web_search').invoke({ query: 'test' }))
    expect(out.length).toBeLessThanOrEqual(200 + 60)
    expect(out).toContain('truncated')
    expect(out).toContain('0KB')
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
      headers: { 'User-Agent': 'hip/0.1.0' },
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
