import type { Message, ToolCall } from '@hip/protocol'
import { parseToolInput } from '@/lib/toolPresentation'

/** A web result the agent used this conversation (search hit or fetched URL). */
export interface SearchSource {
  url: string
  title: string
  /** Search query when available from tool input. */
  query?: string
  kind: 'search' | 'fetch'
  callId: string
  /** Tool name that produced this source (builtin or mcp__server__tool). */
  toolName?: string
}

const TITLE_URL_BLOCK_RE = /Title:\s*(.+?)\s*\nURL:\s*(\S+)/gi

/** Markdown links: [title](https://…) */
const MD_LINK_RE = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/gi

/** Loose https URL matcher (no trailing punctuation). */
const BARE_URL_RE = /https:\/\/[^\s<>"'`)\]}]+/gi

/** Built-in filesystem / shell tools — never mined for web sources (noise). */
const NON_WEB_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'read_media',
  'ls',
  'glob',
  'grep',
  'run_script',
  'write_todos',
  'task',
  'dispatch_agent',
  'task_retry',
  'task_stop',
  'task_output',
  'task_batch',
  'use_skill',
  'enter_plan_mode',
  'exit_plan_mode',
  'generate_agent',
  'mcp_search',
  'git_status',
  'git_diff',
  'git_log',
  'git_show',
  'git_add',
  'git_commit',
  'git_branch',
  'git_checkout',
  'git_stash',
  'install_plugin',
  'uninstall_plugin',
])

/** Leaf tool id: `mcp__brave__web_search` → `web_search`; otherwise the name itself. */
export function toolLeafName(name: string): string {
  // Format is mcp__<serverId>__<tool>; serverId may contain `_` but not `__`.
  if (name.startsWith('mcp__')) {
    const idx = name.indexOf('__', 5)
    if (idx >= 0 && idx + 2 < name.length) return name.slice(idx + 2)
  }
  return name
}

function stripTrailingPunct(url: string): string {
  return url.replace(/[),.;:!?]+$/g, '')
}

function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isErrorOutput(output: string | undefined): boolean {
  if (!output) return true
  const t = output.trim()
  return t.startsWith('Error:') || t.startsWith('error:')
}

/** Skip non-content API / MCP control endpoints that show up in errors. */
function isNoiseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'api.duckduckgo.com' || host === 'mcp.exa.ai') return true
    if (host.endsWith('.exa.ai') && host.startsWith('mcp.')) return true
  } catch {
    return true
  }
  return false
}

function queryFromInput(args: Record<string, unknown>): string | undefined {
  for (const key of ['query', 'q', 'search', 'search_term', 'searchTerm', 'keywords', 'prompt']) {
    const v = asString(args[key]).trim()
    if (v) return v
  }
  return undefined
}

function urlFromInput(args: Record<string, unknown>): string | undefined {
  for (const key of ['url', 'uri', 'link', 'href', 'page_url', 'pageUrl', 'target']) {
    const v = stripTrailingPunct(asString(args[key]).trim())
    if (v.startsWith('https://')) return v
  }
  return undefined
}

/**
 * Heuristic: tool looks like a web search (builtin, MCP, or third-party name).
 * Conservative — avoids mining read_file/grep/etc. for incidental URLs.
 */
export function isWebSearchToolName(name: string): boolean {
  if (name === 'web_search') return true
  if (NON_WEB_TOOLS.has(name)) return false
  const leaf = toolLeafName(name).toLowerCase()
  const full = name.toLowerCase()
  // Explicit search engines / products in the leaf or full name.
  if (
    /(^|_)(web_?search|search_?web|websearch|tavily|brave_?search|serp|perplexity|bing_?search|google_?search|duckduck|ddg_?search|exa)(_|$)/i.test(
      leaf,
    )
  ) {
    return true
  }
  // Generic *search* leaf, but not code-search helpers (grep is already excluded).
  if (/search/.test(leaf) && !/file_?search|code_?search|symbol_?search|workspace_?search/.test(leaf)) {
    return true
  }
  // MCP tools often encode intent in the server id: mcp__tavily__*, mcp__brave__*
  if (name.startsWith('mcp__') && /mcp__(tavily|brave|exa|serp|bing|perplexity|firecrawl|jina)__/i.test(full)) {
    // Firecrawl/jina can be fetch-oriented; still treat as research if leaf says search.
    if (/search|query|find|web/.test(leaf)) return true
    if (/tavily|brave|serp|bing|perplexity|exa/.test(full)) return true
  }
  return false
}

