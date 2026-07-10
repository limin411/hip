import type {
  ClientMessage,
  ServerMessage,
  SessionConfig,
  FsEntry,
  AgentProfileInfo,
  SessionSummary,
  SearchHit,
  Message,
} from '@hip/protocol'
import type { Session } from '../session.js'
import type * as workspaceFs from '../workspace-fs.js'

export type SendFn = (msg: ServerMessage) => void

/** Minimal surface that domain handlers need from SessionManager. */
export interface SessionManagerContext {
  ensureSession(id: string, send: SendFn): Session
  lsCwd(cwd: string, path: string): Promise<{ entries?: FsEntry[]; error?: string }>
  readCwd(cwd: string, path: string): Promise<workspaceFs.PreviewResult>
  profileListFor(session: Session): AgentProfileInfo[]
  store?: {
    updateConfig(id: string, config: string): void
    getDb?(): import('../../persistence/sqlite.js').DatabaseSync
    listSessions?(): SessionSummary[]
    getSession?(id: string): { config: string } | undefined
    loadMessagesWithRuns?(id: string): Message[]
    search?(query: string): SearchHit[]
    deleteSession?(id: string): void
    setCustomTitle?(id: string, title: string): void
  } | null
}

/** Extended context for session lifecycle / turn / config handlers. */
export interface SessionLifecycleContext extends SessionManagerContext {
  createSession(id: string, config: SessionConfig, send: SendFn): void
  destroySession(id: string): Promise<void>
  getSession(id: string): Session | undefined
  /** Synchronous delete: store + memory + scratch (+ best-effort checkpoint cleanup). */
  deleteSessionSync(id: string, send: SendFn): void
  listSessions(): SessionSummary[]
  loadSession(id: string): { messages: Message[]; config?: SessionConfig }
  searchSessions(query: string): SearchHit[]
  setCustomTitle(id: string, title: string): string
  setGlobalActiveModel(providerID: string, modelID: string, baseURL: string): void
  applyActiveModelToAll(): void
  hasApiKey(providerID: string): boolean
  forEachSession(fn: (session: Session) => void): void
}

export type ClientMsg = ClientMessage
export type { SessionConfig }
