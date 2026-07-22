import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { ProxyAgent } from 'undici'
import { z } from 'zod'
import type { NetworkPolicy } from '../network-policy.js'
import { HIP_PRODUCT_VERSION } from '../product/content.js'
import { clipText, validateFetchUrl, WEB_OUTPUT_CAP } from './helpers.js'

// ── HTTP helper (honors HTTP(S)_PROXY — Node's fetch does not by default) ───
//
// Many networks only reach DDG / some sites via a local proxy (Clash, etc.).
// curl respects http_proxy; undici/Node fetch does not unless a dispatcher is set.

const WEB_HTTP_TIMEOUT_MS = 20_000

function resolveHttpProxyUrl(): string | undefined {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ]
  for (const raw of candidates) {
    const v = raw?.trim()
    if (!v) continue
    // undici ProxyAgent speaks HTTP CONNECT proxies; skip bare socks URLs
    if (/^socks/i.test(v)) continue
    return v
  }
  return undefined
}

/** Lazy proxy agent so tests that stub global fetch keep working when no proxy is set. */
let cachedProxyAgent: ProxyAgent | null | undefined

function getProxyAgent(): ProxyAgent | null {
  if (cachedProxyAgent !== undefined) return cachedProxyAgent
  const url = resolveHttpProxyUrl()
  cachedProxyAgent = url ? new ProxyAgent(url) : null
  return cachedProxyAgent
}

/** Reset proxy agent cache (tests / env changes). */
export function _resetWebHttpProxy(): void {
  cachedProxyAgent = undefined
}

/**
 * fetch for web tools. Uses HTTP(S)_PROXY when set; always applies a timeout.
 * Goes through globalThis.fetch so vitest stubs still intercept.
 */
async function webHttpFetch(url: string, init?: RequestInit): Promise<Response> {
  const agent = getProxyAgent()
  const signal = init?.signal ?? AbortSignal.timeout(WEB_HTTP_TIMEOUT_MS)
  const opts: RequestInit & { dispatcher?: ProxyAgent } = { ...init, signal }
  if (agent) opts.dispatcher = agent
  return globalThis.fetch(url, opts)
}

// ── Exa MCP client (free tier, no API key required) ─────────────────────────
//
// Exa hosts a public MCP server at https://mcp.exa.ai/mcp that provides
// web_search_exa with a free tier. No API key is needed for basic use.
// Set HIP_EXA_API_KEY for higher rate limits (sent as x-api-key header).
//
// Protocol: JSON-RPC 2.0 over HTTP POST (MCP Streamable HTTP transport).
// Spec requires Accept: application/json, text/event-stream; servers may
// respond with either Content-Type. Session: initialize → notifications/initialized → tools/call.

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp'

/** MCP Streamable HTTP: client MUST accept both JSON and SSE response shapes. */
const MCP_ACCEPT = 'application/json, text/event-stream'

interface ExaSession {
  sessionId: string
}

let exaSession: ExaSession | null = null
let exaInitPromise: Promise<ExaSession> | null = null

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: MCP_ACCEPT,
    ...extra,
  }
}

/**
 * Parse a Streamable HTTP MCP response body.
 * Servers may return pure JSON or SSE (`event: message` / `data: {...}` lines).
 * Returns the last JSON-RPC message that has a `result` or `error` field.
 */
export function parseMcpHttpBody(body: string): {
  error?: { message: string }
  result?: { content?: Array<{ type: string; text: string }> }
} {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Exa returned empty body')

  // Pure JSON response
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as {
      error?: { message: string }
      result?: { content?: Array<{ type: string; text: string }> }
    }
  }

  // SSE: collect data: payloads (possibly multi-line) and parse the last RPC message
  let last: { error?: { message: string }; result?: { content?: Array<{ type: string; text: string }> } } | null = null
  let dataBuf = ''
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('data:')) {
      const payload = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5)
      dataBuf += (dataBuf ? '\n' : '') + payload
      continue
    }
    if (line === '' && dataBuf) {
      try {
        const msg = JSON.parse(dataBuf) as {
          error?: { message: string }
          result?: { content?: Array<{ type: string; text: string }> }
        }
        if (msg && (msg.result !== undefined || msg.error !== undefined)) last = msg
      } catch {
        // ignore non-JSON data frames
      }
      dataBuf = ''
    }
  }
  if (dataBuf) {
    try {
      const msg = JSON.parse(dataBuf) as {
        error?: { message: string }
        result?: { content?: Array<{ type: string; text: string }> }
      }
      if (msg && (msg.result !== undefined || msg.error !== undefined)) last = msg
    } catch {
      // ignore
    }
  }
  if (!last) throw new Error('Exa SSE response contained no JSON-RPC result')
  return last
}

