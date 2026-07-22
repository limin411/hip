// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@/i18n'
import { useDomainStore } from '@/domain/sessionStore'
import * as providersStore from '@/store/providersStore'
import { TokenUsageChip, tokenUsageZoneClass } from './TokenUsageChip'
import type { Message } from '@hip/protocol'
import type { SessionVM } from '@/domain/sessionStore'

function msg(
  id: string,
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number },
  role: Message['role'] = 'assistant',
): Message {
  return { id, role, content: 'x', timestamp: 1, ...(usage ? { usage } : {}) }
}

function session(id: string, messages: Message[]): SessionVM {
  return {
    id,
    config: { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
    title: 't',
    preview: 'p',
    updatedAtMs: 1,
    loaded: true,
    messages,
    status: 'idle',
    error: null,
    interrupt: null,
  }
}

describe('tokenUsageZoneClass', () => {
  it('maps success → text-success', () => {
    expect(tokenUsageZoneClass('success')).toBe('text-success')
  })

  it('maps warning → text-warning', () => {
    expect(tokenUsageZoneClass('warning')).toBe('text-warning')
  })

  it('maps danger → text-danger', () => {
    expect(tokenUsageZoneClass('danger')).toBe('text-danger')
  })

  it('maps null → tertiary', () => {
    expect(tokenUsageZoneClass(null)).toBe('text-ink-tertiary')
  })
})

describe('TokenUsageChip', () => {
  beforeEach(() => {
    cleanup()
    useDomainStore.setState({ sessions: [], activeSessionId: null } as never)
    providersStore.useProvidersStore.setState({
      catalog: {},
      config: { providers: {} },
      keyConfigured: {},
      loaded: false,
    })
  })

  it('renders nothing without session usage', () => {
    const { container } = render(<TokenUsageChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows context fill percent with zone when catalog has window', () => {
    useDomainStore.setState({
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('a', { inputTokens: 100_000, outputTokens: 0, totalTokens: 100_000 }),
          msg('b', { inputTokens: 64_000, outputTokens: 0, totalTokens: 64_000 }),
        ]),
      ],
    } as never)
    providersStore.useProvidersStore.setState({
      catalog: {
        deepseek: {
          id: 'deepseek',
          name: 'DeepSeek',
          env: [],
          models: {
            'deepseek-chat': {
              id: 'deepseek-chat',
              name: 'DeepSeek Chat',
              limit: { context: 128_000, output: 8_000 },
              cost: { input: 0.27, output: 1.1 },
            },
          },
        },
      },
      config: { providers: {} },
      keyConfigured: {},
      loaded: true,
    })

    render(<TokenUsageChip />)
    const el = screen.getByTestId('session-usage')
    // last turn 64k / 128k = 50% → warning zone
    expect(el).toHaveTextContent('50%')
    expect(el).toHaveAttribute('data-zone', 'warning')
    expect(el.getAttribute('title')).toMatch(/64/)
    expect(el.getAttribute('title')).toMatch(/Session total|本对话累计|セッション|세션|對話/i)
  })

  it('falls back to compact tokens when context window unknown', () => {
    useDomainStore.setState({
      activeSessionId: 's1',
      sessions: [session('s1', [msg('a', { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 })])],
    } as never)
    providersStore.useProvidersStore.setState({
      catalog: {},
      config: { providers: {} },
      keyConfigured: {},
      loaded: true,
    })

    render(<TokenUsageChip />)
    expect(screen.getByTestId('session-usage')).toHaveTextContent('1.5k')
  })
})
