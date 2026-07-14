// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WikiCreateModal } from './WikiCreateModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (key === 'knowledge.wiki.createTitle') return 'Create document?'
      if (key === 'knowledge.wiki.createBody') return `Create “${opts?.title}”?`
      if (key === 'knowledge.wiki.createConfirm') return 'Create'
      if (key === 'common.cancel') return 'Cancel'
      if (key === 'common.close') return 'Close'
      return key
    },
  }),
}))

afterEach(() => cleanup())

describe('WikiCreateModal', () => {
  it('confirms create with title in body', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <WikiCreateModal
        open
        title="Ghost"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    )
    expect(screen.getByTestId('knowledge-wiki-create-body')).toHaveTextContent(
      'Ghost',
    )
    fireEvent.click(screen.getByTestId('knowledge-wiki-create-confirm'))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('cancel closes without create', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <WikiCreateModal
        open
        title="Ghost"
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    )
    fireEvent.click(screen.getByTestId('knowledge-wiki-create-cancel'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