async function readMcpResponse(res: Response): Promise<ReturnType<typeof parseMcpHttpBody>> {
  const body = await res.text()
  return parseMcpHttpBody(body)
}

async function ensureExaSession(): Promise<ExaSession> {
  if (exaSession) return exaSession
  if (!exaInitPromise) {
    exaInitPromise = (async () => {
      try {
        const res = await webHttpFetch(EXA_MCP_URL, {
          method: 'POST',
          headers: mcpHeaders(),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'hip', version: HIP_PRODUCT_VERSION },
            },
          }),
        })
        if (!res.ok) {
          // Drain body so the connection can be reused; surface server hint when present
          const errBody = await res.text().catch(() => '')
          throw new Error(
            `Exa init failed: HTTP ${res.status}${errBody ? ` — ${errBody.slice(0, 200)}` : ''}`,
          )
        }
        const sid = res.headers.get('Mcp-Session-Id') ?? res.headers.get('mcp-session-id') ?? ''
        // Consume body (SSE or JSON) so the connection is fully drained
        await res.text().catch(() => '')
        exaSession = { sessionId: sid }
        // Send initialized notification (fire-and-forget — failures are non-fatal)
        webHttpFetch(EXA_MCP_URL, {
          method: 'POST',
          headers: mcpHeaders({ 'Mcp-Session-Id': sid }),
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        }).catch(() => {})
        return exaSession
      } catch (err) {
        // Allow the next call to retry initialize instead of reusing a rejected promise
        exaSession = null
        exaInitPromise = null
        throw err
      }
    })()
  }
  return exaInitPromise
}

function invalidateExaSession(): void {
  exaSession = null
  exaInitPromise = null
}

/** Reset Exa MCP session state. Exported for test isolation. */
export function _resetExaSession(): void {
  invalidateExaSession()
}

async function exaWebSearch(query: string, apiKey?: string): Promise<string> {
  const { sessionId } = await ensureExaSession()
  const headers = mcpHeaders({ 'Mcp-Session-Id': sessionId })
  if (apiKey) headers['x-api-key'] = apiKey

  const res = await webHttpFetch(EXA_MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: { query, numResults: 5, livecrawl: 'fallback', type: 'auto' },
      },
    }),
  })
  if (!res.ok) {
    // Session-related errors → invalidate so next call re-initializes
    if (res.status === 400 || res.status === 404 || res.status === 406) invalidateExaSession()
    const errBody = await res.text().catch(() => '')
    throw new Error(
      `Exa returned HTTP ${res.status}${errBody ? ` — ${errBody.slice(0, 200)}` : ''}`,
    )
  }
  const data = await readMcpResponse(res)
  if (data.error) throw new Error(data.error.message)
  const text = data.result?.content?.[0]?.text
  if (!text) throw new Error('Exa returned empty result')
  return text
}

// ── DuckDuckGo Instant Answer (free, no key, fallback only) ─────────────────
//
// The Instant Answer API returns topic summaries, definitions, and
// disambiguation — NOT full web search results. Used only as a fallback
// when Exa MCP is unavailable. Goes through webHttpFetch so HTTP(S)_PROXY works.

const DDG_API = 'https://api.duckduckgo.com'

async function ddgInstantAnswer(query: string): Promise<string> {
  const url = `${DDG_API}/?q=${encodeURIComponent(query)}&format=json&no_html=1`
  try {
    const res = await webHttpFetch(url, {
      headers: { 'User-Agent': `hip/${HIP_PRODUCT_VERSION}` },
    })
    if (!res.ok) throw new Error(`DDG returned HTTP ${res.status}`)
    const text = await res.text()
    if (!text.trim()) throw new Error('DDG returned empty body')
    return text
  } catch (err) {
    const msg = (err as Error).message
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
    const detail = cause?.code ?? cause?.message ?? msg
    if (msg.includes('timeout') || (err as Error).name === 'TimeoutError' || cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error(`DDG connect/timeout: ${detail}`)
    }
    throw new Error(`DDG fetch failed: ${detail}`)
  }
}

