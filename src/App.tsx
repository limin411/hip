import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { LoginScreen } from './routes/LoginScreen'
import { AppLayout } from './routes/AppLayout'
import { ProfileScreen } from './routes/ProfileScreen'
import { SettingsScreen } from './routes/SettingsScreen'
import { BillingScreen } from './routes/BillingScreen'
import { HelpScreen } from './routes/HelpScreen'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/app', element: <AppLayout /> },
  { path: '/profile', element: <ProfileScreen /> },
  { path: '/settings', element: <SettingsScreen /> },
  { path: '/billing', element: <BillingScreen /> },
  { path: '/help', element: <HelpScreen /> },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
