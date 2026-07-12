// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@/i18n'
import { DeclarativeContextMenu } from './DeclarativeContextMenu'
import { clearContextProviders, registerContextProvider } from './registry'
import { CONTEXT_MENUS } from './feature'
import type { ContextProvider } from './types'

describe('feature flag', () => {
  it('CONTEXT_MENUS is enabled', () => {
    expect(CONTEXT_MENUS).toBe(true)
  })
})

describe('DeclarativeContextMenu', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
  })

  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('prevents open when items are empty', async () => {
    render(
      <DeclarativeContextMenu
        kind="chatEmpty"
        payload={{ sessionId: null }}
        data-testid="ctx-host"
      >
        <button type="button">Host</button>
      </DeclarativeContextMenu>,
    )

    const host = screen.getByTestId('ctx-host')
    fireEvent.contextMenu(host)

    await waitFor(() => {
      expect(screen.queryByTestId('context-menu-content')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens on contextmenu when provider returns items', async () => {
    const run = vi.fn()
    const provider: ContextProvider = (req) => {
      if (req.kind !== 'codeBlock') return []
      return [
        {
          // Extra id — must not collide with builtin codeBlock.copy
          id: 'codeBlock.testExtra',
          label: 'Test extra',
          group: 'extensions',
          run,
        },
      ]
    }
    registerContextProvider(provider)

    render(
      <DeclarativeContextMenu
        kind="codeBlock"
        payload={{ code: 'const x = 1' }}
        data-testid="ctx-host"
      >
        <span>code</span>
      </DeclarativeContextMenu>,
    )

    fireEvent.contextMenu(screen.getByTestId('ctx-host'))

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-content')).toBeInTheDocument()
    })
    // Builtin + extra both present
    expect(screen.getByTestId('context-menu-item-codeBlock.copy')).toBeInTheDocument()
    expect(screen.getByTestId('context-menu-item-codeBlock.testExtra')).toHaveTextContent(
      'Test extra',
    )

    fireEvent.click(screen.getByTestId('context-menu-item-codeBlock.testExtra'))
    expect(run).toHaveBeenCalled()
  })

  it('opens via keyboard context menu event (Shift+F10 / contextmenu key smoke)', async () => {
    registerContextProvider((req) => {
      if (req.kind !== 'fileEntry') return []
      return [
        {
          id: 'file.copyName',
          label: 'Copy name',
          group: 'clipboard',
          run: () => {},
        },
      ]
    })

    render(
      <DeclarativeContextMenu
        kind="fileEntry"
        payload={{
          path: '/a/b.ts',
          name: 'b.ts',
          isDir: false,
          scopeId: 's1',
          isDraft: false,
          cwd: '/a',
        }}
        data-testid="ctx-host"
      >
        <button type="button">file</button>
      </DeclarativeContextMenu>,
    )

    const host = screen.getByTestId('ctx-host')
    host.focus()
    // Radix ContextMenu opens on the contextmenu event (also fired for Shift+F10 / Menu key).
    fireEvent.contextMenu(host)

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item-file.copyName')).toBeInTheDocument()
    })
  })

  it('marks danger items and shows shortcut when set', async () => {
    registerContextProvider(() => [
      {
        id: 'sessionTab.close',
        label: 'Delete tab',
        group: 'danger',
        danger: true,
        shortcut: '⌘W',
        run: () => {},
      },
    ])

    render(
      <DeclarativeContextMenu
        kind="sessionTab"
        payload={{ sessionId: 's1', title: 'T', surface: 'chat' }}
        data-testid="ctx-host"
      >
        <span>tab</span>
      </DeclarativeContextMenu>,
    )

    fireEvent.contextMenu(screen.getByTestId('ctx-host'))
    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item-sessionTab.close')).toBeInTheDocument()
    })
    const row = screen.getByTestId('context-menu-item-sessionTab.close')
    expect(row).toHaveTextContent('Delete tab')
    expect(row).toHaveTextContent('⌘W')
    expect(row.className).toMatch(/text-danger/)
  })
})
