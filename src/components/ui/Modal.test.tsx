// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
})
