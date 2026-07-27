import { describe, expect, it } from 'vitest'
import {
  floatInMotion,
  menuMotion,
  modalMotion,
  overlayMotion,
  panelEnterMotion,
  viewEnterMotion,
} from './motionClasses'

describe('motionClasses', () => {
  it('overlay uses open/closed overlay animations for Radix Presence', () => {
    expect(overlayMotion).toContain('data-[state=open]:animate-overlay-in')
    expect(overlayMotion).toContain('data-[state=closed]:animate-overlay-out')
  })

  it('modal uses scale enter/exit without translate', () => {
    expect(modalMotion).toContain('animate-modal-in')
    expect(modalMotion).toContain('animate-modal-out')
    expect(modalMotion).not.toContain('translate')
  })

  it('menu pairs open/close for dropdowns and popovers', () => {
    expect(menuMotion).toContain('animate-menu-in')
    expect(menuMotion).toContain('animate-menu-out')
  })

  it('exports mount-only helpers for non-Radix floats and views', () => {
    expect(floatInMotion).toBe('animate-menu-in')
    expect(viewEnterMotion).toBe('animate-view-enter')
    expect(panelEnterMotion).toBe('animate-panel-in')
  })
})
