import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { PanelLeft } from 'lucide-react'
import { useActiveSession } from '@/domain'
import { isMacPlatform } from '@/lib/platform'
import { getPath } from '@/domain/knowledge/tree'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore, type SettingsPageId } from '@/store/uiStore'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { cn } from '@/lib/utils'
import { ConnectionStatus } from './ConnectionStatus'
import { PanelToggle } from './PanelToggle'
import { titlebarIconBtnClass, titlebarIconProps, titlebarRowClass } from './titlebarChrome'
import { useCaptionTitleDoubleClick, WindowCaptionButtons } from './WindowCaptionButtons'

/** i18n key for the active settings category in the main toolbar title. */
function settingsPageTitleKey(
  page: SettingsPageId,
):
  | 'settings.general'
  | 'settings.voicePage'
  | 'settings.window'
  | 'settings.model'
  | 'settings.agentsLabel'
  | 'settings.mcpLabel'
  | 'settings.keyManagementLabel'
  | 'settings.skillLabel'
  | 'settings.pluginsLabel'
  | 'settings.hooksLabel'
  | 'settings.memoryLabel'
  | null {
  switch (page) {
    case 'general':
      return 'settings.general'
    case 'voice':
      return 'settings.voicePage'
    case 'window':
      return 'settings.window'
    case 'model':
      return 'settings.model'
    case 'agents':
      return 'settings.agentsLabel'
    case 'mcp':
      return 'settings.mcpLabel'
    case 'keyManagement':
      return 'settings.keyManagementLabel'
    case 'skill':
      return 'settings.skillLabel'
    case 'plugins':
      return 'settings.pluginsLabel'
    case 'hooks':
      return 'settings.hooksLabel'
    case 'memory':
      return 'settings.memoryLabel'
    default:
      return null
  }
}

/**
 * 知识库主区标题：`全部文档 › 目录 › 文件名`（替换固定「文档管理」/空间名）。
 * 浏览态显示当前目录路径；文档态显示文档路径；根/未知节点回退到根标签。
 */
function knowledgeContextTitle(
  t: TFunction,
  nodes: KnowledgeNode[],
  activeDocId: string | null,
  currentFolderId: string | null,
): string {
  const root = t('knowledge.home.mySpaces')
  const target = activeDocId ?? currentFolderId
  if (!target) return root
  const chain = getPath(nodes, target)
  if (chain.length === 0) return root
  return [root, ...chain.map((n) => n.title)].join(' › ')
}

/**
 * Main-column context bar (not a window titlebar).
 * Special views hide ConnectionStatus + PanelToggle; leave via sidebar.
 * History / recycle bin keep page h2 as sole title.
 * On Windows frameless chrome, hosts WindowCaptionButtons (min/max/close).
 * When the left sidebar is collapsed, hosts traffic-light inset + expand control
 * so top-left chrome stays aligned with macOS window controls.
 */
export function MainToolbar() {
  const { t } = useTranslation()
  const handlePointerDown = useWindowDrag()
  const handleTitleDblClick = useCaptionTitleDoubleClick()
  const activeView = useUiStore((s) => s.activeView)
  const overlay = useUiStore((s) => s.overlay)
  const settingsPage = useUiStore((s) => s.settingsPage)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const activeSession = useActiveSession()
  const kbNodes = useKnowledgeStore((s) => s.nodes)
  const kbActiveDocId = useKnowledgeStore((s) => s.activeDocId)
  const kbCurrentFolderId = useKnowledgeStore((s) => s.currentFolderId)
  const isMac = isMacPlatform()

  // Terminals keeps MainToolbar panel chrome (right-rail toggle) like chat/code/knowledge.
  // tasks / automation / settings stay chrome-light. History/trash remain modal shells.
  const settingsOpen = overlay === 'settings'
  const isSpecial =
    settingsOpen || activeView === 'automation' || activeView === 'tasks'
  const showPanelChrome = !isSpecial
  const showSidebarExpand = !sidebarOpen

  let title = ''
  if (settingsOpen) {
    title = t('settings.title')
    // Prefer the active category label when available.
    const pageKey = settingsPageTitleKey(settingsPage)
    if (pageKey) title = t(pageKey)
  } else if (activeView === 'automation') {
    title = t('sidebar.nav.automation')
  } else if (activeView === 'terminals') {
    title = t('sidebar.nav.terminals')
  } else if (activeView === 'tasks') {
    title = t('sidebar.nav.tasks')
  } else if (activeView === 'knowledge') {
    title = knowledgeContextTitle(t, kbNodes, kbActiveDocId, kbCurrentFolderId)
  } else if (activeSession) {
    title = activeSession.title
  } else {
    title = t('mainToolbar.newConversation')
  }

  return (
    <header
      data-testid="main-toolbar"
      data-tauri-drag-region
      onPointerDown={handlePointerDown}
      onDoubleClick={handleTitleDblClick}
      aria-label={t('mainToolbar.aria')}
      className={cn(
        titlebarRowClass,
        'gap-2 border-b-0 bg-surface-content',
        showSidebarExpand ? 'pr-3' : 'px-3',
      )}
    >
      {showSidebarExpand ? (
        <div
          className="flex h-full shrink-0 items-center gap-0.5"
          data-testid="main-toolbar-sidebar-chrome"
        >
          {isMac ? (
            <div
              className="h-full shrink-0"
              style={{ width: 'var(--titlebar-lights-inset, 90px)' }}
              aria-hidden
            />
          ) : (
            <div className="h-full w-2 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            data-testid="sidebar-toggle"
            data-tauri-drag-region="false"
            data-no-drag
            title={t('sidebar.expand')}
            aria-label={t('sidebar.expandAria')}
            aria-expanded={false}
            onClick={() => useUiStore.getState().setSidebarOpen(true)}
            className={titlebarIconBtnClass}
          >
            <PanelLeft {...titlebarIconProps} />
          </button>
        </div>
      ) : null}

      <div
        data-testid="main-toolbar-title"
        className="flex min-w-0 flex-1 items-center self-stretch"
      >
        <span className="min-w-0 truncate text-body font-medium leading-none text-ink">
          {title}
        </span>
      </div>

      <div className="flex h-full shrink-0 items-center gap-0.5">
        {showPanelChrome ? <ConnectionStatus /> : null}
        {showPanelChrome ? <PanelToggle /> : null}
      </div>
      <WindowCaptionButtons />
    </header>
  )
}
