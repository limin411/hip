// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TurnTimeline } from './TurnTimeline'
import { sampleToolCalls } from '@/lib/__fixtures__/zuolinActivitySample'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key.startsWith('chat.activity.groups.')) return key.split('.').pop()!
        if (key === 'chat.todos.plan') return 'Plan'
        if (key === 'chat.todos.pending') return 'pending'
        if (key === 'chat.todos.in_progress') return 'in_progress'
        if (key === 'chat.todos.completed') return 'completed'
        if (key === 'chat.tool.truncated') return 'truncated'
        if (key === 'chat.tool.showRaw') return 'raw'
        if (key === 'chat.tool.hideRaw') return 'hide'
        if (key === 'artifact.output') return 'output'
        if (key === 'artifact.arguments') return 'args'
        if (key === 'artifact.failed') return 'failed'
        if (key === 'artifact.truncated') return 'truncated'
        if (key === 'chat.tool.error.enotdir') return `enotdir:${params?.path}`
        if (key === 'chat.subagent.noSummary') return 'no summary'
        return key
      },
    }),
  }
})

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))

describe('TurnTimeline', () => {
  beforeEach(() => cleanup())
  afterEach(() => cleanup())

  it('falls back to toolCalls when timeline is empty', () => {
    render(<TurnTimeline toolCalls={sampleToolCalls.slice(0, 3)} />)
    expect(screen.getByTestId('turn-timeline')).toBeInTheDocument()
    // task suppressed; grep should show with pattern
    const rows = screen.getAllByTestId('tool-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.textContent?.includes('zuolin'))).toBe(true)
  })

  it('groups when tool count ≥ 8', () => {
    render(<TurnTimeline toolCalls={sampleToolCalls} />)
    expect(screen.getByTestId('turn-timeline')).toBeInTheDocument()
    const groups = screen.getAllByTestId('tool-call-group')
    expect(groups.length).toBeGreaterThan(0)
  })
})
