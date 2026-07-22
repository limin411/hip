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

  it('groups tools into category chapters at/above threshold', () => {
    render(<TurnTimeline toolCalls={sampleToolCalls} />)
    expect(screen.getByTestId('turn-timeline')).toBeInTheDocument()
    const groups = screen.getAllByTestId('tool-call-group')
    expect(groups.length).toBeGreaterThan(0)
  })

  it('renders per-agent sections in start order for multi-agent turns', () => {
    render(
      <TurnTimeline
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: 'summary',
            startedAt: 1000,
            finishedAt: 5000,
            seq: 0,
          },
          {
            agentId: 'subagent-1',
            role: 'subagent',
            output: 'a',
            startedAt: 1100,
            finishedAt: 2000,
            seq: 1,
            taskInput: 'check module A',
            parentAgentId: 'supervisor',
          },
          {
            agentId: 'subagent-2',
            role: 'subagent',
            output: 'b',
            startedAt: 1200,
            finishedAt: 3000,
            seq: 2,
            taskInput: 'check module B',
            parentAgentId: 'supervisor',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'subagent-1',
            name: 'grep',
            input: '{"pattern":"A"}',
            status: 'finished',
            seq: 2,
            output: 'hitA',
          },
          {
            callId: 'c2',
            agentId: 'subagent-2',
            name: 'grep',
            input: '{"pattern":"B"}',
            status: 'finished',
            seq: 3,
            output: 'hitB',
          },
        ]}
      />,
    )
    const sections = screen.getAllByTestId('agent-timeline-section')
    expect(sections.length).toBeGreaterThanOrEqual(2)
    const ids = sections.map((s) => s.getAttribute('data-agent-id'))
    expect(ids).toContain('subagent-1')
    expect(ids).toContain('subagent-2')
    // tools stay under their agent section
    const s1 = sections.find((s) => s.getAttribute('data-agent-id') === 'subagent-1')!
    const s2 = sections.find((s) => s.getAttribute('data-agent-id') === 'subagent-2')!
    expect(s1.textContent).toMatch(/A|hitA|grep/)
    expect(s2.textContent).toMatch(/B|hitB|grep/)
  })

  it('applies role-colored left rails on all multi-agent sections including supervisor', () => {
    render(
      <TurnTimeline
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: 'summary',
            startedAt: 1000,
            finishedAt: 5000,
            seq: 0,
          },
          {
            agentId: 'subagent-1',
            role: 'subagent',
            output: 'a',
            startedAt: 1100,
            finishedAt: 2000,
            seq: 1,
            taskInput: 'check module A',
            parentAgentId: 'supervisor',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'subagent-1',
            name: 'grep',
            input: '{"pattern":"A"}',
            status: 'finished',
            seq: 2,
            output: 'hitA',
          },
        ]}
      />,
    )
    const sections = screen.getAllByTestId('agent-timeline-section')
    expect(sections.length).toBeGreaterThanOrEqual(2)
    const supervisor = sections.find((s) => s.getAttribute('data-agent-id') === 'supervisor')!
    const child = sections.find((s) => s.getAttribute('data-agent-id') === 'subagent-1')!
    // Both multi-agent sections get border-l-2 rails colored by ROLE_COLOR
    expect(supervisor.className).toContain('border-l-2')
    expect(child.className).toContain('border-l-2')
    expect(supervisor.style.borderLeftColor).toBe('var(--role-supervisor)')
    // subagent maps to worker color
    expect(child.style.borderLeftColor).toBe('var(--role-worker)')
    // non-supervisor keeps extra top margin; supervisor omits mt-1
    expect(child.className).toContain('mt-1')
    expect(supervisor.className.split(/\s+/)).not.toContain('mt-1')
  })

  it('legacy path skips text steps (no dual render with content body)', () => {
    render(
      <TurnTimeline
        steps={[
          {
            kind: 'text',
            stepSeq: 0,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'Should not appear in timeline',
          },
          {
            kind: 'tool',
            stepSeq: 1,
            agentId: 'supervisor',
            role: 'supervisor',
            callId: 'c1',
          },
          {
            kind: 'text',
            stepSeq: 2,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'Also hidden',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'read_file',
            input: '{"path":"a.ts"}',
            status: 'finished',
            seq: 1,
          },
        ]}
      />,
    )
    expect(screen.queryByTestId('turn-text-block')).not.toBeInTheDocument()
    expect(screen.queryByText('Should not appear in timeline')).not.toBeInTheDocument()
    expect(screen.queryByText('Also hidden')).not.toBeInTheDocument()
    expect(screen.getByTestId('tool-row')).toBeInTheDocument()
  })

  it('interleaved path renders text + tool + reasoning in global stepSeq order', () => {
    render(
      <TurnTimeline
        interleaved
        steps={[
          {
            kind: 'text',
            stepSeq: 0,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'First I will search',
          },
          {
            kind: 'tool',
            stepSeq: 1,
            agentId: 'supervisor',
            role: 'supervisor',
            callId: 'c1',
          },
          {
            kind: 'reasoning',
            stepSeq: 2,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'considering results',
          },
          {
            kind: 'text',
            stepSeq: 3,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'Here is the answer',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'grep',
            input: '{"pattern":"foo"}',
            status: 'finished',
            seq: 1,
            output: 'hit',
          },
        ]}
      />,
    )
    const timeline = screen.getByTestId('turn-timeline')
    expect(timeline.getAttribute('data-interleaved')).toBe('true')
    // No agent-section chrome (KD-9 global list)
    expect(screen.queryByTestId('agent-timeline-section')).not.toBeInTheDocument()

    const textBlocks = screen.getAllByTestId('turn-text-block')
    expect(textBlocks).toHaveLength(2)
    expect(textBlocks[0]).toHaveTextContent('First I will search')
    expect(textBlocks[1]).toHaveTextContent('Here is the answer')
    expect(textBlocks[0].getAttribute('data-step-seq')).toBe('0')
    expect(textBlocks[1].getAttribute('data-step-seq')).toBe('3')

    const tool = screen.getByTestId('turn-tool-block')
    expect(tool.getAttribute('data-step-seq')).toBe('1')
    const thinking = screen.getByTestId('thinking-disclosure')

    // DOM order follows stepSeq: text0 → tool1 → reasoning2 → text3
    const precedes = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(precedes(textBlocks[0], tool)).toBe(true)
    expect(precedes(tool, thinking)).toBe(true)
    expect(precedes(thinking, textBlocks[1])).toBe(true)
  })

  it('interleaved path skips non-supervisor text steps (O1)', () => {
    render(
      <TurnTimeline
        interleaved
        steps={[
          {
            kind: 'text',
            stepSeq: 0,
            agentId: 'worker-1',
            role: 'worker',
            content: 'should not leak',
          },
          {
            kind: 'text',
            stepSeq: 1,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'ok',
          },
        ]}
      />,
    )
    const blocks = screen.getAllByTestId('turn-text-block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveTextContent('ok')
    expect(screen.queryByText('should not leak')).not.toBeInTheDocument()
  })

  it('interleaved path normalizes broken CJK text emission (O2)', () => {
    render(
      <TurnTimeline
        interleaved
        steps={[
          {
            kind: 'text',
            stepSeq: 0,
            agentId: 'supervisor',
            role: 'supervisor',
            content: '让\n我\n先',
          },
        ]}
      />,
    )
    expect(screen.getByTestId('turn-text-block')).toHaveTextContent('让我先')
  })

  it('interleaved path does not supervisor-first re-sort multi-agent tools', () => {
    render(
      <TurnTimeline
        interleaved
        steps={[
          {
            kind: 'tool',
            stepSeq: 1,
            agentId: 'subagent-1',
            role: 'subagent',
            callId: 'c-sub',
          },
          {
            kind: 'tool',
            stepSeq: 2,
            agentId: 'supervisor',
            role: 'supervisor',
            callId: 'c-sup',
          },
        ]}
        toolCalls={[
          {
            callId: 'c-sub',
            agentId: 'subagent-1',
            name: 'grep',
            input: '{"pattern":"A"}',
            status: 'finished',
            seq: 1,
          },
          {
            callId: 'c-sup',
            agentId: 'supervisor',
            name: 'read_file',
            input: '{"path":"b.ts"}',
            status: 'finished',
            seq: 2,
          },
        ]}
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: '',
            startedAt: 1000,
            finishedAt: 5000,
            seq: 0,
          },
          {
            agentId: 'subagent-1',
            role: 'subagent',
            output: 'a',
            startedAt: 1100,
            finishedAt: 2000,
            seq: 1,
            taskInput: 'search A',
            parentAgentId: 'supervisor',
          },
        ]}
      />,
    )
    expect(screen.queryByTestId('agent-timeline-section')).not.toBeInTheDocument()
    const tools = screen.getAllByTestId('turn-tool-block')
    expect(tools[0].getAttribute('data-step-seq')).toBe('1')
    expect(tools[1].getAttribute('data-step-seq')).toBe('2')
  })
})
