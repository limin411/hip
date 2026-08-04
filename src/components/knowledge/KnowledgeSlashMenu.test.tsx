// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KnowledgeSlashMenu } from './KnowledgeSlashMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

afterEach(() => cleanup())

describe('KnowledgeSlashMenu', () => {
  it('renders catalog items and selects on click', () => {
    const onSelect = vi.fn()
    const onDismiss = vi.fn()
    render(
      <KnowledgeSlashMenu query="" onSelect={onSelect} onDismiss={onDismiss} />,
    )
    expect(screen.getByTestId('knowledge-slash-menu')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-h1')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-table')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-wiki')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('knowledge-slash-task'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task', insert: '- [ ] ' }),
    )
  })

  it('filters by query', () => {
    render(
      <KnowledgeSlashMenu query="tab" onSelect={() => {}} onDismiss={() => {}} />,
    )
    expect(screen.getByTestId('knowledge-slash-table')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-h1')).not.toBeInTheDocument()
  })

  it('shows empty state when no match', () => {
    render(
      <KnowledgeSlashMenu
        query="zzzzz"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-slash-menu-empty')).toBeInTheDocument()
  })

  it('Enter selects the highlighted item', () => {
    const onSelect = vi.fn()
    render(
      <KnowledgeSlashMenu query="h1" onSelect={onSelect} onDismiss={() => {}} />,
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
  })

  it('Escape dismisses', () => {
    const onDismiss = vi.fn()
    render(
      <KnowledgeSlashMenu query="" onSelect={() => {}} onDismiss={onDismiss} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('ArrowDown moves highlight; Enter selects second item', () => {
    const onSelect = vi.fn()
    render(
      <KnowledgeSlashMenu query="h" onSelect={onSelect} onDismiss={() => {}} />,
    )
    // h → h1, h2, h3, hr — start on h1
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'h2' }))
  })

  it('ArrowDown at the last item wraps to the first item', () => {
    const onDismiss = vi.fn()
    render(
      <KnowledgeSlashMenu query="h" onSelect={() => {}} onDismiss={onDismiss} />,
    )
    // h → h1, h2, h3, hr — move to hr
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByTestId('knowledge-slash-hr')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Wrap back to h1
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(screen.getByTestId('knowledge-slash-h1')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('knowledge-slash-hr')).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ArrowUp at top wraps to the last item', () => {
    const onDismiss = vi.fn()
    render(
      <KnowledgeSlashMenu query="h" onSelect={() => {}} onDismiss={onDismiss} />,
    )
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    // h → h1, h2, h3, hr — start on h1, wrap to hr
    expect(screen.getByTestId('knowledge-slash-hr')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('knowledge-slash-h1')).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores keys while IME is composing (M1)', () => {
    const onSelect = vi.fn()
    const onDismiss = vi.fn()
    render(
      <KnowledgeSlashMenu query="h1" onSelect={onSelect} onDismiss={onDismiss} />,
    )
    fireEvent.keyDown(document, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(document, { key: 'Process' })
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('sets aria-activedescendant on the listbox', () => {
    render(
      <KnowledgeSlashMenu query="h1" onSelect={() => {}} onDismiss={() => {}} />,
    )
    expect(screen.getByTestId('knowledge-slash-menu')).toHaveAttribute(
      'aria-activedescendant',
      'knowledge-slash-opt-h1',
    )
  })
})
