// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('./feature', () => ({ CONTEXT_MENUS: false }))

import { DeclarativeContextMenu } from './DeclarativeContextMenu'
import { registerContextProvider, clearContextProviders } from './registry'

describe('DeclarativeContextMenu when CONTEXT_MENUS is false', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
  })

  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('renders layout wrapper without menu chrome or data-context-menu-root', () => {
    registerContextProvider(() => [
      {
        id: 'codeBlock.copy',
        label: 'Copy',
        group: 'clipboard',
        run: () => {},
      },
    ])

    render(
      <DeclarativeContextMenu
        kind="codeBlock"
        payload={{ code: 'x' }}
        className="group/code relative"
        data-testid="ctx-host"
      >
        <button type="button">inner</button>
      </DeclarativeContextMenu>,
    )

    expect(screen.getByRole('button', { name: 'inner' })).toBeInTheDocument()
    // Layout className is preserved on a plain div when menus are off.
    const host = screen.getByTestId('ctx-host')
    expect(host).toHaveClass('group/code', 'relative')
    expect(host).not.toHaveAttribute('data-context-menu-root')
    expect(document.querySelector('[data-context-menu-root]')).toBeNull()

    fireEvent.contextMenu(host)
    expect(screen.queryByTestId('context-menu-content')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
