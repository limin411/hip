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
