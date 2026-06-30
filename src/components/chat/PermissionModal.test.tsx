// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
  beforeEach(() => {
    cleanup()
    respondPermission.mockClear()
  })

  it('returns null when there is no pending permission', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue(null as any)
    const { container } = render(<PermissionModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the modal and responds with the chosen option', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r1',
      tool: { title: 'Run tests', kind: 'shell' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow' }],
      agentFrame: null,
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-modal')).toBeInTheDocument()
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
})
