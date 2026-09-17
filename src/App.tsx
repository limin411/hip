import { useEffect } from 'react'
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { useProvidersStore } from '@/store/providersStore'
import { useSkillsStore } from '@/store/skillsStore'
import { usePluginsStore } from '@/store/pluginsStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { resolveTrashRetentionDays } from '@/lib/trashRetention'

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
    // Automation trash purge is no longer triggered by the recycle bin (it only
    // lists sessions now), so expire stale entries once per launch. Load config
    // first — otherwise the first purge of a session would fall back to the
    // default retention instead of the user's.
    void useHipConfigStore
      .getState()
      .load()
      .then(() =>
        import('@/ipc/automations').then(({ purgeExpiredAutomationsTrash }) =>
          purgeExpiredAutomationsTrash(
            resolveTrashRetentionDays(
              useHipConfigStore.getState().config.trash?.retentionDays,
            ),
          ),
        ),
      )
      .catch(() => undefined)
  }, [])

  if (!providersLoaded) {
    return <LoadingScreen />
  }

  return <RouterProvider router={router} />
}

export default App
