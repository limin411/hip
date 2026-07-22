import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { NetworkPolicy } from '../network-policy.js'
import { HIP_PRODUCT_VERSION } from '../product/content.js'
import { clipText, validateFetchUrl, WEB_OUTPUT_CAP } from './helpers.js'

// ── Exa MCP client (free tier, no API key required) ─────────────────────────
//
// Exa hosts a public MCP server at https://mcp.exa.ai/mcp that provides
// web_search_exa with a free tier. No API key is needed for basic use.
// Set HIP_EXA_API_KEY for higher rate limits (sent as x-api-key header).
//
// Protocol: JSON-RPC 2.0 over HTTP POST (Streamable HTTP transport).
// Session lifecycle: initialize → notifications/initialized → tools/call.

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp'

interface ExaSession {
  sessionId: string
}

let exaSession: ExaSession | null = null
let exaInitPromise: Promise<ExaSession> | null = null

async function ensureExaSession(): Promise<ExaSession> {
  if (exaSession) return exaSession
  if (!exaInitPromise) {
    exaInitPromise = (async () => {
      const res = await globalThis.fetch(EXA_MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        throw new Error(`Exa init failed: HTTP ${res.status}`)
      }
      const sid = res.headers.get('Mcp-Session-Id') ?? ''
      exaSession = { sessionId: sid }
      // Send initialized notification (fire-and-forget — failures are non-fatal)
      globalThis.fetch(EXA_MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sid,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }).catch(() => {})
      return exaSession
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Mcp-Session-Id': sessionId,
  }
  if (apiKey) headers['x-api-key'] = apiKey

  const res = await globalThis.fetch(EXA_MCP_URL, {
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
    if (res.status === 400 || res.status === 404) invalidateExaSession()
    throw new Error(`Exa returned HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    error?: { message: string }
    result?: { content?: Array<{ type: string; text: string }> }
  }
  if (data.error) throw new Error(data.error.message)
  const text = data.result?.content?.[0]?.text
  if (!text) throw new Error('Exa returned empty result')
  return text
}

// ── DuckDuckGo Instant Answer (free, no key, fallback only) ─────────────────
//
// The Instant Answer API returns topic summaries, definitions, and
// disambiguation — NOT full web search results. Used only as a fallback
// when Exa MCP is unavailable.

const DDG_API = 'https://api.duckduckgo.com'

async function ddgInstantAnswer(query: string): Promise<string> {
  const url = `${DDG_API}/?q=${encodeURIComponent(query)}&format=json&no_html=1`
  const res = await globalThis.fetch(url)
  if (!res.ok) throw new Error(`DDG returned HTTP ${res.status}`)
  return res.text()
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
      } catch (_exaErr) {
        // Fallback: DuckDuckGo Instant Answer — free, no key, limited to topic summaries
        try {
          const result = await ddgInstantAnswer(query)
          return clipText(result, cap)
        } catch (_ddgErr) {
          return `Error: web search failed — ${(_exaErr as Error).message}`
        }
      }
    },
    {
      name: 'web_search',
      description:
        'Search the web for the given query and return results as text. ' +
        'Uses Exa search engine (free tier, no API key required). ' +
        'Falls back to DuckDuckGo Instant Answer if Exa is unavailable. ' +
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
        const res = await globalThis.fetch(url, {
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
