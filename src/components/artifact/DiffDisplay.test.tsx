// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { DiffFile } from '@hip/protocol'
import { DiffDisplay } from './DiffDisplay'
import { clearContextProviders } from '@/components/context-menu'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

const file: DiffFile = {
  path: 'src/a.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      header: 'function foo',
      lines: [
        { type: 'del', content: 'const x = 1', oldNo: 1, newNo: null },
        { type: 'add', content: 'const x = 2', oldNo: null, newNo: 1 },
      ],
    },
  ],
}

describe('DiffDisplay class polish', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
  })

  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('sticky file header has soft border when expanded', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const header = screen.getByTestId('diff-file-header')
    expect(header).toHaveClass('border-b')
    expect(header.className).toMatch(/border-border/)
  })

  it('drops sticky header border when collapsed to avoid double hairline', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        collapsed={{ [file.path]: true }}
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const header = screen.getByTestId('diff-file-header')
    expect(header).not.toHaveClass('border-b')
    expect(screen.getByTestId('diff-file').className).toMatch(/border-b/)
    expect(screen.getByTestId('diff-file').className).toMatch(/border-border/)
  })

  it('@@ hunk span and header tail stay quiet tertiary', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const atSpan = screen.getByText(/@@ -1,1 \+1,1 @@/)
    expect(atSpan).toHaveClass('text-ink-tertiary')
    const tail = screen.getByText('function foo')
    expect(tail.className).toMatch(/text-ink-tertiary/)
  })

  it('word-diff spans use soft /25 tints', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    // Equal-length del/add pair → word-diff; mid '1' vs '2' is changed.
    const success = document.querySelector('.bg-success\\/25')
    const danger = document.querySelector('.bg-danger\\/25')
    expect(success).toBeTruthy()
    expect(danger).toBeTruthy()
    expect(document.querySelector('.bg-success\\/30')).toBeNull()
    expect(document.querySelector('.bg-danger\\/30')).toBeNull()
  })
})
