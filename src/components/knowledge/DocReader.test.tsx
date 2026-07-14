// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const setDraftBody = vi.fn()
const getState = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/i18n', () => ({
  default: { t: (key: string) => key },
}))

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: Object.assign(
    (selector: (s: { setDraftBody: typeof setDraftBody }) => unknown) =>
      selector({ setDraftBody }),
    {
      getState: () => getState(),
    },
  ),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}))

import { DocReader } from './DocReader'
import { open } from '@tauri-apps/plugin-shell'

afterEach(() => {
  cleanup()
  setDraftBody.mockReset()
  getState.mockReset()
  vi.mocked(open).mockReset()
})

beforeEach(() => {
  getState.mockReturnValue({
    draftBody: '',
    docBody: '',
    setDraftBody,
  })
})

describe('DocReader preview tasks + anchors', () => {
  it('renders interactive task checkboxes and write-backs via setDraftBody persist now', () => {
    const md = '- [ ] first\n- [x] second\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    render(<DocReader content={md} />)

    const boxes = screen.getAllByTestId('knowledge-task-checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).not.toBeChecked()
    expect(boxes[1]).toBeChecked()

    fireEvent.click(boxes[0])
    expect(setDraftBody).toHaveBeenCalledWith('- [x] first\n- [x] second\n', {
      persist: 'now',
    })
  })

  it('assigns heading ids and keeps in-doc hash links without shell open', () => {
    const md = '## Section One\n\nSee [jump](#section-one)\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      render(<DocReader content={md} />)
      const heading = document.getElementById('section-one')
      expect(heading).toBeTruthy()
      expect(heading?.tagName).toBe('H2')

      const link = screen.getByRole('link', { name: 'jump' })
      fireEvent.click(link)
      expect(scrollIntoView).toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('shows empty state when content is blank', () => {
    render(<DocReader content="   " />)
    expect(screen.getByTestId('knowledge-doc-empty')).toBeInTheDocument()
  })
})
