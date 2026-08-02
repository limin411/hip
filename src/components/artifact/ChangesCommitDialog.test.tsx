// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ChangesCommitDialog } from './ChangesCommitDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'artifact.changesView.commitPrompt') {
        return 'branch={{branch}}\nmessage={{message}}\nfilesNote={{filesNote}}\nfiles={{files}}'
      }
      if (key === 'artifact.changesView.commitMessageByAgent') return '(msg-agent)'
      if (key === 'artifact.changesView.commitFilesByAgent') return '(files-agent)'
      if (key === 'artifact.changesView.commitBranchUnknown') return '(unknown-branch)'
      if (key === 'artifact.changesView.commitFilesHint') return `hint:${opts?.count}`
      if (key === 'common.cancel') return 'Cancel'
      return key
    },
  }),
}))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean
    title: string
    children: React.ReactNode
    footer?: React.ReactNode
  }) =>
    open ? (
      <div data-testid="commit-modal">
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
}))

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  cleanup()
})

describe('ChangesCommitDialog', () => {
  it('shows branch and injects agent fallbacks when fields are empty', () => {
    const onConfirm = vi.fn()
    render(
      <ChangesCommitDialog
        open
        branch="feature/x"
        uncommittedPaths={['src/a.ts']}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    expect(screen.getByTestId('changes-commit-branch')).toHaveTextContent('feature/x')
    expect(screen.getByTestId('changes-commit-files-hint')).toHaveTextContent('hint:1')
    fireEvent.click(screen.getByTestId('changes-commit-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining('branch=feature/x'),
    )
    expect(onConfirm).toHaveBeenCalledWith(expect.stringContaining('message=(msg-agent)'))
    expect(onConfirm).toHaveBeenCalledWith(expect.stringContaining('filesNote=(files-agent)'))
    expect(onConfirm).toHaveBeenCalledWith(expect.stringContaining('files=src/a.ts'))
  })

  it('passes filled message and files note into the prompt', () => {
    const onConfirm = vi.fn()
    render(
      <ChangesCommitDialog
        open
        branch="main"
        uncommittedPaths={['a.ts']}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.change(screen.getByTestId('changes-commit-message'), {
      target: { value: 'ship it' },
    })
    fireEvent.change(screen.getByTestId('changes-commit-files'), {
      target: { value: 'only a.ts' },
    })
    fireEvent.click(screen.getByTestId('changes-commit-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(expect.stringContaining('message=ship it'))
    expect(onConfirm).toHaveBeenCalledWith(expect.stringContaining('filesNote=only a.ts'))
  })

  it('uses unknown-branch label when branch is null', () => {
    render(
      <ChangesCommitDialog
        open
        branch={null}
        uncommittedPaths={[]}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByTestId('changes-commit-branch')).toHaveTextContent('(unknown-branch)')
  })
})
