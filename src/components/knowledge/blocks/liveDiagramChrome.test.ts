/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'
import { createDiagramChrome } from './liveDiagramChrome'

vi.mock('@/ipc/clipboard', () => ({
  copyText: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  },
}))

describe('createDiagramChrome', () => {
  it('builds label, mode segment, and copy control', () => {
    const onMode = vi.fn()
    const chrome = createDiagramChrome({
      kind: 'mermaid',
      label: 'Mermaid',
      testIdPrefix: 'knowledge-live-mermaid',
      getSource: () => 'graph TD\n  A-->B',
      onMode,
    })

    expect(chrome.header.getAttribute('data-testid')).toBe(
      'knowledge-live-mermaid-chrome',
    )
    expect(
      chrome.header.querySelector('[data-testid="knowledge-live-mermaid-label"]')
        ?.textContent,
    ).toBe('Mermaid')
    expect(
      chrome.header.querySelector(
        '[data-testid="knowledge-live-mermaid-mode-source"]',
      ),
    ).toBeTruthy()
    expect(
      chrome.header.querySelector(
        '[data-testid="knowledge-live-mermaid-mode-preview"]',
      ),
    ).toBeTruthy()
    expect(
      chrome.header.querySelector(
        '[data-testid="knowledge-live-mermaid-copy"]',
      ),
    ).toBeTruthy()
  })

  it('setMode updates aria-pressed and dataset.mode', () => {
    const chrome = createDiagramChrome({
      kind: 'svg',
      label: 'SVG',
      testIdPrefix: 'knowledge-live-svg',
      getSource: () => '<svg/>',
      onMode: () => {},
    })

    chrome.setMode('preview')
    expect(chrome.header.dataset.mode).toBe('preview')
    const source = chrome.header.querySelector(
      '[data-testid="knowledge-live-svg-mode-source"]',
    ) as HTMLButtonElement
    const preview = chrome.header.querySelector(
      '[data-testid="knowledge-live-svg-mode-preview"]',
    ) as HTMLButtonElement
    expect(source.getAttribute('aria-pressed')).toBe('false')
    expect(preview.getAttribute('aria-pressed')).toBe('true')

    chrome.setMode('edit')
    expect(chrome.header.dataset.mode).toBe('edit')
    expect(source.getAttribute('aria-pressed')).toBe('true')
    expect(preview.getAttribute('aria-pressed')).toBe('false')
  })

  it('mode buttons invoke onMode on mousedown and click', () => {
    const onMode = vi.fn()
    const chrome = createDiagramChrome({
      kind: 'mermaid',
      label: 'Mermaid',
      testIdPrefix: 'knowledge-live-mermaid',
      getSource: () => 'x',
      onMode,
    })
    document.body.appendChild(chrome.header)

    const source = chrome.header.querySelector(
      '[data-testid="knowledge-live-mermaid-mode-source"]',
    ) as HTMLButtonElement
    const preview = chrome.header.querySelector(
      '[data-testid="knowledge-live-mermaid-mode-preview"]',
    ) as HTMLButtonElement

    source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onMode).toHaveBeenCalledWith('edit')
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onMode).toHaveBeenCalledWith('preview')

    onMode.mockClear()
    source.click()
    expect(onMode).toHaveBeenCalledWith('edit')

    chrome.header.remove()
  })

  it('copy invokes clipboard with current source', async () => {
    const { copyText } = await import('@/ipc/clipboard')
    const chrome = createDiagramChrome({
      kind: 'mermaid',
      label: 'Mermaid',
      testIdPrefix: 'knowledge-live-mermaid',
      getSource: () => 'graph TD',
      onMode: () => {},
    })
    document.body.appendChild(chrome.header)
    const copy = chrome.header.querySelector(
      '[data-testid="knowledge-live-mermaid-copy"]',
    ) as HTMLButtonElement
    copy.click()
    expect(copyText).toHaveBeenCalledWith('graph TD')
    chrome.header.remove()
  })
})
