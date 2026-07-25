import { describe, it, expect } from 'vitest'
import type { Message, ToolCall } from '@hip/protocol'
import {
  parseExaStyleSources,
  parseDdgSources,
  parseBareUrlSources,
  parseJsonResultSources,
  parseMarkdownLinkSources,
  extractSearchSources,
  collectConversationSearchSources,
  lastTurnHasSearchSources,
  isWebSearchToolName,
  isWebFetchToolName,
  toolLeafName,
} from './searchSources'

function tc(partial: Partial<ToolCall> & Pick<ToolCall, 'name' | 'callId'>): ToolCall {
  return {
    agentId: 'supervisor',
    input: '{}',
    status: 'finished',
    seq: 0,
    ...partial,
  }
}

const EXA_SAMPLE = `Title: React Docs
URL: https://react.dev/learn
Published: 2024-01-01
Author: Meta
Highlights:
Learn React

---

Title: Vue Guide
URL: https://vuejs.org/guide/
Published: N/A
Author: N/A
Text: Introduction to Vue
`

describe('parseExaStyleSources', () => {
  it('parses Title/URL blocks', () => {
    const src = parseExaStyleSources(EXA_SAMPLE, 'c1', 'react vs vue')
    expect(src).toHaveLength(2)
    expect(src[0]).toMatchObject({
      url: 'https://react.dev/learn',
      title: 'React Docs',
      query: 'react vs vue',
      kind: 'search',
      callId: 'c1',
    })
    expect(src[1].url).toBe('https://vuejs.org/guide/')
  })

  it('dedups URLs within one block set', () => {
    const text = `Title: A\nURL: https://a.example/\n\n---\n\nTitle: A2\nURL: https://a.example/`
    expect(parseExaStyleSources(text, 'c').map((s) => s.title)).toEqual(['A'])
  })
})

describe('parseDdgSources', () => {
  it('reads AbstractURL and RelatedTopics', () => {
    const json = JSON.stringify({
      Heading: 'Duck',
      AbstractURL: 'https://en.wikipedia.org/wiki/Duck',
      AbstractText: 'A bird',
      RelatedTopics: [
        { FirstURL: 'https://en.wikipedia.org/wiki/Duckling', Text: 'Duckling' },
        {
          Name: 'See also',
          Topics: [{ FirstURL: 'https://en.wikipedia.org/wiki/Goose', Text: 'Goose' }],
        },
      ],
    })
    const src = parseDdgSources(json, 'c2', 'duck')
    expect(src.map((s) => s.url)).toEqual([
      'https://en.wikipedia.org/wiki/Duck',
      'https://en.wikipedia.org/wiki/Duckling',
      'https://en.wikipedia.org/wiki/Goose',
    ])
    expect(src[0].title).toBe('Duck')
  })

  it('returns empty for non-JSON', () => {
    expect(parseDdgSources('not json', 'c')).toEqual([])
  })
})

describe('parseBareUrlSources', () => {
  it('extracts https URLs and skips API endpoints', () => {
    const text =
      'See https://docs.example.com/a and https://mcp.exa.ai/mcp or https://api.duckduckgo.com/?q=x'
    const src = parseBareUrlSources(text, 'c')
    expect(src.map((s) => s.url)).toEqual(['https://docs.example.com/a'])
  })
})

