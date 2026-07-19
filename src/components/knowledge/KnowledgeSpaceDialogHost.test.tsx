// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { KnowledgeSpaceDialogHost } from './KnowledgeSpaceDialogHost'
import {
  closeKnowledgeSpaceDialog,
  openCreateKnowledgeSpaceDialog,
  openRenameKnowledgeSpaceDialog,
  resetKnowledgeSpaceDialogStore,
} from './knowledgeSpaceDialogStore'

const createSpace = vi.fn()
const renameSpace = vi.fn()
const deleteSpace = vi.fn()

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      spaces: [{ id: 'spc_1', name: 'Existing', icon: '📦' }],
      createSpace,
      renameSpace,
      deleteSpace,
      busy: false,
    }),
}))

vi.mock('@/components/layout/sidebarActions', () => ({
  openSpaceFromSidebar: vi.fn(async () => {}),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string; defaultValue?: string }) => {
      if (opts?.name) return `${key}:${opts.name}`
      return opts?.defaultValue ?? key
    },
  }),
}))

describe('KnowledgeSpaceDialogHost icon', () => {
  beforeEach(() => {
    cleanup()
    resetKnowledgeSpaceDialogStore()
    createSpace.mockReset()
    renameSpace.mockReset()
    createSpace.mockResolvedValue({ id: 'spc_new', name: 'New', icon: '📈' })
    renameSpace.mockResolvedValue(true)
  })

  afterEach(() => {
    closeKnowledgeSpaceDialog()
    resetKnowledgeSpaceDialogStore()
    cleanup()
  })

  it('create passes selected emoji to createSpace', async () => {
    openCreateKnowledgeSpaceDialog()
    render(<KnowledgeSpaceDialogHost />)

    expect(screen.getByTestId('knowledge-create-space-icon')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('knowledge-create-space-icon-preset-📈'))
    fireEvent.change(screen.getByTestId('knowledge-create-space-name'), {
      target: { value: '股市笔记' },
    })
    fireEvent.click(screen.getByTestId('knowledge-create-space-confirm'))

    await waitFor(() => {
      expect(createSpace).toHaveBeenCalledWith('股市笔记', '📈')
    })
  })

  it('create without icon omits icon arg', async () => {
    openCreateKnowledgeSpaceDialog()
    render(<KnowledgeSpaceDialogHost />)

    fireEvent.change(screen.getByTestId('knowledge-create-space-name'), {
      target: { value: '无图标库' },
    })
    fireEvent.click(screen.getByTestId('knowledge-create-space-confirm'))

    await waitFor(() => {
      expect(createSpace).toHaveBeenCalledWith('无图标库', undefined)
    })
  })

  it('rename preloads icon and can clear it', async () => {
    openRenameKnowledgeSpaceDialog('spc_1', 'Existing', '📦')
    render(<KnowledgeSpaceDialogHost />)

    expect(screen.getByTestId('knowledge-rename-space-icon-preview')).toHaveTextContent(
      '📦',
    )

    fireEvent.click(screen.getByTestId('knowledge-rename-space-icon-none'))
    fireEvent.click(screen.getByTestId('knowledge-rename-space-confirm'))

    await waitFor(() => {
      expect(renameSpace).toHaveBeenCalledWith('spc_1', 'Existing', '')
    })
  })
})
