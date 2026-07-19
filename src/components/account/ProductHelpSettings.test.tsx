// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProductHelpSettings } from './ProductHelpSettings'
import { HIP_PRODUCT_VERSION, getProductHelpPack } from '@/domain/product'

let language = 'en'

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

vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: { language: string }) => unknown) => sel({ language }),
}))

vi.mock('@/components/chat/MarkdownBody', () => ({
  MarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="md-body">{content.slice(0, 120)}</div>
  ),
}))

afterEach(() => {
  cleanup()
  language = 'en'
})

describe('ProductHelpSettings', () => {
  beforeEach(() => {
    language = 'en'
  })

  it('shows version and English capability summary', () => {
    render(<ProductHelpSettings />)
    expect(screen.getByTestId('settings-product-help')).toBeInTheDocument()
    expect(screen.getByTestId('product-help-version')).toHaveTextContent(`v${HIP_PRODUCT_VERSION}`)
    expect(screen.getByTestId('product-help-locale')).toHaveTextContent('en')
    expect(screen.getByTestId('product-help-capability')).toBeInTheDocument()
    expect(screen.getByTestId('product-help-panel-overview')).toBeInTheDocument()
    expect(screen.getByTestId('product-help-description').textContent).toMatch(/Product help/i)
  })

  it('switches L3 sections via tabs', () => {
    render(<ProductHelpSettings />)
    fireEvent.click(screen.getByTestId('product-help-tab-memory'))
    const panel = screen.getByTestId('product-help-panel-memory')
    expect(panel).toBeInTheDocument()
    expect(panel.textContent).toMatch(/memory/i)
  })

  it('uses zh-CN pack when UI language is zh-CN', () => {
    language = 'zh-CN'
    const pack = getProductHelpPack('zh-CN')
    expect(pack.capabilityMap).toMatch(/产品要点|版本/)
    render(<ProductHelpSettings />)
    expect(screen.getByTestId('product-help-locale')).toHaveTextContent('zh-CN')
    expect(screen.getByTestId('product-help-description').textContent).toMatch(/产品帮助|桌面/)
    expect(screen.getByTestId('product-help-capability').textContent).toMatch(/产品要点|版本/)
  })

  it('uses zh-TW pack when UI language is zh-TW', () => {
    language = 'zh-TW'
    render(<ProductHelpSettings />)
    expect(screen.getByTestId('product-help-locale')).toHaveTextContent('zh-TW')
    expect(screen.getByTestId('product-help-description').textContent).toMatch(/產品說明|桌面/)
  })
})
