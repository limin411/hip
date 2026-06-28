import { useEffect } from 'react'
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { useProvidersStore } from '@/store/providersStore'
import { useSkillsStore } from '@/store/skillsStore'
import { usePluginsStore } from '@/store/pluginsStore'
import { LoadingScreen } from '@/components/layout/LoadingScreen'
import { LoginScreen } from './routes/LoginScreen'
import { AppLayout } from './routes/AppLayout'
import { RequireAuth } from './routes/RequireAuth'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/app', element: <RequireAuth><AppLayout /></RequireAuth> },
])

function App() {
  const providersLoaded = useProvidersStore((s) => s.loaded)

  useEffect(() => {
    // Load the critical config/catalog before showing either login or the main UI.
    // This ensures model/agent data is available the moment the user can interact.
    useProvidersStore.getState().load().catch((err) => {
      console.error('Failed to load providers catalog:', err)
      // Even on failure, unblock the UI so the user sees login/settings and can retry.
      useProvidersStore.setState({ loaded: true })
    })
    // Pre-load non-critical settings data in the background so settings/skills/plugin
    // pages open instantly; we do not gate the UI on these.
    void useSkillsStore.getState().load().catch((err) => { console.error('Failed to preload skills:', err) })
    void usePluginsStore.getState().load().catch((err) => { console.error('Failed to preload plugins:', err) })
  }, [])

  if (!providersLoaded) {
    return <LoadingScreen />
  }

  return <RouterProvider router={router} />
}

export default App
