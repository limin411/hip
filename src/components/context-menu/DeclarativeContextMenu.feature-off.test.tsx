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

  it('renders bare children without trigger wrapper or menu', () => {
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
        data-testid="ctx-host"
      >
        <button type="button">inner</button>
      </DeclarativeContextMenu>,
    )

    expect(screen.getByRole('button', { name: 'inner' })).toBeInTheDocument()
    expect(screen.queryByTestId('ctx-host')).not.toBeInTheDocument()
    expect(document.querySelector('[data-context-menu-root]')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'inner' }))
    expect(screen.queryByTestId('context-menu-content')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
