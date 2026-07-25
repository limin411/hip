// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Message } from '@hip/protocol'

const openMock = vi.fn(async (_url?: string) => {})
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (url: string) => openMock(url),
}))

const messagesState: { messages: Message[] } = { messages: [] }
vi.mock('@/domain', () => ({
  useActiveMessages: () => messagesState.messages,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'artifact.sourcesCount') return `${opts?.count ?? 0} sources`
      if (key === 'artifact.sourcesQuery') return `"${opts?.query ?? ''}"`
      if (key === 'artifact.sourcesEmpty') return 'No web sources yet'
      if (key === 'artifact.sourcesEmptyHint') return 'hint'
      if (key === 'artifact.sources') return 'Sources'
      return key
    },
  }),
}))

import { SearchSourcesPanel } from './SearchSourcesPanel'

describe('SearchSourcesPanel', () => {
  beforeEach(() => {
    messagesState.messages = []
    openMock.mockReset()
  })

  it('shows empty state when no web tools ran', () => {
    render(<SearchSourcesPanel />)
    expect(screen.getByTestId('search-sources-empty')).toBeInTheDocument()
  })

  it('lists sources and opens URL on click', () => {
    messagesState.messages = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'ok',
        timestamp: 1,
        toolCalls: [
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'web_search',
            input: JSON.stringify({ query: 'hip' }),
            status: 'finished',
            seq: 0,
            output: 'Title: Hip Home\nURL: https://example.com/hip',
          },
        ],
      },
    ]
    render(<SearchSourcesPanel />)
    expect(screen.getByTestId('search-sources')).toBeInTheDocument()
    expect(screen.getByText('Hip Home')).toBeInTheDocument()
    const icon = screen.getByTestId('source-favicon')
    expect(icon).toHaveAttribute('src', 'https://example.com/favicon.ico')
    // First candidate fails → cascade to DuckDuckGo icons cache
    fireEvent.error(icon)
    expect(screen.getByTestId('source-favicon')).toHaveAttribute(
      'src',
      'https://icons.duckduckgo.com/ip3/example.com.ico',
    )
    // All candidates fail → Globe fallback
    fireEvent.error(screen.getByTestId('source-favicon'))
    expect(screen.getByTestId('source-favicon-fallback')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('search-source-row'))
    expect(openMock).toHaveBeenCalledWith('https://example.com/hip')
  })
})
