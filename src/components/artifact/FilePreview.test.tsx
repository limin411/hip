// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FilePreview } from './FilePreview'
import { useFsStore } from '@/store/fsStore'

vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => ({ scopeId: 's1', cwd: '/tmp', isDraft: false, chatDraft: false }),
}))

describe('FilePreview', () => {
  beforeEach(() => {
    cleanup()
    useFsStore.setState({ bySession: {} } as any)
  })

  function setPreview(state: any) {
    useFsStore.setState({ bySession: { s1: { preview: state } } } as any)
  }

  it('shows empty state when no file is selected', () => {
    render(<FilePreview />)
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    setPreview({ status: 'loading' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-loading')).toBeInTheDocument()
  })

  it('shows error state', () => {
    setPreview({ status: 'error', error: 'too_large' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-error')).toBeInTheDocument()
  })

  it('renders markdown preview', () => {
    setPreview({ status: 'ready', path: 'README.md', content: '# Hello', mimeType: 'text/markdown', encoding: 'utf8' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-markdown')).toHaveTextContent('Hello')
  })

  it('renders text preview', () => {
    setPreview({ status: 'ready', path: 'a.ts', content: 'export const a = 1', mimeType: 'text/plain', encoding: 'utf8' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-text')).toHaveTextContent('export const a = 1')
  })

  it('renders html preview in sandboxed iframe', () => {
    setPreview({ status: 'ready', path: 'index.html', content: '<p>hi</p>', mimeType: 'text/html', encoding: 'utf8' })
    render(<FilePreview />)
    const frame = screen.getByTestId('preview-html')
    expect(frame).toHaveAttribute('sandbox', '')
  })
})
