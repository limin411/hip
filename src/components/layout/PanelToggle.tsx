import { useTranslation } from 'react-i18next'
import { Check, PanelRight, PanelRightClose } from 'lucide-react'
import { useActiveSessionId } from '@/domain'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useFocusStore } from '@/store/focusStore'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { CODE_TERMINAL } from '@/components/artifact/terminalFeature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'

type PanelTabOption = {
  value: ArtifactTab | ChatTab | 'knowledge-outline' | 'terminal-files'
  label: string
  gated?: boolean
}

export type PanelToggleSlot = 'toolbar' | 'panel'

/** Whether the shell right rail is open for the current view. */
export function useRightPanelOpen(): boolean {
  const activeView = useUiStore((s) => s.activeView)
  const knowledgePanelOpen = useUiStore((s) => s.knowledgePanelOpen)
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen)
  const kbMode = useKnowledgeStore((s) => s.mode)
  const focusedManagedId = useManagedTerminalStore((s) => s.focusedId)
  const activeSessionId = useActiveSessionId()
  const codePanelOpen = useDomainStore((s) =>
    activeSessionId ? s.sessions.find((x) => x.id === activeSessionId)?.codePanelOpen === true : false,
  )
  const chatPanelOpen = useDomainStore((s) =>
    activeSessionId ? s.sessions.find((x) => x.id === activeSessionId)?.chatPanelOpen === true : false,
  )

  if (activeView === 'knowledge') {
    return kbMode === 'workspace' && knowledgePanelOpen
  }
  if (activeView === 'terminals') {
    return TERMINAL_MANAGEMENT && !!focusedManagedId && terminalPanelOpen
  }
  if (activeView === 'code') return codePanelOpen
  if (activeView === 'chat') return chatPanelOpen
  return false
}

/**
 * Right-rail open/close + tab picker (collapsed toolbar only).
 *
 * Mirrors left sidebar chrome: when the rail is closed the control lives in the
 * main toolbar with a dropdown to open a specific tab; when open it relocates
 * to the panel titlebar as a one-click collapse. In-panel tab switching is the
 * titlebar {@link PanelTabBar} dropdown on the right edge.
 */
