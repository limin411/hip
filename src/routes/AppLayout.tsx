import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { NewConversation } from '@/components/chat/NewConversation'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
import { TitleBar } from '@/components/layout/TitleBar'
import { SettingsPage } from '@/components/account/SettingsPage'
import { FloatingAvatarButton } from '@/components/account/FloatingAvatarButton'

export function AppLayout() {
  const navigate = useNavigate()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const logout = useAuthStore((s) => s.logout)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)

  useEffect(() => {
    if (!useProvidersStore.getState().loaded) {
      void useProvidersStore.getState().load().catch((err) => {
        console.error('Failed to load providers catalog (safety net):', err)
      })
    }
    sessionService.connect()
    return () => sessionService.disconnect()
  }, [])

  const codeOpen = activeView === 'code' && panelOpen
  const chatOpen = activeView === 'chat' && chatPanelOpen

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeSessionId == null ? (
            <NewConversation />
          ) : (
            <>
              <ChatPane />
              <InputBar />
            </>
          )}
        </div>

        {(codeOpen || chatOpen) && (
          <>
            <div className="group relative z-10 w-2 -mx-1 bg-transparent">
              <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent" />
            </div>
            <div className="w-[320px] shrink-0">
              {codeOpen ? <ArtifactPanel /> : <PreviewPanel />}
            </div>
          </>
        )}

        <FloatingAvatarButton
          onOpenSettings={() => setActiveView('settings')}
          onLogout={() => {
            logout()
            navigate('/login')
          }}
        />
      </div>

      {activeView === 'settings' && (
        <div className="absolute inset-0 z-20 bg-surface">
          <SettingsPage />
        </div>
      )}
    </div>
  )
}
