// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import i18n from '@/i18n'
import { PermissionModal } from './PermissionModal'
import * as domain from '@/domain'

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    useActiveSessionId: vi.fn(),
    useActivePendingPermission: vi.fn(),
    sessionService: { respondPermission: vi.fn() },
  }
})

const respondPermission = vi.mocked(domain.sessionService.respondPermission)

describe('PermissionModal', () => {
  beforeEach(async () => {
    cleanup()
    respondPermission.mockClear()
    await i18n.changeLanguage('zh-CN')
  })

  it('returns null when there is no pending permission', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue(null as any)
    const { container } = render(<PermissionModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the inline prompt and responds with the chosen option', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r1',
      tool: { title: 'Run tests', kind: 'shell' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow' }],
      agentFrame: null,
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-modal')).toBeInTheDocument()
    expect(screen.getByTestId('permission-prompt-slot')).toBeInTheDocument()
    // Non-modal: no dialog overlay / role=dialog
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('permission-option-allow'))
    expect(respondPermission).toHaveBeenCalledWith('s1', 'r1', { optionId: 'allow' })
  })

  it('shows subagent name when present', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r2',
      tool: { title: 'Edit', kind: 'edit_file' },
      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject' }],
      agentFrame: { name: 'SubAgent' },
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-subagent')).toHaveTextContent('SubAgent')
  })

  it('localizes parallel_worktrees options by optionId (EN, not sidecar CN)', async () => {
    await i18n.changeLanguage('en')
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r-pwt',
      tool: { title: '并行 Worktree', kind: 'parallel_worktrees' },
      options: [
        { optionId: 'n1', name: '隔离 1 路', kind: 'allow_once' },
        { optionId: 'n2', name: '并行 2 路（建议）', kind: 'allow_once' },
        { optionId: 'n3', name: '并行 3 路', kind: 'allow_once' },
        { optionId: 'n4', name: '并行 4 路', kind: 'allow_once' },
        { optionId: 'reject', name: '不要并行', kind: 'reject_once' },
      ],
      agentFrame: null,
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-option-n1')).toHaveTextContent('1 track')
    expect(screen.getByTestId('permission-option-n2')).toHaveTextContent('2 tracks')
    expect(screen.getByTestId('permission-option-n3')).toHaveTextContent('3 tracks')
    expect(screen.getByTestId('permission-option-n4')).toHaveTextContent('4 tracks')
    expect(screen.getByTestId('permission-option-reject')).toHaveTextContent("Don't parallelize")
    // Must not surface raw sidecar CN on EN locale
    expect(screen.queryByText('并行 2 路（建议）')).not.toBeInTheDocument()
    expect(screen.queryByText('不要并行')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('permission-option-n2'))
    expect(respondPermission).toHaveBeenCalledWith('s1', 'r-pwt', { optionId: 'n2' })
  })

  it('keeps server names for non-parallel permission kinds', async () => {
    await i18n.changeLanguage('en')
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r3',
      tool: { title: 'Shell', kind: 'shell' },
      options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }],
      agentFrame: null,
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-option-allow_once')).toHaveTextContent('Allow once')
  })
})
