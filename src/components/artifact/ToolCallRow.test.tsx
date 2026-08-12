// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ToolCallRow } from './ToolCallRow'
import { clearContextProviders } from '@/components/context-menu'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'chat.tool.error.enotdir') return `无法将文件当作目录搜索：${params?.path ?? ''}`
        if (key === 'chat.tool.error.enoent') return `路径不存在：${params?.path ?? ''}`
        if (key === 'chat.tool.showRaw') return 'raw'
        if (key === 'chat.tool.hideRaw') return 'hide'
        if (key === 'chat.tool.truncated') return 'truncated'
        if (key === 'chat.tool.rawOutput') return 'raw out'
        if (key === 'chat.tool.rawError') return 'raw err'
        if (key === 'artifact.failed') return 'failed'
        if (key === 'artifact.output') return 'output'
        if (key === 'artifact.arguments') return 'args'
        if (key === 'artifact.truncated') return 'truncated'
        if (key === 'chat.subagent.noSummary') return 'no summary'
        return key
      },
    }),
  }
})

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))

describe('ToolCallRow', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
  })
  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('shows grep pattern in collapsed title', () => {
    render(
      <ToolCallRow
        tool={{
          callId: '1',
          agentId: 'a',
          name: 'grep',
          input: JSON.stringify({ pattern: 'zuolin' }),
          status: 'finished',
          seq: 1,
          output: 'hit',
        }}
      />,
    )
    expect(screen.getByTestId('tool-row')).toHaveTextContent('zuolin')
  })

  it('starts collapsed for running tools and edit diffs', () => {
    const { rerender } = render(
      <ToolCallRow
        tool={{
          callId: '1',
          agentId: 'a',
          name: 'read_file',
          input: JSON.stringify({ path: 'a.ts' }),
          status: 'running',
          seq: 1,
        }}
      />,
    )
    expect(screen.getByTestId('tool-card-running')).toHaveAttribute('aria-expanded', 'false')
    // clip-expand keeps the view mounted but collapsed (grid-rows 0fr + opacity 0)
    expect(screen.getByTestId('tool-result-view').closest('.clip-expand')).not.toHaveClass('is-open')

    rerender(
      <ToolCallRow
        tool={{
          callId: '2',
          agentId: 'a',
          name: 'edit_file',
          input: JSON.stringify({ path: 'a.ts' }),
          status: 'finished',
          seq: 1,
          output: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE',
        }}
      />,
    )
    expect(screen.getByTestId('tool-row')).toHaveAttribute('aria-expanded', 'false')
    // collapsed: view stays mounted inside the hidden clip (grid-rows 0fr + opacity 0)
    expect(screen.getByTestId('tool-result-view').closest('.clip-expand')).not.toHaveClass('is-open')
  })

  it('sanitizes DSML from expanded output', () => {
    const dirty =
      'Hello<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="x">\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>'
    render(
      <ToolCallRow
        tool={{
          callId: '1',
          agentId: 'a',
          name: 'task',
          input: JSON.stringify({ description: 'Find stuff' }),
          status: 'finished',
          seq: 1,
          output: dirty,
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('tool-row'))
    const body = screen.getByTestId('tool-structured-md')
    expect(body.textContent).not.toMatch(/DSML/i)
    expect(body.textContent).toContain('Hello')
  })

  it('shows human ENOTDIR on error expand', () => {
    render(
      <ToolCallRow
        tool={{
          callId: '1',
          agentId: 'a',
          name: 'grep',
          input: JSON.stringify({ path: 'DataSyncServiceImpl.java', pattern: 'x' }),
          status: 'error',
          error: "ENOTDIR: not a directory, scandir 'D:\\\\proj\\\\DataSyncServiceImpl.java'",
          seq: 1,
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('tool-row'))
    expect(screen.getByText(/无法将文件当作目录搜索/)).toBeInTheDocument()
  })
})