// ── Build tools ─────────────────────────────────────────────────────────────

export function buildWebTools(
  networkPolicy: NetworkPolicy | undefined,
  sessionId: string | undefined,
): StructuredToolInterface[] {
  const webSearch = tool(
    async ({ query }) => {
      // Network policy and rate-limit checks (shared by both backends)
      const ddgUrl = `${DDG_API}/?q=${encodeURIComponent(query)}&format=json&no_html=1`
      const policyCheck = networkPolicy?.checkUrl(ddgUrl)
      if (policyCheck && !policyCheck.allowed) {
        return `Error: network policy blocked web_search: ${policyCheck.reason ?? 'blocked'}`
      }
      const rateLimitCheck = networkPolicy?.checkRateLimit(sessionId ?? '')
      if (rateLimitCheck && !rateLimitCheck.allowed) {
        return `Error: network policy rate limit exceeded: ${rateLimitCheck.reason ?? 'too many requests'}`
      }

      const cap = Math.min(WEB_OUTPUT_CAP, networkPolicy?.getResponseSizeCap() ?? WEB_OUTPUT_CAP)
      const exaKey = process.env.HIP_EXA_API_KEY?.trim() || undefined

      // Primary: Exa MCP — free tier, no API key required for basic use
      try {
        const result = await exaWebSearch(query, exaKey)
        return clipText(result, cap)
      } catch (exaErr) {
        // Fallback: DuckDuckGo Instant Answer — free, no key, limited to topic summaries
        try {
          const result = await ddgInstantAnswer(query)
          return clipText(result, cap)
        } catch (ddgErr) {
          return (
            `Error: web search failed — primary (Exa): ${(exaErr as Error).message}; ` +
            `fallback (DDG): ${(ddgErr as Error).message}`
          )
        }
      }
    },
    {
      name: 'web_search',
      description:
        'Search the web for the given query and return results as text. ' +
        'Uses Exa search engine (free tier, no API key required). ' +
        'Falls back to DuckDuckGo Instant Answer if Exa is unavailable. ' +
        'Honors HTTP(S)_PROXY / http(s)_proxy for both backends. ' +
        'Set HIP_EXA_API_KEY for higher rate limits.',
      schema: z.object({ query: z.string() }),
    },
  )

  const webFetch = tool(
    async ({ url }) => {
      try {
        const policyCheck = networkPolicy?.checkUrl(url)
        if (policyCheck && !policyCheck.allowed) {
          return `Error: network policy blocked web_fetch: ${policyCheck.reason ?? 'blocked'}`
        }
        const rateLimitCheck = networkPolicy?.checkRateLimit(sessionId ?? '')
        if (rateLimitCheck && !rateLimitCheck.allowed) {
          return `Error: network policy rate limit exceeded: ${rateLimitCheck.reason ?? 'too many requests'}`
        }
        const err = await validateFetchUrl(url)
        if (err) return err
        const res = await webHttpFetch(url, {
          headers: { 'User-Agent': `hip/${HIP_PRODUCT_VERSION}` },
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) return `Error: fetch failed with status ${res.status}`
        const text = await res.text()
        const cap = Math.min(WEB_OUTPUT_CAP, networkPolicy?.getResponseSizeCap() ?? WEB_OUTPUT_CAP)
        return clipText(text, cap)
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('timeout') || (err as Error).name === 'TimeoutError') {
          return 'Error: fetch timed out after 30s'
        }
        return `Error: fetch failed: ${msg}`
      }
    },
    {
      name: 'web_fetch',
      description:
        'Fetch the content of a URL as text. Returns the response body clipped to 64KB. ' +
        'Useful for reading documentation, articles, or API responses. Has a 30-second timeout.',
      schema: z.object({ url: z.string() }),
    },
  )

  return [webSearch, webFetch]
}
