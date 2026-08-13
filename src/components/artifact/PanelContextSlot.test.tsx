// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'artifact.panelSlot.uncommitted') return `Uncommitted · ${opts?.count}`
      if (key === 'artifact.panelSlot.uncommittedEmpty') return 'Uncommitted'
      if (key === 'artifact.panelSlot.commit') return `Commit · ${opts?.sha}`
      if (key === 'artifact.outline') return 'Outline'
      if (key === 'artifact.sources') return 'Sources'
      if (key === 'artifact.terminal') return 'Terminal'
      if (key === 'artifact.selectFileToPreview') return 'Select a file'
      if (key === 'artifact.copyArtifact') return 'Copy'
      if (key === 'artifact.downloadArtifact') return 'Download'
      if (key === 'contextMenu.filePreview.copyPath') return 'Copy path'
      if (key === 'artifact.terminalView.noCwd') return 'No project folder'
      if (key === 'artifact.terminalView.restart') return 'Restart'
      if (key === 'artifact.terminalView.close') return 'Close'
      return key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Copy: () => React.createElement('span', { 'data-testid': 'icon-copy' }),
  Download: () => React.createElement('span', { 'data-testid': 'icon-download' }),
  Check: () => React.createElement('span'),
  ChevronDown: () => React.createElement('span'),
  ExternalLink: () => React.createElement('span', { 'data-testid': 'icon-external-link' }),
  RotateCcw: () => React.createElement('span'),
  Power: () => React.createElement('span'),
  Sparkles: () => React.createElement('span'),
  GitCommitHorizontal: () => React.createElement('span'),
  GitBranch: () => React.createElement('span'),
  ArrowUpFromLine: () => React.createElement('span'),
  MoreHorizontal: () => React.createElement('span'),
}))

vi.mock('@/components/ui/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

let mockUi = {
  activeTab: 'files' as string,
  chatActiveTab: 'files' as string,
  selectedArtifactPath: null as string | null,
  diffViewMode: 'unified' as string,
  ignoreWhitespace: false,
  setDiffViewMode: vi.fn(),
  setIgnoreWhitespace: vi.fn(),
}
vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: typeof mockUi) => unknown) => sel(mockUi),
}))

let mockFsScope = { scopeId: 's1' as string | null, cwd: '/proj/hip', isDraft: false }
vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => mockFsScope,
}))

let mockPreview: {
  status: string
  path?: string
  content?: string
  encoding?: string
  mimeType?: string
} = { status: 'idle' }
const fsGetState = vi.fn(() => ({ setActive: vi.fn() }))
vi.mock('@/store/fsStore', () => {
  const useFsStore = Object.assign(
    (sel: (s: { bySession: Record<string, { preview: typeof mockPreview }> }) => unknown) =>
      sel({ bySession: { s1: { preview: mockPreview } } }),
    { getState: () => fsGetState() },
  )
  return { useFsStore }
})

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (sel: (s: {
    activeSessionId: string
    sessions: Array<{ id: string; status: string }>
  }) => unknown) =>
    sel({ activeSessionId: 's1', sessions: [{ id: 's1', status: 'idle' }] }),
}))

let mockMessages: unknown[] = []
vi.mock('@/domain', () => ({
  useActiveMessages: () => mockMessages,
  sessionService: {
    readFile: vi.fn(),
    readDraftFile: vi.fn(),
  },
}))

let mockDiff = {
  bySession: {
    s1: {
      isGitRepo: true,
      files: [] as Array<{ path?: string; additions: number; deletions: number }>,
      viewingCommitSha: null as string | null,
      base: 'head' as string,
      hasSessionStart: true,
    },
  },
}
vi.mock('@/store/diffStore', () => ({
  EMPTY_DIFF: { files: [], viewingCommitSha: null, base: 'head', hasSessionStart: false },
  useDiffStore: Object.assign(
    (sel: (s: typeof mockDiff) => unknown) => sel(mockDiff),
    {
      getState: () => ({
        setBase: vi.fn(),
        setCollapsed: vi.fn(),
      }),
    },
  ),
}))

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    requestDiff: vi.fn(),
    requestCheckpoints: vi.fn(),
  },
}))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="commit-modal">{children}</div> : null,
}))

vi.mock('@/components/command-palette/composerBridge', () => ({
  insertComposerText: vi.fn(() => true),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement('button', props, children),
}))

vi.mock('./terminalFeature', () => ({ CODE_TERMINAL: true }))

vi.mock('./codeTerminalController', () => ({
  useCodeTerminalControllerOptional: () => mockTerminalCtrl,
}))

let mockTerminalCtrl: {
  sessionId: string
  cwd?: string
  status: string
  closed: boolean
  bootKey: number
  restart: () => Promise<void>
  close: () => Promise<void>
  chooseFolder: () => Promise<void>
} | null = null

vi.mock('@/lib/renderedArtifacts', () => ({
  collectConversationArtifacts: () => mockArtifacts,
}))
let mockArtifacts: Array<{ path: string; name: string; kind: string }> = []

vi.mock('./ArtifactCard', () => ({
  iconFor: () => () => null,
}))

vi.mock('@/ipc/clipboard', () => ({
  copyText: vi.fn(() => Promise.resolve(true)),
}))

const { openWithDefaultApp } = vi.hoisted(() => ({
  openWithDefaultApp: vi.fn(async (..._args: unknown[]) => true),
}))

