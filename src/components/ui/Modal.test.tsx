// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('Modal variants', () => {
  afterEach(() => {
    cleanup()
  })

  it('legacy (no variant) keeps full scrim + blur and omits data-confirm-dialog', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Legacy">
        <div>body</div>
      </Modal>,
    )
    // Overlay: full strength + blur (legacy). Radix portals to document.body.
    const overlays = document.querySelectorAll('.bg-overlay')
    expect(overlays.length).toBeGreaterThan(0)
    const hasBlur = Array.from(document.querySelectorAll('[class*="backdrop-blur"]')).length > 0
    expect(hasBlur).toBe(true)
    expect(document.querySelector('[data-confirm-dialog]')).toBeNull()
    expect(screen.getByText('Legacy')).toBeInTheDocument()
  })

  it('variant=confirm sets data-confirm-dialog and max-w-sm', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Confirm" variant="confirm">
        <div>sure?</div>
      </Modal>,
    )
    const content = document.querySelector('[data-confirm-dialog]')
    expect(content).not.toBeNull()
    expect(content?.className).toMatch(/max-w-sm/)
    // Full scrim when not nested
    const fullOverlay = document.querySelector('.bg-overlay.backdrop-blur-\\[2px\\], .bg-overlay')
    expect(fullOverlay).not.toBeNull()
  })

  it('variant=confirm nested uses light scrim without blur', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Nested" variant="confirm" nested>
        <div>sure?</div>
      </Modal>,
    )
    expect(document.querySelector('[data-confirm-dialog]')).not.toBeNull()
    const light = document.querySelector('.bg-overlay-light')
    expect(light).not.toBeNull()
    // Light path must not add blur on the same overlay node
    expect(light?.className).not.toMatch(/backdrop-blur/)
  })

  it('variant=shell drops max-w-lg / max-h-85vh constraints', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Shell" variant="shell">
        <div>panel</div>
      </Modal>,
    )
    const title = screen.getByText('Shell')
    const content = title.closest('[role="dialog"]')
    expect(content).not.toBeNull()
    expect(content?.className).not.toMatch(/max-w-lg/)
    expect(content?.className).not.toMatch(/max-h-\[85vh\]/)
    expect(content?.className).toMatch(/max-h-\[100dvh\]/)
  })

  it('variant=task non-resizable uses medium max-w-2xl', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Task" variant="task">
        <div>editor</div>
      </Modal>,
    )
    const content = screen.getByText('Task').closest('[role="dialog"]')
    expect(content?.className).toMatch(/max-w-2xl/)
  })

  it('shell Esc gate: confirm sets data-confirm-dialog; Escape leaves shell open', () => {
    const shellOpenChange = vi.fn()
    const confirmOpenChange = vi.fn()
    render(
      <>
        <Modal open onOpenChange={shellOpenChange} title="Shell" variant="shell">
          <div data-testid="shell-body">history</div>
        </Modal>
        <Modal
          open
          onOpenChange={confirmOpenChange}
          title="Confirm"
          variant="confirm"
          nested
        >
          <div data-testid="confirm-body">delete?</div>
        </Modal>
      </>,
    )
    // PR3 Esc matrix: confirm Content carries the gate attribute.
    expect(document.querySelector('[data-confirm-dialog]')).not.toBeNull()
    const shellDialog = screen.getByText('Shell').closest('[role="dialog"]') as HTMLElement
    const confirmDialog = screen
      .getByText('Confirm')
      .closest('[role="dialog"]') as HTMLElement
    expect(shellDialog).not.toBeNull()
    expect(confirmDialog).not.toBeNull()

    // Escape while confirm is open: shell must stay (gate preventDefault on shell).
    // Focus confirm first (topmost layer), then Escape.
    confirmDialog.focus()
    fireEvent.keyDown(confirmDialog, { key: 'Escape', code: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(screen.getByTestId('shell-body')).toBeInTheDocument()
    // Confirm may close via its own onOpenChange — shell must not.
    const shellClosed = shellOpenChange.mock.calls.some((c) => c[0] === false)
    expect(shellClosed).toBe(false)
  })
})
