// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProductHelpSettings } from './ProductHelpSettings'
import { HIP_PRODUCT_VERSION, PRODUCT_HELP_SECTIONS } from '@/domain/product'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'settings.productHelp.version' && params?.version) return `v${params.version}`
      if (key === 'settings.productHelp.docsRev' && params?.rev) return `docs ${params.rev}`
      if (key.startsWith('settings.productHelp.sections.')) return key.split('.').pop()!
      return key
    },
  }),
}))

vi.mock('@/components/chat/MarkdownBody', () => ({
  MarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="md-body">{content.slice(0, 80)}</div>
  ),
}))

afterEach(() => cleanup())

describe('ProductHelpSettings', () => {
  it('shows version and capability summary from product SoT', () => {
    render(<ProductHelpSettings />)
    expect(screen.getByTestId('settings-product-help')).toBeInTheDocument()
    expect(screen.getByTestId('product-help-version')).toHaveTextContent(`v${HIP_PRODUCT_VERSION}`)
    expect(screen.getByTestId('product-help-capability')).toBeInTheDocument()
    expect(screen.getByTestId('product-help-panel-overview')).toBeInTheDocument()
  })

  it('switches L3 sections via tabs', () => {
    render(<ProductHelpSettings />)
    const memory = PRODUCT_HELP_SECTIONS.find((s) => s.id === 'memory')
    expect(memory).toBeDefined()
    fireEvent.click(screen.getByTestId('product-help-tab-memory'))
    const panel = screen.getByTestId('product-help-panel-memory')
    expect(panel).toBeInTheDocument()
    expect(panel.textContent).toMatch(/memory/i)
  })
})
