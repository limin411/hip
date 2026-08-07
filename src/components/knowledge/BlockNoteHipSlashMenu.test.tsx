// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BlockNoteHipSlashMenu } from './BlockNoteHipSlashMenu'
import type { DefaultReactSuggestionItem } from '@blocknote/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => cleanup())

const items: DefaultReactSuggestionItem[] = [
  {
    title: 'Heading 1',
    group: 'Basic',
    subtext: 'h1',
    onItemClick: () => {},
  },
  {
    title: 'Table',
    group: 'Media',
    subtext: 'table',
    onItemClick: () => {},
  },
]

describe('BlockNoteHipSlashMenu', () => {
  it('renders hip chrome with groups, icons, and slash subtitles', () => {
    render(
      <BlockNoteHipSlashMenu
        items={items}
        loadingState="loaded"
        selectedIndex={0}
        onItemClick={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-slash-menu')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-h1')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-table')).toBeInTheDocument()
    expect(screen.getByText('/h1')).toBeInTheDocument()
    expect(screen.getByText('H1')).toBeInTheDocument()
  })

  it('fires onItemClick for selected row', () => {
    const onItemClick = vi.fn()
    render(
      <BlockNoteHipSlashMenu
        items={items}
        loadingState="loaded"
        selectedIndex={1}
        onItemClick={onItemClick}
      />,
    )
    fireEvent.click(screen.getByTestId('knowledge-slash-table'))
    expect(onItemClick).toHaveBeenCalledWith(
      expect.objectContaining({ subtext: 'table', title: 'Table' }),
    )
  })

  it('shows empty state when no matches', () => {
    render(
      <BlockNoteHipSlashMenu
        items={[]}
        loadingState="loaded"
        selectedIndex={undefined}
        onItemClick={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-slash-menu-empty')).toBeInTheDocument()
  })
})
