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

  it('uses the X1 356px width and 40px rows', () => {
    render(
      <BlockNoteHipSlashMenu
        items={items}
        loadingState="loaded"
        selectedIndex={0}
        onItemClick={() => {}}
      />,
    )
    const menu = screen.getByTestId('knowledge-slash-menu')
    // 22.25rem = 356px
    expect(menu.className).toContain('w-[min(100vw-2rem,22.25rem)]')
    for (const row of menu.querySelectorAll('button.kb-slash-item')) {
      expect(row.className).toContain('h-10')
    }
    // Fixed 46px icon column with a 30px tile inside
    const iconCol = menu.querySelector('.kb-slash-item > span.flex')
    expect(iconCol?.className).toContain('w-[46px]')
    const tile = menu.querySelector('.kb-slash-icon')
    expect(tile).toBeInTheDocument()
    expect(tile?.className).toContain('kb-slash-icon')
  })

  it('marks the selected row warm-gray with a trailing arrow', () => {
    render(
      <BlockNoteHipSlashMenu
        items={items}
        loadingState="loaded"
        selectedIndex={0}
        onItemClick={() => {}}
      />,
    )
    const selected = screen.getByTestId('knowledge-slash-h1')
    expect(selected.className).toContain('kb-slash-selected')
    const arrow = selected.querySelector('.kb-slash-arrow')
    expect(arrow).toBeInTheDocument()
    expect(arrow?.textContent).toBe('›')
    const other = screen.getByTestId('knowledge-slash-table')
    expect(other.className).not.toContain('kb-slash-selected')
    expect(other.querySelector('.kb-slash-arrow')).not.toBeInTheDocument()
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
