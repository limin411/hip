import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { LoginScreen } from './routes/LoginScreen'
import { AppLayout } from './routes/AppLayout'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/app', element: <AppLayout /> },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
