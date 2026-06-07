import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'

export function RequireAuth({ children }: { children: ReactNode }) {
  const authed = useAuthStore((s) => s.authed)
  return authed ? <>{children}</> : <Navigate to="/login" replace />
}
