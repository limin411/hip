import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolCallRow } from './ToolCallRow'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

const baseTool = {
  callId: 'c1',
  agentId: 'a1',
  name: 'read_file',
  input: '{"path":"src/main.ts"}',
  output: '{"content":"hello"}',
  status: 'finished' as const,
  seq: 1,
}

describe('ToolCallRow', () => {
  it('renders collapsed summary by default', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={baseTool} />)
    expect(html).toContain('data-testid="tool-row"')
    expect(html).toContain('read_file')
    expect(html).toContain('src/main.ts')
    expect(html).toContain('aria-expanded="false"')
  })

  it('uses CheckCircle2 for finished status', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={baseTool} />)
    expect(html).toContain('lucide-circle-check')
  })

  it('uses XCircle for error status', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={{ ...baseTool, status: 'error', error: 'oops' }} />)
    expect(html).toContain('lucide-circle-x')
  })

  it('wraps row with toolCall context menu host', () => {
    const html = renderToStaticMarkup(<ToolCallRow tool={baseTool} />)
    expect(html).toContain('data-context-menu-kind="toolCall"')
    expect(html).toContain('data-context-menu-root')
  })
})
