// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useWindowDrag } from './useWindowDrag'

const startDragging = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging }),
}))

function DragSurface({ children }: { children?: React.ReactNode }) {
  const onPointerDown = useWindowDrag()
  return (
    <div data-testid="drag-surface" onPointerDown={onPointerDown}>
      {children}
    </div>
  )
}

describe('useWindowDrag', () => {
  beforeEach(() => {
    startDragging.mockClear()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__TAURI_INTERNALS__ = {}
  })

  afterEach(() => {
    cleanup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__TAURI_INTERNALS__
  })

  it('starts dragging when pointer moves past threshold on the surface', async () => {
    render(<DragSurface />)
    const surface = document.querySelector('[data-testid="drag-surface"]')!

    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 110, clientY: 110 })

    await waitFor(() => expect(startDragging).toHaveBeenCalledTimes(1))
  })

  it('does not start dragging for small movements below threshold', () => {
    render(<DragSurface />)
    const surface = document.querySelector('[data-testid="drag-surface"]')!

    fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 102, clientY: 102 })

    expect(startDragging).not.toHaveBeenCalled()
  })

  it('does not start dragging when pressing a data-no-drag button', () => {
    render(
      <DragSurface>
        <button data-testid="no-drag-button" data-no-drag>
          Click me
        </button>
      </DragSurface>,
    )
    const button = document.querySelector('[data-testid="no-drag-button"]')!

    fireEvent.pointerDown(button, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 120 })

    expect(startDragging).not.toHaveBeenCalled()
  })

  it('does not react to non-primary buttons', () => {
    render(<DragSurface />)
    const surface = document.querySelector('[data-testid="drag-surface"]')!

    fireEvent.pointerDown(surface, { button: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 120 })

    expect(startDragging).not.toHaveBeenCalled()
  })
})
