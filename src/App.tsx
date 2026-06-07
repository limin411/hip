import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { LoginScreen } from './routes/LoginScreen'
import { AppLayout } from './routes/AppLayout'
import { RequireAuth } from './routes/RequireAuth'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/app', element: <RequireAuth><AppLayout /></RequireAuth> },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
