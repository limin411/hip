// NOTE: demo/mock auth only — a real OAuth/IdP flow is a separate project.
import { create } from 'zustand'

const KEY = 'hip.authed'

interface AuthState {
  authed: boolean
  login: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  authed: localStorage.getItem(KEY) === '1',
  login: () => { localStorage.setItem(KEY, '1'); set({ authed: true }) },
  logout: () => { localStorage.removeItem(KEY); set({ authed: false }) },
}))
