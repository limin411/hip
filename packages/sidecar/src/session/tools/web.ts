import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { NetworkPolicy } from '../network-policy.js'
import { clipText, validateFetchUrl, WEB_OUTPUT_CAP } from './helpers.js'

export function buildWebTools(
  networkPolicy: NetworkPolicy | undefined,
  sessionId: string | undefined,
): StructuredToolInterface[] {
  const webSearch = tool(
    async ({ query }) => {
      try {
        const apiKey = process.env.HIP_WEBSEARCH_API_KEY
        if (!apiKey) return 'Error: web search API key not configured'
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
        const policyCheck = networkPolicy?.checkUrl(url)
        if (policyCheck && !policyCheck.allowed) {
          return `Error: network policy blocked web_search: ${policyCheck.reason ?? 'blocked'}`
        }
        const rateLimitCheck = networkPolicy?.checkRateLimit(sessionId ?? '')
        if (rateLimitCheck && !rateLimitCheck.allowed) {
          return `Error: network policy rate limit exceeded: ${rateLimitCheck.reason ?? 'too many requests'}`
        }
        const res = await globalThis.fetch(url, {
          headers: { 'X-Api-Key': apiKey },
        })
        if (!res.ok) return `Error: web search failed with status ${res.status}`
        const text = await res.text()
        const cap = Math.min(WEB_OUTPUT_CAP, networkPolicy?.getResponseSizeCap() ?? WEB_OUTPUT_CAP)
        return clipText(text, cap)
      } catch (err) {
        return `Error: web search failed: ${(err as Error).message}`
      }
    },
    {
      name: 'web_search',
      description:
        'Search the web for the given query and return results as text. ' +
        'Requires HIP_WEBSEARCH_API_KEY environment variable to be set.',
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
          headers: { 'User-Agent': 'hip/0.1.0' },
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
