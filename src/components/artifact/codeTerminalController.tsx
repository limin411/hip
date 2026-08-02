import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { ptyKill } from '@/ipc/pty'
import { useTerminalStore, type PtyStatus } from '@/store/terminalStore'

export type CodeTerminalController = {
  sessionId: string | null
  cwd: string | undefined
  status: PtyStatus
  closed: boolean
  bootKey: number
  restart: () => Promise<void>
  close: () => Promise<void>
  chooseFolder: () => Promise<void>
}

const CodeTerminalContext = createContext<CodeTerminalController | null>(null)

export function CodeTerminalProvider({ children }: { children: ReactNode }) {
  const sessionId = useActiveSessionId()
  const cwd = useActiveSession()?.config.cwd
  const status = useTerminalStore((s) =>
    sessionId ? (s.bySession[sessionId]?.status ?? 'idle') : 'idle',
  )

  const [bootKey, setBootKey] = useState(0)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    setClosed(false)
  }, [sessionId])

  const chooseFolder = useCallback(async () => {
    if (!sessionId) return
    const dir = await pickDirectory()
    if (!dir) return
    sessionService.setProjectDir(sessionId, dir)
  }, [sessionId])

  const restart = useCallback(async () => {
    if (!sessionId) return
    try {
      await ptyKill(sessionId)
    } catch {
      /* ok if already dead */
    }
    useTerminalStore.getState().clearSession(sessionId)
    setClosed(false)
    setBootKey((k) => k + 1)
  }, [sessionId])

  const close = useCallback(async () => {
    if (!sessionId) return
    try {
      await ptyKill(sessionId)
    } catch {
      /* ok if already dead */
    }
    useTerminalStore.getState().clearSession(sessionId)
    setClosed(true)
  }, [sessionId])

  const value = useMemo(
    () => ({
      sessionId,
      cwd,
      status,
      closed,
      bootKey,
      restart,
      close,
      chooseFolder,
    }),
    [sessionId, cwd, status, closed, bootKey, restart, close, chooseFolder],
  )

  return <CodeTerminalContext.Provider value={value}>{children}</CodeTerminalContext.Provider>
}

export function useCodeTerminalController(): CodeTerminalController {
  const ctx = useContext(CodeTerminalContext)
  if (!ctx) {
    throw new Error('useCodeTerminalController requires CodeTerminalProvider')
  }
  return ctx
}

export function useCodeTerminalControllerOptional(): CodeTerminalController | null {
  return useContext(CodeTerminalContext)
}
