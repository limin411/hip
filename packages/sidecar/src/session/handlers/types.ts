import type { ClientMessage, ServerMessage, SessionConfig, FsEntry, AgentProfileInfo } from '@hip/protocol'
import type { Session } from '../session.js'
import type * as workspaceFs from '../workspace-fs.js'

export type SendFn = (msg: ServerMessage) => void

/** Minimal surface that domain handlers need from SessionManager. */
export interface SessionManagerContext {
  ensureSession(id: string, send: SendFn): Session
  lsCwd(cwd: string, path: string): Promise<{ entries?: FsEntry[]; error?: string }>
  readCwd(cwd: string, path: string): Promise<workspaceFs.PreviewResult>
  profileListFor(session: Session): AgentProfileInfo[]
  store?: { updateConfig(id: string, config: string): void } | null
}

export type ClientMsg = ClientMessage
export type { SessionConfig }
