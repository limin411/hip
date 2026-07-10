// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import React from 'react'
import type { Checkpoint } from '@hip/protocol'

const toastMessage = vi.fn()
vi.mock('sonner', () => ({
  toast: { message: (...args: unknown[]) => toastMessage(...args) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      const map: Record<string, string> = {
        'artifact.diffView.noSession': 'No session',
        'artifact.diffView.noSessionDesc': 'Open a conversation',
        'artifact.timelineView.empty': 'No checkpoints',
        'artifact.timelineView.emptyDesc': 'After a turn',
        'artifact.timelineView.sessionStart': 'Session start',
        'artifact.timelineView.turn': `Turn ${opts?.n ?? ''}`,
        'artifact.timelineView.modeThisTurn': 'This turn',
        'artifact.timelineView.modeSinceThen': 'Since then',
        'artifact.timelineView.modeSinceStart': 'Since start',
        'artifact.timelineView.noChange': 'No changes',
        'artifact.timelineView.revert': 'Revert to here',
        'artifact.timelineView.revertConfirmTitle': 'Revert to this checkpoint?',
        'artifact.timelineView.revertConfirmBody': 'Working tree will be restored.',
        'artifact.timelineView.revertConfirmAction': 'Revert',
        'artifact.timelineView.reverting': 'Reverting…',
        'artifact.timelineView.revertFailed': 'Revert failed',
        'artifact.timelineView.revertRetry': 'Retry',
        'artifact.timelineView.revertSuccess': 'Reverted successfully',
        'artifact.timelineView.revertBlockedRunning': 'Stop the run first',
        'artifact.timelineView.crossBranchWarn': `Cross branch ${opts?.branch ?? ''}`,
        'common.cancel': 'Cancel',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en' },
  }),
}))

vi.mock('lucide-react', () => ({
  GitCommit: () => React.createElement('span'),
  Loader2: () => React.createElement('span', { 'data-testid': 'loader' }),
  RotateCcw: () => React.createElement('span', { 'data-testid': 'icon-revert' }),
  AlertTriangle: () => React.createElement('span'),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...a: unknown[]) => a.filter(Boolean).join(' '),
}))

vi.mock('@/lib/datetime', () => ({
  formatRelativeTime: () => 'just now',
}))

vi.mock('@/lib/checkpointMode', () => ({
  checkpointModeOptions: () => ['this-turn', 'since-then', 'since-start'],
}))

vi.mock('./DiffDisplay', () => ({
  DiffDisplay: () => React.createElement('div', { 'data-testid': 'diff-display' }),
  Empty: ({ title }: { title: string }) => React.createElement('div', { 'data-testid': 'empty' }, title),
}))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
    onOpenChange,
  }: {
    open: boolean
    title: string
    children: React.ReactNode
    onOpenChange: (o: boolean) => void
  }) =>
    open
      ? React.createElement(
          'div',
          { 'data-testid': 'revert-modal', role: 'dialog' },
          React.createElement('h2', null, title),
          children,
          React.createElement('button', { 'data-testid': 'modal-dismiss', onClick: () => onOpenChange(false) }, 'x'),
        )
      : null,
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    'data-testid'?: string
  }) =>
    React.createElement(
      'button',
      { onClick, disabled, 'data-testid': rest['data-testid'] },
      children,
    ),
}))

const requestCheckpoints = vi.fn()
const requestCheckpointDiff = vi.fn()
const revertCheckpoint = vi.fn()
vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    requestCheckpoints: (...a: unknown[]) => requestCheckpoints(...a),
    requestCheckpointDiff: (...a: unknown[]) => requestCheckpointDiff(...a),
    revertCheckpoint: (...a: unknown[]) => revertCheckpoint(...a),
  },
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: { diffViewMode: string; checkpointMode: string; setCheckpointMode: () => void }) => unknown) =>
    sel({
      diffViewMode: 'unified',
      checkpointMode: 'this-turn',
      setCheckpointMode: vi.fn(),
    }),
}))

import { useDiffStore } from '@/store/diffStore'
import { useDomainStore } from '@/domain/sessionStore'
import { TimelineView } from './TimelineView'

function cp(id: string, extra: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id,
    sessionId: 's1',
    turnId: id.endsWith('start') ? null : 't1',
    kind: id.endsWith('start') ? 'start' : 'turn',
    label: null,
    treeSha: 'tree',
    commitSha: 'abc',
    createdAt: Date.now(),
    branch: 'main',
    ...extra,
  }
}

