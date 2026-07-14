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
})
