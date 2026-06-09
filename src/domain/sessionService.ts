// src/domain/sessionService.ts
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { Transport } from './transport'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import i18n from '@/i18n'

/** Map the current i18next language to one of the three SessionConfig-supported values. */
function currentLanguage(): 'en' | 'zh-CN' | 'zh-TW' {
  const l = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return l === 'zh-CN' || l === 'zh-TW' ? l : 'en'
}

export class SessionService {
  private readonly transport: Transport
  private readonly unsubscribe: () => void
  private readonly unsubStatus: () => void

  constructor(transport: Transport) {
    this.transport = transport
    this.unsubscribe = this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
    this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
  }

  dispose(): void {
    this.unsubscribe()
    this.unsubStatus()
  }

  async connect(): Promise<void> {
    try {
      await this.transport.connect()
    } catch (e) {
      console.error('[SessionService] connect failed', e)
      useDomainStore.getState().setConnection('error')
    }
  }

  reconnect(): void {
    void this.connect()
  }

  /** Stop the transport's connect/reconnect loop (e.g. on AppLayout unmount). */
  disconnect(): void {
    this.transport.disconnect()
  }

  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
    if (msg.type === 'ready') {
      this.transport.send({ type: 'session:list' })
      this.resyncActiveIfRunning()
    } else if (msg.type === 'fs:ls:result') {
      useFsStore.getState().setEntries(msg.sessionId, msg.path, msg.entries)
    } else if (msg.type === 'fs:read:result') {
      useFsStore.getState().setPreview(msg.sessionId, {
        status: 'ready', path: msg.path, content: msg.content, encoding: msg.encoding, mimeType: msg.mimeType, truncated: msg.truncated, error: msg.error,
      })
    } else if (msg.type === 'fs:lsCwd:result') {
      useFsStore.getState().setEntries(msg.cwd, msg.path, msg.entries)
    } else if (msg.type === 'fs:readCwd:result') {
      useFsStore.getState().setPreview(msg.cwd, {
        status: 'ready', path: msg.path, content: msg.content, encoding: msg.encoding, mimeType: msg.mimeType, truncated: msg.truncated, error: msg.error,
      })
    } else if (msg.type === 'message:complete') {
      // The agent may have written files this turn — re-pull every loaded dir + the open file.
      const fsState = useFsStore.getState().bySession[msg.sessionId]
      if (fsState) {
        for (const dir of Object.keys(fsState.entriesByDir)) this.transport.send({ type: 'fs:ls', sessionId: msg.sessionId, path: dir })
        if (fsState.activePath) this.transport.send({ type: 'fs:read', sessionId: msg.sessionId, path: fsState.activePath })
      }
    }
  }

  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = nanoid()
    const enriched: SessionConfig = { ...config, language: currentLanguage() }
    useDomainStore.getState().createSession(id, enriched)
    this.transport.send({ type: 'session:create', id, config: enriched })
    return id
  }

  selectSession(id: string): void {
    useDomainStore.getState().selectSession(id)
    // Lazily fetch history the first time a summary-only session is opened.
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s && !s.loaded) this.transport.send({ type: 'session:load', sessionId: id })
  }

  deleteSession(id: string): void {
    useDomainStore.getState().deleteSession(id)
    this.transport.send({ type: 'session:delete', sessionId: id })
  }

  renameSession(id: string, title: string): void {
    useDomainStore.getState().renameSession(id, title)
    this.transport.send({ type: 'session:rename', sessionId: id, title })
  }

  setProjectDir(id: string, cwd: string): void {
    useDomainStore.getState().apply({ type: 'session:cwd', sessionId: id, cwd }) // optimistic
    useFsStore.getState().clearSession(id)
    this.transport.send({ type: 'session:setCwd', sessionId: id, cwd })
  }

  setThinking(id: string, thinking: boolean): void {
    useDomainStore.getState().apply({ type: 'session:thinking', sessionId: id, thinking }) // optimistic
    this.transport.send({ type: 'session:setThinking', sessionId: id, thinking })
  }

  lsDir(sessionId: string, path: string): void {
    this.transport.send({ type: 'fs:ls', sessionId, path })
  }

  readFile(sessionId: string, path: string): void {
    useFsStore.getState().setPreview(sessionId, { status: 'loading', path })
    this.transport.send({ type: 'fs:read', sessionId, path })
  }

  /** Start a fresh new-conversation draft (no committed session yet). */
  newConversation(): void {
    useDraftStore.getState().ensureDraft()
    useDomainStore.getState().deselect()
  }

  // Draft FS: fsStore is keyed by an arbitrary scope string — a committed session's
  // nanoid id, or (for an un-committed draft) its absolute cwd. The two never collide.
  /** List a directory for an un-committed draft (cwd-keyed, no session). */
  lsDraft(cwd: string, path: string): void {
    this.transport.send({ type: 'fs:lsCwd', cwd, path })
  }

  /** Read a file for an un-committed draft (cwd-keyed). Preview is keyed by cwd. */
  readDraftFile(cwd: string, path: string): void {
    useFsStore.getState().setPreview(cwd, { status: 'loading', path })
    this.transport.send({ type: 'fs:readCwd', cwd, path })
  }

  search(query: string): void {
    this.transport.send({ type: 'session:search', query })
  }

  sendMessage(content: string): void {
    const text = content.trim()
    if (!text) return
    let { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) {
      // Commit the draft: create a real (persisted) session, then send.
      const draft = useDraftStore.getState().draft
      const config: SessionConfig =
        draft?.mode === 'project' && draft.cwd ? { ...DEFAULT_CONFIG, cwd: draft.cwd } : DEFAULT_CONFIG
      activeSessionId = this.createSession(config)
      if (draft?.cwd) useFsStore.getState().clearSession(draft.cwd)
      useDraftStore.getState().reset()
    }
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text)
    this.transport.send({ type: 'message:send', sessionId: activeSessionId, id, content: text, role: 'user' })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }

  regenerate(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const sess = sessions.find((x) => x.id === activeSessionId)
    if (!sess || sess.status === 'running') return
    useDomainStore.getState().regenerateLastTurn(activeSessionId)
    this.transport.send({ type: 'message:regenerate', sessionId: activeSessionId })
  }

  /** On (re)connect, if the active session had an in-flight turn, force a history resync so a
   *  turn that finished/was interrupted during the outage is reconciled (see the session:loaded
   *  reducer). The resync REPLACES optimistic in-memory messages with the persisted truth: the
   *  user message is persisted before the turn runs (so it is never lost), and an unfinished
   *  assistant reply reconciles to "interrupted + retry" rather than a stuck spinner. */
  private resyncActiveIfRunning(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const s = sessions.find((x) => x.id === activeSessionId)
    if (s?.status === 'running') this.transport.send({ type: 'session:load', sessionId: activeSessionId })
  }
}

/** App singleton: connects to the live sidecar over WsTransport. */
export const sessionService = new SessionService(new WsTransport())
