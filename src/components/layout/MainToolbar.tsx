import { useTranslation } from 'react-i18next'
import { Command } from 'lucide-react'
import { useActiveSession } from '@/domain'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore } from '@/store/uiStore'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { ConnectionStatus } from './ConnectionStatus'
import { PanelToggle } from './PanelToggle'

/**
 * Main-column context bar (not a window titlebar).
 * Special views hide ConnectionStatus + PanelToggle; leave via sidebar.
 * History keeps page h2 as sole title.
 */
export function MainToolbar() {
  const { t } = useTranslation()
  const handlePointerDown = useWindowDrag()
  const activeView = useUiStore((s) => s.activeView)
  const activeSession = useActiveSession()
  const kbMode = useKnowledgeStore((s) => s.mode)
  const kbSpaces = useKnowledgeStore((s) => s.spaces)
  const kbActiveSpaceId = useKnowledgeStore((s) => s.activeSpaceId)

  const isSpecial = activeView === 'settings' || activeView === 'history'
  const showPanelChrome = !isSpecial

  let title = ''
  if (activeView === 'settings') {
    title = t('settings.title')
  } else if (activeView === 'history') {
    title = '' // page keeps h2
  } else if (activeView === 'knowledge') {
    if (kbMode === 'workspace' && kbActiveSpaceId) {
      title = kbSpaces.find((s) => s.id === kbActiveSpaceId)?.name ?? t('knowledge.title')
    } else {
      title = t('knowledge.title')
    }
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
      aria-label={t('mainToolbar.aria')}
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3"
    >
      <div
        data-testid="main-toolbar-title"
        className="min-w-0 flex-1 truncate text-body font-medium text-ink"
      >
        {title}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          data-testid="main-toolbar-command-palette"
          data-tauri-drag-region="false"
          data-no-drag
          aria-label={t('commandPalette.openTriggerAria')}
          title={t('commandPalette.openTrigger')}
          onClick={() => useCommandPaletteStore.getState().setOpen(true)}
          className="flex size-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <Command size={16} aria-hidden />
        </button>
        {showPanelChrome ? (
          <>
            <ConnectionStatus />
            <PanelToggle />
          </>
        ) : null}
      </div>
    </header>
  )
}