describe('extractSearchSources', () => {
  it('merges web_search + web_fetch and dedups by URL', () => {
    const calls: ToolCall[] = [
      tc({
        callId: 's1',
        name: 'web_search',
        seq: 0,
        input: JSON.stringify({ query: 'hip app' }),
        output: EXA_SAMPLE,
      }),
      tc({
        callId: 'f1',
        name: 'web_fetch',
        seq: 1,
        input: JSON.stringify({ url: 'https://react.dev/learn' }),
        output: '# React Docs\n\nBody…',
      }),
      tc({
        callId: 'f2',
        name: 'web_fetch',
        seq: 2,
        input: JSON.stringify({ url: 'https://example.com/only-fetch' }),
        output: '<html><title>Only Fetch</title></html>',
      }),
    ]
    const src = extractSearchSources(calls)
    expect(src.map((s) => s.url)).toEqual([
      'https://react.dev/learn',
      'https://vuejs.org/guide/',
      'https://example.com/only-fetch',
    ])
    // First wins: search title kept over fetch.
    expect(src[0].title).toBe('React Docs')
    expect(src[0].kind).toBe('search')
    expect(src[2]).toMatchObject({
      title: 'Only Fetch',
      kind: 'fetch',
    })
  })

  it('skips error outputs', () => {
    expect(
      extractSearchSources([
        tc({
          callId: 'e',
          name: 'web_search',
          status: 'error',
          output: 'Error: blocked',
        }),
        tc({
          callId: 'e2',
          name: 'web_search',
          output: 'Error: network policy blocked web_search',
        }),
      ]),
    ).toEqual([])
  })

  it('returns empty for missing toolCalls', () => {
    expect(extractSearchSources(undefined)).toEqual([])
    expect(extractSearchSources([])).toEqual([])
  })

  it('extracts sources from MCP search tools (JSON results)', () => {
    const src = extractSearchSources([
      tc({
        callId: 'm1',
        name: 'mcp__tavily__tavily_search',
        seq: 0,
        input: JSON.stringify({ query: 'hip agent' }),
        output: JSON.stringify({
          results: [
            { title: 'Tavily Hit', url: 'https://tavily.example/hit' },
            { title: 'Second', link: 'https://tavily.example/2' },
          ],
        }),
      }),
    ])
    expect(src.map((s) => s.url)).toEqual([
      'https://tavily.example/hit',
      'https://tavily.example/2',
    ])
    expect(src[0]).toMatchObject({
      title: 'Tavily Hit',
      query: 'hip agent',
      toolName: 'mcp__tavily__tavily_search',
      kind: 'search',
    })
  })

  it('extracts sources from MCP fetch tools via input url', () => {
    const src = extractSearchSources([
      tc({
        callId: 'f1',
        name: 'mcp__firecrawl__scrape',
        seq: 0,
        input: JSON.stringify({ url: 'https://docs.example.com/page' }),
        output: '# Docs Page\n\nBody',
      }),
    ])
    expect(src).toEqual([
      expect.objectContaining({
        url: 'https://docs.example.com/page',
        title: 'Docs Page',
        kind: 'fetch',
        toolName: 'mcp__firecrawl__scrape',
      }),
    ])
  })

  it('parses markdown links from MCP search text output', () => {
    const src = extractSearchSources([
      tc({
        callId: 'b1',
        name: 'mcp__brave__brave_web_search',
        input: JSON.stringify({ q: 'vue' }),
        output: 'Top results:\n- [Vue](https://vuejs.org/)\n- [Guide](https://vuejs.org/guide/)',
      }),
    ])
    expect(src.map((s) => s.title)).toEqual(['Vue', 'Guide'])
    expect(src[0].query).toBe('vue')
  })

  it('does not mine read_file / grep for incidental https URLs', () => {
    expect(
      extractSearchSources([
        tc({
          callId: 'r1',
          name: 'read_file',
          input: JSON.stringify({ path: '/README.md' }),
          output: 'See https://example.com/docs for more',
        }),
        tc({
          callId: 'g1',
          name: 'grep',
          input: JSON.stringify({ pattern: 'https' }),
          output: 'a.ts:1: const u = "https://internal.example/api"',
        }),
        tc({
          callId: 'm1',
          name: 'mcp__fs__read_file',
          input: '{}',
          output: 'https://should-not-appear.example/',
        }),
      ]),
    ).toEqual([])
  })
})

describe('tool name heuristics', () => {
  it('toolLeafName strips mcp server prefix', () => {
    expect(toolLeafName('mcp__brave__web_search')).toBe('web_search')
    expect(toolLeafName('mcp__test_mcp__search')).toBe('search')
    expect(toolLeafName('web_search')).toBe('web_search')
  })

  it('classifies search / fetch tools', () => {
    expect(isWebSearchToolName('web_search')).toBe(true)
    expect(isWebSearchToolName('mcp__tavily__tavily_search')).toBe(true)
    expect(isWebSearchToolName('mcp__brave__brave_web_search')).toBe(true)
    expect(isWebSearchToolName('mcp__test_mcp__search')).toBe(true)
    expect(isWebSearchToolName('read_file')).toBe(false)
    expect(isWebSearchToolName('mcp__fs__read_file')).toBe(false)

    expect(isWebFetchToolName('web_fetch')).toBe(true)
    expect(isWebFetchToolName('mcp__firecrawl__scrape')).toBe(true)
    expect(isWebFetchToolName('mcp__jina__read_url')).toBe(true)
    expect(isWebFetchToolName('grep')).toBe(false)
  })
})

describe('structured parsers', () => {
  it('parseJsonResultSources walks nested results', () => {
    const src = parseJsonResultSources(
      JSON.stringify({ data: { results: [{ title: 'N', url: 'https://n.example/' }] } }),
      'c',
    )
    expect(src[0]).toMatchObject({ url: 'https://n.example/', title: 'N' })
  })

  it('parseMarkdownLinkSources', () => {
    const src = parseMarkdownLinkSources('[A](https://a.example/) and [B](https://b.example/)', 'c')
    expect(src.map((s) => s.url)).toEqual(['https://a.example/', 'https://b.example/'])
  })
})

describe('collectConversationSearchSources / lastTurnHasSearchSources', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'q1', timestamp: 1 },
    {
      id: 'a1',
      role: 'assistant',
      content: 'ans',
      timestamp: 2,
      toolCalls: [
        tc({
          callId: 's1',
          name: 'web_search',
          output: 'Title: One\nURL: https://one.example/',
        }),
      ],
    },
    { id: 'u2', role: 'user', content: 'q2', timestamp: 3 },
    {
      id: 'a2',
      role: 'assistant',
      content: 'ans2',
      timestamp: 4,
      toolCalls: [
        tc({
          callId: 's2',
          name: 'web_search',
          output: 'Title: Two\nURL: https://two.example/\n\nTitle: One again\nURL: https://one.example/',
        }),
      ],
    },
  ]

  it('collects unique URLs across turns', () => {
    const src = collectConversationSearchSources(messages)
    expect(src.map((s) => s.url)).toEqual([
      'https://one.example/',
      'https://two.example/',
    ])
  })

  it('detects sources on last assistant turn', () => {
    expect(lastTurnHasSearchSources(messages)).toBe(true)
    expect(
      lastTurnHasSearchSources([
        { id: 'u', role: 'user', content: 'x', timestamp: 1 },
        { id: 'a', role: 'assistant', content: 'y', timestamp: 2 },
      ]),
    ).toBe(false)
  })
})