describe('TimelineView revert confirm', () => {
  beforeEach(() => {
    cleanup()
    toastMessage.mockClear()
    requestCheckpoints.mockClear()
    requestCheckpointDiff.mockClear()
    revertCheckpoint.mockClear()
    useDiffStore.setState({ bySession: {} })
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { llmProvider: 'x', model: 'y', tools: [] },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
          interrupt: null,
          codePanelOpen: false,
          chatPanelOpen: false,
        },
      ],
      activeSessionId: 's1',
    } as never)
    useDiffStore.getState().setCheckpoints('s1', [cp('s1:t1'), cp('s1:start', { kind: 'start' })], true, 'main')
    useDiffStore.getState().setActiveCheckpoint('s1', 's1:t1')
    useDiffStore.getState().setCheckpointDiffResult('s1', 's1:t1|this-turn', {
      state: 'ok',
      files: [],
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders checkpoint rows with revert buttons', () => {
    render(<TimelineView />)
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument()
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(2)
    expect(screen.getAllByTestId('timeline-revert')).toHaveLength(2)
    expect(requestCheckpoints).toHaveBeenCalledWith('s1')
  })

  it('opens confirm modal without calling revertCheckpoint', () => {
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    expect(screen.getByTestId('revert-modal')).toBeInTheDocument()
    expect(screen.getByText('Revert to this checkpoint?')).toBeInTheDocument()
    expect(revertCheckpoint).not.toHaveBeenCalled()
  })

  it('cancel closes modal without revert', () => {
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    fireEvent.click(screen.getByTestId('timeline-revert-cancel'))
    expect(screen.queryByTestId('revert-modal')).toBeNull()
    expect(revertCheckpoint).not.toHaveBeenCalled()
  })

  it('confirm calls revertCheckpoint once', () => {
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    fireEvent.click(screen.getByTestId('timeline-revert-confirm'))
    expect(revertCheckpoint).toHaveBeenCalledTimes(1)
    expect(revertCheckpoint).toHaveBeenCalledWith('s1', 's1:t1')
  })

  it('shows error on revert failure and allows retry', () => {
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    fireEvent.click(screen.getByTestId('timeline-revert-confirm'))
    act(() => {
      useDiffStore.getState().setLastRevertResult('s1', { checkpointId: 's1:t1', ok: false })
      useDiffStore.getState().setRevertError('s1', 'safety checkpoint failed')
    })
    expect(screen.getByTestId('timeline-revert-error')).toBeInTheDocument()
    expect(screen.getByTestId('revert-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('timeline-revert-confirm'))
    expect(revertCheckpoint).toHaveBeenCalledTimes(2)
  })

  it('closes modal and toasts on successful lastRevertResult', () => {
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    fireEvent.click(screen.getByTestId('timeline-revert-confirm'))
    act(() => {
      useDiffStore.getState().setLastRevertResult('s1', {
        checkpointId: 's1:t1',
        ok: true,
        safetyCheckpointId: 's1:pre-1',
      })
    })
    expect(screen.queryByTestId('revert-modal')).toBeNull()
    expect(toastMessage).toHaveBeenCalledWith('Reverted successfully')
  })

  it('shows cross-branch warning when checkpoint branch differs', () => {
    useDiffStore.getState().setCheckpoints(
      's1',
      [cp('s1:t1', { branch: 'feature' }), cp('s1:start', { kind: 'start' })],
      true,
      'main',
    )
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    expect(screen.getByTestId('timeline-revert-cross-branch')).toBeInTheDocument()
    expect(screen.getByText(/Cross branch feature/)).toBeInTheDocument()
  })

  it('blocks opening revert while session is running', () => {
    useDomainStore.setState((s) => ({
      ...s,
      sessions: s.sessions.map((sess) => (sess.id === 's1' ? { ...sess, status: 'running' as const } : sess)),
    }))
    render(<TimelineView />)
    fireEvent.click(screen.getAllByTestId('timeline-revert')[0])
    expect(screen.queryByTestId('revert-modal')).toBeNull()
    expect(revertCheckpoint).not.toHaveBeenCalled()
    expect(toastMessage).toHaveBeenCalledWith('Stop the run first')
  })
})
