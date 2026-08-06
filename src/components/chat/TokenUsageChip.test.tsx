// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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
  extra?: Partial<Message>,
): Message {
  return { id, role, content: 'x', timestamp: 1, ...(usage ? { usage } : {}), ...extra }
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

function seedSessionWithUsage() {
  useDomainStore.setState({
    activeSessionId: 's1',
    sessions: [
      session('s1', [
        msg('u1', undefined, 'user', { content: 'hello world' }),
        msg('a1', { inputTokens: 64_000, outputTokens: 200, totalTokens: 64_200 }, 'assistant', {
          content: 'reply',
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'supervisor',
              name: 'use_skill',
              input: JSON.stringify({ name: 'fmt' }),
              output: 'skill body here'.repeat(20),
              status: 'finished',
              seq: 0,
            },
          ],
        }),
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
    vi.useFakeTimers()
    useDomainStore.setState({ sessions: [], activeSessionId: null } as never)
    providersStore.useProvidersStore.setState({
      catalog: {},
      config: { providers: {} },
      keyConfigured: {},
      loaded: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing without session usage', () => {
    const { container } = render(<TokenUsageChip />)
    expect(container.querySelector('[data-testid="session-usage"]')).toBeNull()
  })

  it('shows context fill percent with zone when catalog has window', () => {
    seedSessionWithUsage()
    render(<TokenUsageChip />)
    const el = screen.getByTestId('session-usage')
    // last total 64200 / 128000 ≈ 50%
    expect(el).toHaveTextContent('50%')
    expect(el).toHaveAttribute('data-zone', 'warning')
  })

  it('opens breakdown popover on hover', () => {
    seedSessionWithUsage()
    render(<TokenUsageChip />)
    const chip = screen.getByTestId('session-usage')
    fireEvent.mouseEnter(chip)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByTestId('session-usage-popover')).toBeInTheDocument()
    expect(screen.getByTestId('session-usage-breakdown')).toBeInTheDocument()
    // skills segment from use_skill tool
    expect(screen.getByTestId('session-usage-seg-skills')).toBeInTheDocument()
    expect(screen.getByTestId('session-usage-seg-other')).toBeInTheDocument()
  })

  it('keeps breakdown note on estimated tooltip, not in panel body', () => {
    seedSessionWithUsage()
    render(<TokenUsageChip />)
    fireEvent.mouseEnter(screen.getByTestId('session-usage'))
    act(() => {
      vi.advanceTimersByTime(250)
    })
    const est = screen.getByTestId('session-usage-estimated')
    const note = est.getAttribute('title') ?? ''
    expect(note.length).toBeGreaterThan(20)
    // Full methodology must not appear as visible body text.
    expect(screen.queryByText(note)).not.toBeInTheDocument()
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
    // Context fill uses input/contextTokens, not billing total
    expect(screen.getByTestId('session-usage')).toHaveTextContent('1.2k')
  })

  it('shows incomplete cost with * and tooltip (KD-15)', () => {
    useDomainStore.setState({
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg(
            'a1',
            {
              inputTokens: 1_000_000,
              outputTokens: 0,
              totalTokens: 1_000_000,
              incomplete: true,
              modelId: 'deepseek-chat',
              providerId: 'deepseek',
            } as never,
          ),
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
    fireEvent.mouseEnter(screen.getByTestId('session-usage'))
    act(() => {
      vi.advanceTimersByTime(250)
    })
    const costEl = screen.getByTestId('session-usage-cost')
    expect(costEl.textContent).toMatch(/\*/)
    expect(costEl.getAttribute('title') ?? '').toMatch(/incomplete|lower/i)
  })

  it('shows cache hit rate only in popover, not on primary chip (KD-21)', () => {
    useDomainStore.setState({
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg(
            'a1',
            {
              inputTokens: 1000,
              outputTokens: 10,
              totalTokens: 1010,
              nonCachedInputTokens: 200,
              cacheReadTokens: 700,
              cacheWriteTokens: 100,
              modelId: 'deepseek-chat',
              providerId: 'deepseek',
            } as never,
          ),
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
    const chip = screen.getByTestId('session-usage')
    // Primary surface is fill % only — no cache hit % text.
    expect(chip.textContent).not.toMatch(/70%/)
    expect(screen.queryByTestId('session-usage-cache-hit')).not.toBeInTheDocument()

    fireEvent.mouseEnter(chip)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByTestId('session-usage-cache-hit')).toBeInTheDocument()
    expect(screen.getByTestId('session-usage-cache-hit').textContent).toMatch(/70%/)
  })

  it('does not stick at 0% when provider reports output-only usage (MiniMax)', () => {
    const long = 'context blob '.repeat(2000) // ~26k chars → ~6.5k tokens
    useDomainStore.setState({
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('u1', undefined, 'user', { content: long }),
          msg('a1', { inputTokens: 0, outputTokens: 65, totalTokens: 65 }, 'assistant', {
            content: long,
            usage: { inputTokens: 0, outputTokens: 65, totalTokens: 65, contextTokens: 65 },
          }),
        ]),
      ],
    } as never)
    providersStore.useProvidersStore.setState({
      catalog: {
        'minimax-cn-coding-plan': {
          id: 'minimax-cn-coding-plan',
          name: 'MiniMax',
          env: [],
          models: {
            'MiniMax-M3': {
              id: 'MiniMax-M3',
              name: 'MiniMax-M3',
              limit: { context: 1_000_000, output: 128_000 },
            },
          },
        },
      },
      config: {
        providers: {},
        activeModel: { providerID: 'minimax-cn-coding-plan', modelID: 'MiniMax-M3' },
      },
      keyConfigured: {},
      loaded: true,
    })
    // Session model must match catalog for window lookup
    useDomainStore.setState((s) => ({
      ...s,
      sessions: s.sessions.map((sess) =>
        sess.id === 's1'
          ? {
              ...sess,
              config: {
                ...sess.config,
                llmProvider: 'minimax-cn-coding-plan',
                model: 'MiniMax-M3',
              },
            }
          : sess,
      ),
    }))

    render(<TokenUsageChip />)
    const el = screen.getByTestId('session-usage')
    // Must not show 0% (65 / 1M rounds to 0); estimate of long transcript is >> 0
    expect(el.textContent).not.toBe('0%')
    const pct = Number(el.textContent?.replace('%', ''))
    expect(pct).toBeGreaterThan(0)
  })
})