export function PanelToggle({ slot = 'toolbar' }: { slot?: PanelToggleSlot }) {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)
  const setChatActiveTab = useUiStore((s) => s.setChatActiveTab)
  const knowledgePanelOpen = useUiStore((s) => s.knowledgePanelOpen)
  const setKnowledgePanelOpen = useUiStore((s) => s.setKnowledgePanelOpen)
  const terminalPanelOpen = useUiStore((s) => s.terminalPanelOpen)
  const setTerminalPanelOpen = useUiStore((s) => s.setTerminalPanelOpen)
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
  const setSessionChatPanelOpen = useDomainStore((s) => s.setSessionChatPanelOpen)
  const resetChatActiveTab = useUiStore((s) => s.resetChatActiveTab)
  const kbMode = useKnowledgeStore((s) => s.mode)
  const kbActiveDocId = useKnowledgeStore((s) => s.activeDocId)
  const kbNodes = useKnowledgeStore((s) => s.nodes)
  const focusedManagedId = useManagedTerminalStore((s) => s.focusedId)
  const isGitRepo =
    useDiffStore((s) => (activeSessionId ? s.bySession[activeSessionId]?.isGitRepo : false)) ?? false
  const panelOpen = useRightPanelOpen()

  // Placement: toolbar only when collapsed; panel header only when expanded.
  if (slot === 'toolbar' && panelOpen) return null
  if (slot === 'panel' && !panelOpen) return null

  const collapse = () => {
    if (activeView === 'knowledge') {
      setKnowledgePanelOpen(false)
      return
    }
    if (activeView === 'terminals') {
      setTerminalPanelOpen(false)
      return
    }
    if (!activeSessionId) return
    if (activeView === 'code' || activeView === 'chat') {
      useFocusStore.getState().dismissPanelThisTurn()
    }
    if (activeView === 'code') {
      setSessionCodePanelOpen(activeSessionId, false)
    } else if (activeView === 'chat') {
      resetChatActiveTab()
      setSessionChatPanelOpen(activeSessionId, false)
    }
  }

  const triggerIcon = panelOpen ? (
    <PanelRightClose size={17} strokeWidth={1.75} />
  ) : (
    <PanelRight size={17} />
  )
  const triggerTitle = panelOpen ? t('artifact.closePanel') : t('chat.togglePanel')

  // Knowledge: no session required; show outline/canvas when a space workspace is open.
  if (activeView === 'knowledge') {
    if (kbMode !== 'workspace') return null
    const activeNode = kbNodes?.find((n) => n.id === kbActiveDocId)
    const isBoard =
      activeNode?.kind === 'board' ||
      (kbActiveDocId != null && kbActiveDocId.startsWith('brd_'))
    const knowledgePanelLabel = isBoard
      ? t('knowledge.board.panelTitle')
      : t('knowledge.outline.title')
    // Expanded: one-click collapse at the former X slot (single option surface).
    if (panelOpen) {
      return (
        <Button
          variant="ghost"
          size="icon"
          title={triggerTitle}
          data-tauri-drag-region="false"
          data-no-drag
          data-testid="knowledge-outline-panel-close"
          onClick={collapse}
          aria-expanded={true}
        >
          {triggerIcon}
        </Button>
      )
    }
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title={triggerTitle}
            data-tauri-drag-region="false"
            data-no-drag
            data-testid="toggle-panel"
            aria-expanded={false}
          >
            {triggerIcon}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="panel-tab-menu">
          <DropdownMenuItem
            onSelect={() => setKnowledgePanelOpen(true)}
            data-testid="panel-tab-knowledge-outline"
          >
            <span className="flex w-4 shrink-0 items-center justify-center">
              {knowledgePanelOpen ? <Check size={14} className="text-accent" /> : null}
            </span>
            {knowledgePanelLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Terminal management: files tree in the shell right rail (same chrome as chat/code/KB).
  // Only when a managed session is focused — HostLibrary landing has no files panel.
  if (activeView === 'terminals') {
    if (!TERMINAL_MANAGEMENT || !focusedManagedId) return null
    if (panelOpen) {
      return (
        <Button
          variant="ghost"
          size="icon"
          title={triggerTitle}
          data-tauri-drag-region="false"
          data-no-drag
          data-testid="terminal-files-panel-close"
          onClick={collapse}
          aria-expanded={true}
        >
          {triggerIcon}
        </Button>
      )
    }
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title={triggerTitle}
            data-tauri-drag-region="false"
            data-no-drag
            data-testid="toggle-panel"
            aria-expanded={false}
          >
            {triggerIcon}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="panel-tab-menu">
          <DropdownMenuItem
            onSelect={() => setTerminalPanelOpen(true)}
            data-testid="panel-tab-terminal-files"
          >
            <span className="flex w-4 shrink-0 items-center justify-center">
              {terminalPanelOpen ? <Check size={14} className="text-accent" /> : null}
            </span>
            {t('terminals.filesPanel')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (!activeSessionId) return null
  if (activeView !== 'code' && activeView !== 'chat') return null

  const isCode = activeView === 'code'

  const codeTabs: PanelTabOption[] = [
    { value: 'outline', label: t('artifact.outline') },
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'timeline', label: t('artifact.timeline'), gated: true },
    { value: 'changes', label: t('artifact.changes'), gated: true },
    ...(CODE_TERMINAL
      ? [{ value: 'terminal' as const, label: t('artifact.terminal') }]
      : []),
  ]
  const chatTabs: PanelTabOption[] = [
    { value: 'outline', label: t('artifact.outline') },
    { value: 'files', label: t('artifact.files') },
    { value: 'sources', label: t('artifact.sources') },
    { value: 'agents', label: t('artifact.agents') },
  ]

  const tabs = (isCode ? codeTabs : chatTabs).filter((tab) => !tab.gated || isGitRepo)
  const currentTab = isCode ? activeTab : chatActiveTab

  const onSelect = (value: ArtifactTab | ChatTab) => {
    // Collapsed toolbar only — panel is closed; open onto the chosen tab.
    if (isCode) {
      setTab(value as ArtifactTab)
      setSessionCodePanelOpen(activeSessionId, true)
    } else {
      setChatActiveTab(value as ChatTab)
      setSessionChatPanelOpen(activeSessionId, true)
    }
  }

  // Expanded multi-tab: one-click collapse only. Tabs live on PanelTabBar (right dropdown).
  if (panelOpen) {
    return (
      <Button
        variant="ghost"
        size="icon"
        title={triggerTitle}
        onClick={collapse}
        data-tauri-drag-region="false"
        data-no-drag
        data-testid="panel-collapse"
        aria-expanded={true}
      >
        <PanelRightClose size={17} strokeWidth={1.75} />
      </Button>
    )
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={triggerTitle}
          data-tauri-drag-region="false"
          data-no-drag
          data-testid="toggle-panel"
          aria-expanded={false}
        >
          {triggerIcon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="panel-tab-menu">
        {tabs.map((tab) => {
          const selected = currentTab === tab.value
          return (
            <DropdownMenuItem
              key={tab.value}
              onSelect={() => onSelect(tab.value as ArtifactTab | ChatTab)}
              data-testid={`panel-tab-${tab.value}`}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {selected ? <Check size={14} className="text-accent" /> : null}
              </span>
              {tab.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