vi.mock('@/ipc/openPath', () => ({
  openWithDefaultApp: (...args: unknown[]) => openWithDefaultApp(...args),
}))

import { PanelContextSlot } from './PanelContextSlot'

describe('PanelContextSlot', () => {
  beforeEach(() => {
    cleanup()
    mockUi = {
      activeTab: 'files',
      chatActiveTab: 'files',
      selectedArtifactPath: null,
      diffViewMode: 'unified',
      ignoreWhitespace: false,
      setDiffViewMode: vi.fn(),
      setIgnoreWhitespace: vi.fn(),
    }
    mockFsScope = { scopeId: 's1', cwd: '/proj/hip', isDraft: false }
    mockPreview = { status: 'idle' }
    mockMessages = []
    mockArtifacts = []
    mockDiff = {
      bySession: {
        s1: {
          isGitRepo: true,
          files: [],
          viewingCommitSha: null,
          base: 'head',
          hasSessionStart: true,
        },
      },
    }
    mockTerminalCtrl = null
  })

  afterEach(() => cleanup())

  it('code files shows workspace basename when no preview', () => {
    render(<PanelContextSlot surface="code" />)
    expect(screen.getByTestId('panel-context-slot')).toBeInTheDocument()
    expect(screen.getByTestId('slot-files-identity')).toHaveTextContent('hip')
  })

  it('code files shows preview basename when ready', () => {
    mockPreview = {
      status: 'ready',
      path: '/proj/hip/src/App.tsx',
      content: 'x',
      encoding: 'utf-8',
    }
    render(<PanelContextSlot surface="code" />)
    expect(screen.getByTestId('slot-files-identity')).toHaveTextContent('App.tsx')
    expect(screen.getByTestId('slot-copy-content')).toBeInTheDocument()
  })

  it('code outline shows count', () => {
    mockUi = { ...mockUi, activeTab: 'outline' }
    mockMessages = [
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi' },
      { id: '3', role: 'user', content: 'again' },
    ]
    render(<PanelContextSlot surface="code" />)
    expect(screen.getByTestId('slot-outline-identity')).toHaveTextContent('Outline · 2')
  })

  it('code changes shows uncommitted summary and review actions', () => {
    mockUi = { ...mockUi, activeTab: 'changes' }
    mockDiff = {
      bySession: {
        s1: {
          isGitRepo: true,
          files: [
            { additions: 2, deletions: 1 },
            { additions: 1, deletions: 0 },
          ],
          viewingCommitSha: null,
          base: 'head',
          hasSessionStart: true,
        },
      },
    }
    render(<PanelContextSlot surface="code" />)
    expect(screen.getByTestId('slot-changes-identity')).toHaveTextContent('Uncommitted · 2')
    expect(screen.getByTestId('changes-review')).toBeInTheDocument()
    expect(screen.getByTestId('changes-base-toggle')).toBeInTheDocument()
  })

  it('chat sources shows count label', () => {
    mockUi = { ...mockUi, chatActiveTab: 'sources' }
    render(<PanelContextSlot surface="chat" />)
    expect(screen.getByTestId('slot-sources-identity')).toHaveTextContent('Sources')
  })

  it('chat files: HTML preview shows mode toggle + open-browser right of the artifact dropdown', async () => {
    mockArtifacts = [{ path: 'report.html', name: 'report.html', kind: 'html' }]
    mockPreview = {
      status: 'ready',
      path: 'report.html',
      content: '<p>hi</p>',
      mimeType: 'text/html',
      encoding: 'utf8',
    }
    const onHtmlModeChange = vi.fn()
    render(
      <PanelContextSlot
        surface="chat"
        htmlMode="render"
        onHtmlModeChange={onHtmlModeChange}
      />,
    )
    const switcher = screen.getByTestId('preview-artifact-name')
    expect(switcher).toHaveTextContent('report.html')
    const toggle = screen.getByTestId('preview-html-mode')
    const openBtn = screen.getByTestId('preview-html-open-browser')
    // Both live in the titlebar slot, right after the artifact switcher.
    expect(switcher.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.compareDocumentPosition(openBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByTestId('preview-html-mode-source'))
    expect(onHtmlModeChange).toHaveBeenCalledWith('source')

    fireEvent.click(openBtn)
    expect(openWithDefaultApp).toHaveBeenCalledWith('/proj/hip/report.html', { cwd: '/proj/hip' })
  })

  it('chat files: no HTML toggle when preview is not ready', () => {
    mockArtifacts = [{ path: 'report.html', name: 'report.html', kind: 'html' }]
    mockPreview = { status: 'loading' }
    render(<PanelContextSlot surface="chat" htmlMode="render" onHtmlModeChange={vi.fn()} />)
    expect(screen.queryByTestId('preview-html-mode')).toBeNull()
    expect(screen.queryByTestId('preview-html-open-browser')).toBeNull()
  })

  it('terminal slot shows cwd basename and controls', () => {
    mockUi = { ...mockUi, activeTab: 'terminal' }
    mockTerminalCtrl = {
      sessionId: 's1',
      cwd: '/Users/me/hip',
      status: 'running',
      closed: false,
      bootKey: 0,
      restart: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      chooseFolder: vi.fn(async () => {}),
    }
    render(<PanelContextSlot surface="code" />)
    expect(screen.getByTestId('terminal-cwd')).toHaveTextContent('hip')
    expect(screen.getByTestId('terminal-restart')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-close')).toBeInTheDocument()
  })
})
