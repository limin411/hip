// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ToolCall } from '@hip/protocol'
import { ToolCallGroup } from './ToolCallGroup'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('./ToolCallRow', () => ({
  ToolCallRow: ({ tool }: { tool: ToolCall }) => (
    <div data-testid="tool-row">{tool.name}</div>
  ),
}))

const finished = (i: number, name = 'grep'): ToolCall => ({
  callId: `c${i}`,
  agentId: 'supervisor',
  name,
  input: '{}',
  status: 'finished',
  seq: i,
})

describe('ToolCallGroup', () => {
  beforeEach(() => cleanup())

  it('starts collapsed when all tools finished', () => {
    render(
      <ToolCallGroup
        category="search"
        tools={[finished(1), finished(2), finished(3)]}
      />,
    )
    expect(screen.getByTestId('tool-call-group')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('tool-row')).not.toBeInTheDocument()
  })

  it('expands on header click', () => {
    render(
      <ToolCallGroup
        category="search"
        tools={[finished(1), finished(2)]}
      />,
    )
    fireEvent.click(screen.getByTestId('tool-call-group-header'))
    expect(screen.getByTestId('tool-call-group')).toHaveAttribute('data-open', 'true')
    expect(screen.getAllByTestId('tool-row')).toHaveLength(2)
  })

  it('stays open while a tool is running until user collapses', () => {
    const tools: ToolCall[] = [
      finished(1),
      { ...finished(2), status: 'running' },
    ]
    render(<ToolCallGroup category="edit" tools={tools} />)
    expect(screen.getByTestId('tool-call-group')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('tool-call-group-running')).toBeInTheDocument()
    expect(screen.getAllByTestId('tool-row')).toHaveLength(2)

    // Collapse must work mid-run (was forced open via anyRunning before).
    fireEvent.click(screen.getByTestId('tool-call-group-header'))
    expect(screen.getByTestId('tool-call-group')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('tool-row')).not.toBeInTheDocument()
    // Running badge still visible on the header
    expect(screen.getByTestId('tool-call-group-running')).toBeInTheDocument()
  })
})