/** Heuristic: tool looks like a page fetch / crawl. */
export function isWebFetchToolName(name: string): boolean {
  if (name === 'web_fetch') return true
  if (NON_WEB_TOOLS.has(name)) return false
  const leaf = toolLeafName(name).toLowerCase()
  if (
    /^(web_)?fetch(_url|_page)?$|^fetch_(url|page|webpage)$|^get_(url|page)$|^read_url$|^browse(_page|_url)?$|^crawl|^scrape|^web_scrape/i.test(
      leaf,
    )
  ) {
    return true
  }
  if (/(fetch|crawl|scrape|browse).*(url|page|web|site|html)|(url|page|web|site).*(fetch|crawl|scrape|browse)/i.test(leaf)) {
    return true
  }
  // firecrawl / jina reader style MCP servers
  if (name.startsWith('mcp__') && /mcp__(firecrawl|jina|browserbase|playwright|puppeteer)__/i.test(name)) {
    return !/search/.test(leaf) // search leaf → search tool
  }
  return false
}

/** Parse Exa-style "Title: …\nURL: …" blocks from tool output text. */
export function parseExaStyleSources(
  output: string,
  callId: string,
  query?: string,
  toolName?: string,
): SearchSource[] {
  const out: SearchSource[] = []
  const seen = new Set<string>()
  TITLE_URL_BLOCK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TITLE_URL_BLOCK_RE.exec(output)) !== null) {
    const title = m[1].trim()
    const url = stripTrailingPunct(m[2].trim())
    if (!url.startsWith('https://') || isNoiseUrl(url) || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      title: title && title !== 'N/A' ? title : hostnameTitle(url),
      query,
      kind: 'search',
      callId,
      toolName,
    })
  }
  return out
}

/** Parse DuckDuckGo Instant Answer JSON when Exa falls back. */
export function parseDdgSources(
  output: string,
  callId: string,
  query?: string,
  toolName?: string,
): SearchSource[] {
  const trimmed = output.trim()
  if (!trimmed.startsWith('{')) return []
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const o = data as Record<string, unknown>
  const out: SearchSource[] = []
  const seen = new Set<string>()

  const push = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return
    const clean = stripTrailingPunct(url)
    if (isNoiseUrl(clean) || seen.has(clean)) return
    seen.add(clean)
    const t = typeof title === 'string' && title.trim() ? title.trim() : hostnameTitle(clean)
    out.push({ url: clean, title: t, query, kind: 'search', callId, toolName })
  }

  push(o.AbstractURL, o.Heading ?? o.AbstractText)
  const related = o.RelatedTopics
  if (Array.isArray(related)) {
    for (const item of related) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      push(r.FirstURL, r.Text)
      if (Array.isArray(r.Topics)) {
        for (const sub of r.Topics) {
          if (!sub || typeof sub !== 'object') continue
          const s = sub as Record<string, unknown>
          push(s.FirstURL, s.Text)
        }
      }
    }
  }
  const results = o.Results
  if (Array.isArray(results)) {
    for (const item of results) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      push(r.FirstURL, r.Text)
    }
  }
  return out
}

/**
 * Common MCP / API shapes:
 * - `{ results: [{ url|link|href, title|name|text }] }`
 * - `[{ url, title }]`
 * - `{ data: { results: [...] } }` / `{ organic: [...] }`
 */
