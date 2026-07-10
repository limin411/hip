// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@/i18n'
import { GlobalCommandPalette } from './GlobalCommandPalette'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { GLOBAL_COMMAND_PALETTE } from './feature'
import { buildGlobalCommandGroups } from './buildGlobalCommands'

describe('feature flag', () => {
  it('is dark-launched off', () => {
    expect(GLOBAL_COMMAND_PALETTE).toBe(false)
  })
})

describe('buildGlobalCommandGroups skeleton', () => {
  it('returns empty groups until PR-5/6 fill them', () => {
    const groups = buildGlobalCommandGroups({
      sessions: [],
      activeView: 'chat',
      theme: 'system',
      setActiveView: () => {},
      setTheme: () => {},
      newConversation: () => {},
      selectSession: () => {},
    })
    expect(groups).toEqual([])
  })
})

describe('GlobalCommandPalette shell', () => {
  beforeEach(() => {
    cleanup()
    useCommandPaletteStore.setState({ open: false, page: null })
  })

  it('renders dialog content when open', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    expect(screen.getByTestId('global-command-palette')).toBeInTheDocument()
    expect(screen.getByTestId('global-command-palette-input')).toBeInTheDocument()
    expect(screen.getByTestId('global-command-palette-empty')).toHaveTextContent(
      'Commands coming soon',
    )
  })

  it('does not show palette content when closed', () => {
    useCommandPaletteStore.setState({ open: false })
    render(<GlobalCommandPalette />)
    expect(screen.queryByTestId('global-command-palette')).not.toBeInTheDocument()
  })

  it('shows no-results copy when searching with empty groups', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    fireEvent.change(screen.getByTestId('global-command-palette-input'), {
      target: { value: 'settings' },
    })
    expect(screen.getByTestId('global-command-palette-empty')).toHaveTextContent('No results')
  })
})
