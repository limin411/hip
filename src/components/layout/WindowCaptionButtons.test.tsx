// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCaptionTitleDoubleClick, WindowCaptionButtons } from './WindowCaptionButtons'

const toggleMaximize = vi.fn().mockResolvedValue(undefined)
const minimize = vi.fn().mockResolvedValue(undefined)
const close = vi.fn().mockResolvedValue(undefined)
const isMaximized = vi.fn().mockResolvedValue(false)
const onResized = vi.fn().mockResolvedValue(() => {})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    toggleMaximize,
    minimize,
    close,
    isMaximized,
    onResized,
  }),
}))

function DblClickHost() {
  const onDoubleClick = useCaptionTitleDoubleClick()
  return (
    <div data-testid="title-surface" onDoubleClick={onDoubleClick}>
      <span>title</span>
      <button type="button" data-testid="no-drag-btn" data-no-drag>
        action
      </button>
    </div>
  )
}

describe('WindowCaptionButtons', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.caption
    toggleMaximize.mockClear()
    minimize.mockClear()
    close.mockClear()
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

  it('caption max button toggles maximize', async () => {
    document.documentElement.dataset.caption = 'custom'
    render(<WindowCaptionButtons />)
    fireEvent.click(screen.getByTestId('window-caption-max'))
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1))
  })
})

describe('useCaptionTitleDoubleClick', () => {
  beforeEach(() => {
    toggleMaximize.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('toggles maximize on double-click of the title surface', async () => {
    render(<DblClickHost />)
    fireEvent.doubleClick(screen.getByTestId('title-surface'))
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1))
  })

  it('ignores double-click on interactive / no-drag targets', async () => {
    render(<DblClickHost />)
    fireEvent.doubleClick(screen.getByTestId('no-drag-btn'))
    await waitFor(() => expect(toggleMaximize).not.toHaveBeenCalled())
  })
})
