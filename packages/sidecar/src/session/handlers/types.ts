import type {
  ClientMessage,
  ServerMessage,
  SessionConfig,
  FsEntry,
  AgentProfileInfo,
  SessionSummary,
  TrashedSessionSummary,
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
    deleteSession?(id: string, opts?: { deleteDerivedMemories?: boolean }): void
    setCustomTitle?(id: string, title: string): void
  } | null
}

/** Extended context for session lifecycle / turn / config handlers. */
export interface SessionLifecycleContext extends SessionManagerContext {
  /** Multi-client WS connection id for the current request (null when unknown). */
  connectionId?: string | null
  /** Multi-client client role for HITL resolve source. */
  connectionRole?: 'gui' | 'cli' | 'unknown' | null
  /** Terminal-context notes/ring tail pushed by the UI (D11); consumed by injectors. */
  setTerminalContext(sessionId: string, payload: { note?: string; ringTail?: string }): void
  getTerminalContext(sessionId: string): { note?: string; ringTail?: string } | undefined
  createSession(id: string, config: SessionConfig, send: SendFn): void
  destroySession(id: string): Promise<void>
  getSession(id: string): Session | undefined
  /**
   * Hard delete: store cascade + scratch + checkpoints + `session:deleted`.
   * Kept name for existing call sites / CLI.
   */
  deleteSessionSync(
    id: string,
    send: SendFn,
    opts?: { deleteDerivedMemories?: boolean; reason?: string },
  ): void
  /** Soft-delete into recycle bin: `session:trashed`; keeps SQLite rows + scratch. */
  softDeleteSessionSync(
    id: string,
    send: SendFn,
    opts?: { deleteDerivedMemories?: boolean; reason?: string },
  ): void
  /** Restore from recycle bin: `session:restored`. */
  restoreSessionSync(id: string, send: SendFn): void
  listTrashedSessions(): TrashedSessionSummary[]
  emptyTrashSync(send: SendFn): void
  purgeTrashSync(send: SendFn, retentionDays?: number): void
  /** True when session row exists and is soft-deleted. */
  isSessionTrashed(id: string): boolean
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
