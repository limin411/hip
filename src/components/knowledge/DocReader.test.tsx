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

function taskIndices(): number[] {
  return (screen.getAllByTestId('knowledge-task-checkbox') as HTMLInputElement[]).map((el) =>
    Number(el.getAttribute('data-task-index')),
  )
}

describe('DocReader preview tasks + anchors', () => {
  it('renders interactive task checkboxes and write-backs via setDraftBody persist now', () => {
    const md = '- [ ] first\n- [x] second\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    render(<DocReader content={md} />)

    const boxes = screen.getAllByTestId('knowledge-task-checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).not.toBeChecked()
    expect(boxes[1]).toBeChecked()
    expect(taskIndices()).toEqual([0, 1])

    fireEvent.click(boxes[0])
    expect(setDraftBody).toHaveBeenCalledWith('- [x] first\n- [x] second\n', {
      persist: 'now',
    })
  })

  it('keeps stable task indices after re-render with same content', () => {
    const md = '- [ ] a\n- [ ] b\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    const { rerender } = render(<DocReader content={md} />)
    expect(taskIndices()).toEqual([0, 1])

    rerender(<DocReader content={md} />)
    expect(taskIndices()).toEqual([0, 1])

    // Second pass must still write the correct task (index 1), not drift to 3+.
    fireEvent.click(screen.getAllByTestId('knowledge-task-checkbox')[1])
    expect(setDraftBody).toHaveBeenCalledWith('- [ ] a\n- [x] b\n', { persist: 'now' })
  })

  it('keeps stable task indices after content updates (post-toggle / flush)', () => {
    const md0 = '- [ ] a\n- [ ] b\n'
    const md1 = '- [x] a\n- [ ] b\n'
    getState.mockReturnValue({ draftBody: md0, docBody: md0, setDraftBody })

    const { rerender } = render(<DocReader content={md0} />)
    fireEvent.click(screen.getAllByTestId('knowledge-task-checkbox')[0])
    expect(setDraftBody).toHaveBeenLastCalledWith(md1, { persist: 'now' })

    getState.mockReturnValue({ draftBody: md1, docBody: md1, setDraftBody })
    rerender(<DocReader content={md1} />)

    expect(taskIndices()).toEqual([0, 1])
    const boxes = screen.getAllByTestId('knowledge-task-checkbox') as HTMLInputElement[]
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()

    // Second click toggles the other task with stable index 1.
    fireEvent.click(boxes[1])
    expect(setDraftBody).toHaveBeenLastCalledWith('- [x] a\n- [x] b\n', { persist: 'now' })
  })

  it('assigns stable heading ids across re-renders and hash-scrolls without shell open', () => {
    const md = '## Intro\n\n## Intro\n\nSee [jump](#intro)\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      const { rerender } = render(<DocReader content={md} />)
      expect(document.getElementById('intro')).toBeTruthy()
      expect(document.getElementById('intro-1')).toBeTruthy()

      rerender(<DocReader content={md} />)
      // Must not drift to intro-2 / intro-3 after re-render.
      expect(document.getElementById('intro')).toBeTruthy()
      expect(document.getElementById('intro-1')).toBeTruthy()
      expect(document.getElementById('intro-2')).toBeNull()

      const link = screen.getByRole('link', { name: 'jump' })
      fireEvent.click(link)
      expect(scrollIntoView).toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('hash scroll uses the DocReader root (scoped lookup)', () => {
    const md = '## Scoped\n\n[go](#scoped)\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    // Poison document-level id outside the reader.
    const poison = document.createElement('h2')
    poison.id = 'scoped'
    document.body.appendChild(poison)
    const poisonScroll = vi.fn()
    poison.scrollIntoView = poisonScroll

    try {
      render(<DocReader content={md} />)
      const reader = screen.getByTestId('knowledge-doc-reader')
      const heading = reader.querySelector('#scoped') as HTMLElement
      expect(heading).toBeTruthy()
      const headingScroll = vi.fn()
      heading.scrollIntoView = headingScroll

      fireEvent.click(screen.getByRole('link', { name: 'go' }))
      expect(headingScroll).toHaveBeenCalled()
      expect(poisonScroll).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      poison.remove()
    }
  })

  it('optimistic content prop reflects draft before flush (checked state)', () => {
    // Parent passes draftBody after toggle; checkbox must show checked immediately.
    const after = '- [x] only\n'
    getState.mockReturnValue({ draftBody: after, docBody: '- [ ] only\n', setDraftBody })
    render(<DocReader content={after} />)
    expect(screen.getByTestId('knowledge-task-checkbox')).toBeChecked()
  })

  it('shows empty state when content is blank', () => {
    render(<DocReader content="   " />)
    expect(screen.getByTestId('knowledge-doc-empty')).toBeInTheDocument()
  })
})
