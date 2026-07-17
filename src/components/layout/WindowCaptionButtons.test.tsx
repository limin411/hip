// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WindowCaptionButtons } from './WindowCaptionButtons'

describe('WindowCaptionButtons', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.caption
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.caption
  })

  it('renders nothing without custom caption', () => {
    const { container } = render(<WindowCaptionButtons />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('window-caption')).not.toBeInTheDocument()
  })

  it('renders min/max/close when data-caption=custom', () => {
    document.documentElement.dataset.caption = 'custom'
    render(<WindowCaptionButtons />)
    expect(screen.getByTestId('window-caption')).toBeInTheDocument()
    expect(screen.getByTestId('window-caption-min')).toBeInTheDocument()
    expect(screen.getByTestId('window-caption-max')).toBeInTheDocument()
    expect(screen.getByTestId('window-caption-close')).toBeInTheDocument()
  })
})
