import { useEffect } from 'react'
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { useProvidersStore } from '@/store/providersStore'
import { useSkillsStore } from '@/store/skillsStore'
import { usePluginsStore } from '@/store/pluginsStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { LoadingScreen } from '@/components/layout/LoadingScreen'
import { AppLayout } from './routes/AppLayout'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/login', element: <Navigate to="/app" replace /> },
  { path: '/app', element: <AppLayout /> },
])

function App() {
  const providersLoaded = useProvidersStore((s) => s.loaded)

  useEffect(() => {
    // Load the critical config/catalog before showing the main UI.
    // This ensures model/agent data is available the moment the user can interact.
    void useProvidersStore.getState().load().catch((err) => {
      console.error('Failed to load providers catalog:', err)
      // Even on failure, unblock the UI so the user sees settings and can retry.
      useProvidersStore.setState({ loaded: true })
    })
    // Pre-load non-critical settings data in the background so settings/skills/plugin
    // pages open instantly; we do not gate the UI on these.
    void useSkillsStore.getState().load().catch((err) => {
      console.error('Failed to preload skills:', err)
      useSkillsStore.setState({ loaded: true })
    })
    void usePluginsStore.getState().load().catch((err) => {
      console.error('Failed to preload plugins:', err)
      usePluginsStore.setState({ loaded: true })
    })
    // Early knowledge list hydrate so sidebar space count is not empty until first
    // Knowledge enter. Idempotent with enterKnowledge / KnowledgePage loadSpaces.
    void useKnowledgeStore.getState().loadSpaces().catch((err) => {
      console.error('Failed to preload knowledge spaces:', err)
      useKnowledgeStore.setState({ loaded: true })
    })
    // Early trash badge hydrate (knowledge + work items + automations).
    // Session trash is requested on WS `ready` via serverMessageEffects.
    void import('@/ipc/knowledge')
      .then(({ knowledgeListTrash }) => knowledgeListTrash())
      .then((items) =>
        import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
          useTrashBadgeStore.getState().setKnowledgeCount(items.length)
        }),
      )
      .catch(() => undefined)
    void import('@/ipc/workItems')
      .then(({ listWorkItemsTrash }) => listWorkItemsTrash())
      .then((items) =>
        import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
          useTrashBadgeStore.getState().setWorkItemCount(items.length)
        }),
      )
      .catch(() => undefined)
    void import('@/ipc/automations')
      .then(({ listAutomationsTrash }) => listAutomationsTrash())
      .then((items) =>
        import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
          useTrashBadgeStore.getState().setAutomationCount(items.length)
        }),
      )
      .catch(() => undefined)
  }, [])

  if (!providersLoaded) {
    return <LoadingScreen />
  }

  return <RouterProvider router={router} />
}

export default App
