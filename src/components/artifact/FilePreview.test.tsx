// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { FilePreview } from './FilePreview'
import { useFsStore } from '@/store/fsStore'

vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => ({ scopeId: 's1', cwd: '/tmp', isDraft: false, chatDraft: false }),
}))

vi.mock('@/lib/shikiLazy', () => ({
  highlightCode: vi.fn(async () => '<span class="tok">highlighted</span>'),
}))

const openWithDefaultApp = vi.fn(async (..._args: unknown[]) => true)
vi.mock('@/ipc/openPath', () => ({
  openWithDefaultApp: (...args: unknown[]) => openWithDefaultApp(...args),
}))

describe('FilePreview', () => {
  beforeEach(() => {
    cleanup()
    useFsStore.setState({ bySession: {} } as any)
    openWithDefaultApp.mockClear().mockResolvedValue(true)
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

  it('renders code preview for typescript (highlight path)', async () => {
    setPreview({
      status: 'ready',
      path: 'a.ts',
      content: 'export const a = 1',
      mimeType: 'text/plain',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-code')).toBeInTheDocument()
    // Plain first, then highlighted when shiki resolves.
    await waitFor(() => {
      expect(screen.getByTestId('preview-code-highlighted')).toBeInTheDocument()
    })
  })

  it('renders json tree preview', () => {
    setPreview({
      status: 'ready',
      path: 'pkg.json',
      content: '{"name":"hip","n":1}',
      mimeType: 'application/json',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-json')).toBeInTheDocument()
    expect(screen.getByTestId('preview-json-tree')).toHaveTextContent('name')
    expect(screen.getByTestId('preview-json-tree')).toHaveTextContent('hip')
  })

  it('json invalid falls back to source with error banner', () => {
    setPreview({
      status: 'ready',
      path: 'bad.json',
      content: '{not json',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-json-error')).toBeInTheDocument()
    expect(screen.getByTestId('preview-json-source')).toHaveTextContent('{not json')
  })

  it('json source toggle shows raw text', () => {
    setPreview({
      status: 'ready',
      path: 'pkg.json',
      content: '{"a":1}',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    fireEvent.click(screen.getByTestId('preview-json-mode-source'))
    expect(screen.getByTestId('preview-json-source')).toHaveTextContent('{"a":1}')
  })

  it('renders csv table preview', () => {
    setPreview({
      status: 'ready',
      path: 'data.csv',
      content: 'name,age\nAda,36\n',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    const table = screen.getByTestId('preview-csv-table')
    expect(table).toHaveTextContent('name')
    expect(table).toHaveTextContent('Ada')
    expect(table).toHaveTextContent('36')
  })

  it('renders small html in sandboxed iframe after deferred mount', async () => {
    setPreview({ status: 'ready', path: 'index.html', content: '<p>hi</p>', mimeType: 'text/html', encoding: 'utf8' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-html-shell')).toBeInTheDocument()
    // Deferred mount: pending first, then iframe.
    await waitFor(() => {
      expect(screen.getByTestId('preview-html')).toHaveAttribute('sandbox', '')
    })
  })

  it('defaults large html to source and does not mount iframe until render', async () => {
    const big = `<html><body>${'x'.repeat(130_000)}</body></html>`
    setPreview({
      status: 'ready',
      path: 'big.html',
      content: big,
      mimeType: 'text/html',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-html-large-warn')).toBeInTheDocument()
    expect(screen.getByTestId('preview-html-source')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-html')).toBeNull()

    fireEvent.click(screen.getByTestId('preview-html-mode-render'))
    await waitFor(() => {
      expect(screen.getByTestId('preview-html')).toBeInTheDocument()
    })
  })

  it('wraps ready preview with filePreview context menu host', () => {
    setPreview({ status: 'ready', path: 'a.ts', content: 'x', mimeType: 'text/plain', encoding: 'utf8' })
    render(<FilePreview />)
    const host = document.querySelector('[data-context-menu-kind="filePreview"]')
    expect(host).toBeTruthy()
    expect(host).toHaveAttribute('data-context-menu-root')
  })

  it('does not wrap empty idle state with context menu', () => {
    render(<FilePreview />)
    expect(document.querySelector('[data-context-menu-kind="filePreview"]')).toBeNull()
  })

  it('shows path chrome above HTML preview for context-menu hit target', async () => {
    setPreview({
      status: 'ready',
      path: '/tmp/index.html',
      content: '<p>hi</p>',
      mimeType: 'text/html',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-html-shell')).toBeInTheDocument()
    const chrome = screen.getByTestId('preview-chrome')
    expect(chrome).toHaveTextContent('/tmp/index.html')
    expect(chrome.closest('[data-context-menu-kind="filePreview"]')).toBeTruthy()
    // Mode toggle lives on the same toolbar row as the path (not a full empty row).
    expect(screen.getByTestId('preview-html-mode').parentElement).toContainElement(chrome)
    await waitFor(() => expect(screen.getByTestId('preview-html')).toBeInTheDocument())
  })

  it('opens HTML in the default browser from the toolbar', async () => {
    setPreview({
      status: 'ready',
      path: '/tmp/index.html',
      content: '<p>hi</p>',
      mimeType: 'text/html',
      encoding: 'utf8',
    })
    render(<FilePreview />)
    fireEvent.click(screen.getByTestId('preview-html-open-browser'))
    expect(openWithDefaultApp).toHaveBeenCalledWith('/tmp/index.html', { cwd: '/tmp' })
  })

  it('shows path chrome above PDF iframe', () => {
    setPreview({
      status: 'ready',
      path: '/tmp/doc.pdf',
      content: 'JVBERi0=',
      mimeType: 'application/pdf',
      encoding: 'base64',
    })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-pdf-shell')).toBeInTheDocument()
    expect(screen.getByTestId('preview-chrome')).toHaveTextContent('/tmp/doc.pdf')
    expect(screen.getByTestId('preview-pdf')).toBeInTheDocument()
  })
})
