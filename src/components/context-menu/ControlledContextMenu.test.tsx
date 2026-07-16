// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@/i18n'
import { ControlledContextMenu } from './ControlledContextMenu'
import { clearContextProviders, registerContextProvider } from './registry'
import type { ContextProvider } from './types'

describe('ControlledContextMenu', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
  })

  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('does not render menu when open with empty items', async () => {
    const onOpenChange = vi.fn()
    render(
      <ControlledContextMenu
        kind="chatEmpty"
        payload={{ sessionId: null }}
        open
        onOpenChange={onOpenChange}
        point={{ x: 40, y: 60 }}
      />,
    )

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(screen.queryByTestId('controlled-context-menu-content')).not.toBeInTheDocument()
  })

  it('opens at point and runs item on select', async () => {
    const run = vi.fn()
    // Use a kind with no builtin items so the extra provider is the sole source.
    const provider: ContextProvider = (req) => {
      if (req.kind !== 'chatEmpty') return []
      return [
        {
          id: 'test.chatEmpty.action',
          label: 'Do something',
          group: 'primary',
          run,
        },
      ]
    }
    registerContextProvider(provider)

    render(
      <ControlledContextMenu
        kind="chatEmpty"
        payload={{ sessionId: null }}
        open
        onOpenChange={() => {}}
        point={{ x: 120, y: 80 }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('controlled-context-menu-content')).toBeInTheDocument()
    })
    const anchor = screen.getByTestId('controlled-context-menu-anchor')
    expect(anchor.style.left).toBe('120px')
    expect(anchor.style.top).toBe('80px')

    fireEvent.click(screen.getByTestId('context-menu-item-test.chatEmpty.action'))
    expect(run).toHaveBeenCalled()
  })
})