export function parseJsonResultSources(
  output: string,
  callId: string,
  query?: string,
  toolName?: string,
): SearchSource[] {
  const trimmed = output.trim()
  // Allow fenced JSON: ```json … ```
  const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)```\s*$/i.exec(trimmed)
  const raw = fence ? fence[1].trim() : trimmed
  if (!(raw.startsWith('{') || raw.startsWith('['))) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }

  const out: SearchSource[] = []
  const seen = new Set<string>()

  const pushObj = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const o = item as Record<string, unknown>
    const urlRaw =
      asString(o.url) ||
      asString(o.link) ||
      asString(o.href) ||
      asString(o.uri) ||
      asString(o.pageUrl) ||
      asString(o.page_url)
    const url = stripTrailingPunct(urlRaw.trim())
    if (!url.startsWith('https://') || isNoiseUrl(url) || seen.has(url)) return
    seen.add(url)
    const title =
      asString(o.title).trim() ||
      asString(o.name).trim() ||
      asString(o.text).trim().slice(0, 120) ||
      asString(o.snippet).trim().slice(0, 120) ||
      hostnameTitle(url)
    out.push({ url, title, query, kind: 'search', callId, toolName })
  }

  const walk = (node: unknown, depth: number) => {
    if (depth > 4 || node == null) return
    if (Array.isArray(node)) {
      for (const item of node) {
        // Array of result objects
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const o = item as Record<string, unknown>
          if (o.url || o.link || o.href || o.uri) pushObj(item)
          else walk(item, depth + 1)
        }
      }
      return
    }
    if (typeof node !== 'object') return
    const o = node as Record<string, unknown>
    // Direct result object
    if (o.url || o.link || o.href) pushObj(o)
    for (const key of ['results', 'organic', 'items', 'data', 'sources', 'hits', 'documents', 'web']) {
      if (key in o) walk(o[key], depth + 1)
    }
  }

  walk(data, 0)
  return out
}

/** Markdown [title](url) pairs — common in Tavily / MCP text summaries. */
export function parseMarkdownLinkSources(
  output: string,
  callId: string,
  query?: string,
  toolName?: string,
): SearchSource[] {
  const out: SearchSource[] = []
  const seen = new Set<string>()
  MD_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MD_LINK_RE.exec(output)) !== null) {
    const title = m[1].trim()
    const url = stripTrailingPunct(m[2].trim())
    if (!url.startsWith('https://') || isNoiseUrl(url) || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      title: title || hostnameTitle(url),
      query,
      kind: 'search',
      callId,
      toolName,
    })
  }
  return out
}

/** Last-resort: bare https URLs in free-form tool output. */
export function parseBareUrlSources(
  output: string,
  callId: string,
  query?: string,
  toolName?: string,
): SearchSource[] {
  const out: SearchSource[] = []
  const seen = new Set<string>()
  BARE_URL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = BARE_URL_RE.exec(output)) !== null) {
    const url = stripTrailingPunct(m[0])
    if (isNoiseUrl(url) || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      title: hostnameTitle(url),
      query,
      kind: 'search',
      callId,
      toolName,
    })
  }
  return out
}

/** Best-effort parse of a search-like tool's text/JSON output. */
export function parseSearchToolOutput(
  output: string,
  callId: string,
  query?: string,
  toolName?: string,
): SearchSource[] {
  const exa = parseExaStyleSources(output, callId, query, toolName)
  if (exa.length > 0) return exa
  const json = parseJsonResultSources(output, callId, query, toolName)
  if (json.length > 0) return json
  const ddg = parseDdgSources(output, callId, query, toolName)
  if (ddg.length > 0) return ddg
  const md = parseMarkdownLinkSources(output, callId, query, toolName)
  if (md.length > 0) return md
  return parseBareUrlSources(output, callId, query, toolName)
}

function sourcesFromSearchTool(tc: ToolCall): SearchSource[] {
  if (tc.status === 'error' || isErrorOutput(tc.output)) return []
  const args = parseToolInput(tc.input)
  const query = queryFromInput(args)
  return parseSearchToolOutput(tc.output!, tc.callId, query, tc.name)
}

function sourceFromFetchTool(tc: ToolCall): SearchSource | null {
  if (tc.status === 'error') return null
  const args = parseToolInput(tc.input)
  const url = urlFromInput(args)
  if (!url || isNoiseUrl(url)) return null
  let title = hostnameTitle(url)
  const out = tc.output?.trim()
  if (out && !isErrorOutput(out)) {
    const md = /^#\s+(.+)$/m.exec(out)
    const html = /<title[^>]*>([^<]+)<\/title>/i.exec(out)
    const candidate = (md?.[1] ?? html?.[1] ?? '').replace(/\s+/g, ' ').trim()
    if (candidate && candidate.length <= 120) title = candidate
  }
  return { url, title, kind: 'fetch', callId: tc.callId, toolName: tc.name }
}

/**
 * Extract unique web sources from one turn's tool calls.
 * Includes builtin web_search/web_fetch and external MCP / third-party tools
 * whose names look like web search or fetch. Dedups by URL (first wins). Never throws.
 */
export function extractSearchSources(toolCalls?: ToolCall[]): SearchSource[] {
  if (!toolCalls || toolCalls.length === 0) return []
  const byUrl = new Map<string, SearchSource>()
  const ordered = [...toolCalls].sort((a, b) => a.seq - b.seq)
  for (const tc of ordered) {
    if (isWebSearchToolName(tc.name)) {
      for (const s of sourcesFromSearchTool(tc)) {
        if (!byUrl.has(s.url)) byUrl.set(s.url, s)
      }
      continue
    }
    if (isWebFetchToolName(tc.name)) {
      const s = sourceFromFetchTool(tc)
      if (s && !byUrl.has(s.url)) byUrl.set(s.url, s)
      // Some fetch tools also echo related links in body — only if input URL missing.
      if (!s && tc.output && !isErrorOutput(tc.output)) {
        for (const x of parseSearchToolOutput(tc.output, tc.callId, undefined, tc.name)) {
          if (!byUrl.has(x.url)) byUrl.set(x.url, { ...x, kind: 'fetch' })
        }
      }
    }
  }
  return [...byUrl.values()]
}

/**
 * Sources across the conversation (all assistant turns). Dedups by URL;
 * earlier turn wins. Never throws.
 */
export function collectConversationSearchSources(
  messages: readonly Message[],
): SearchSource[] {
  const byUrl = new Map<string, SearchSource>()
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue
    for (const s of extractSearchSources(m.toolCalls)) {
      if (!byUrl.has(s.url)) byUrl.set(s.url, s)
    }
  }
  return [...byUrl.values()]
}

/** True when the latest assistant turn produced at least one web source. */
export function lastTurnHasSearchSources(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    return extractSearchSources(m.toolCalls).length > 0
  }
  return false
}
