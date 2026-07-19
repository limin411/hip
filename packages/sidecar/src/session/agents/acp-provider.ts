import type { AgentConfig, PermissionRequestPayload } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { AgentProvider, ExternalAgentHooks, PermissionChoice } from './types.js'
import type { ResolvedModel } from './registry.js'
import { acpConnections, type AcpConnection } from './acp-connection.js'
import { quirksFor } from './acp-quirks.js'
import type { FsBridgeContext } from './acp-fs-bridge.js'

function abortError(): Error { const e = new Error('aborted'); e.name = 'AbortError'; return e }

export class AcpAgentProvider implements AgentProvider {
  private conn: AcpConnection | null = null
  private acpSessionId: string | null = null
  private readonly quirks: ReturnType<typeof quirksFor>
  private currentHooks: ExternalAgentHooks | null = null
  /** Required before each runTurn — set by primary runner / invoker. */
  private turnCtx: FsBridgeContext | null = null
  /** Singleflight: concurrent dispose() awaits the same close. */
  private disposePromise: Promise<void> | null = null

  constructor(
    private readonly agent: AgentConfig,
    private readonly cwd: string,
    private readonly model: ResolvedModel | null,
    /** When set, reopen this prior ACP session via loadSession instead of newSession. */
    private resumeAcpSessionId: string | null = null,
  ) {
    this.quirks = quirksFor(this.agent.quirks)
  }

  /** Exposed so Session can persist the ACP session id after the first turn. */
  get sessionId(): string | null { return this.acpSessionId }

  /** Reopen a prior ACP session on the next turn (loadSession). No-op once a session is live. */
  setResumeSessionId(id: string | null): void { if (!this.acpSessionId) this.resumeAcpSessionId = id }

  /** Call immediately before each runTurn (primary runner + invoker). */
  setTurnFsContext(ctx: FsBridgeContext): void {
    this.turnCtx = ctx
  }

  private async ensureSession(): Promise<{ conn: AcpConnection; sid: string }> {
    // Recover from a warm-child death: if our connection died (and was evicted from the pool),
    // re-acquire a fresh one and drop the stale ACP session id so we recreate/reattach below.
    // Remember the prior session id as a resume target — OpenCode persists sessions, so a fresh
    // child can often loadSession() to reattach; if it can't, we fall back to a new session.
    if (!this.conn || this.conn.isClosed) {
      this.resumeAcpSessionId = this.acpSessionId ?? this.resumeAcpSessionId
      this.acpSessionId = null
      this.conn = await acpConnections.acquire(this.agent, this.model)
    }
    if (!this.acpSessionId) {
      if (this.resumeAcpSessionId) {
        try {
          await this.conn.loadSession(this.resumeAcpSessionId, this.cwd)
          this.acpSessionId = this.resumeAcpSessionId
        } catch {
          // Prior session not loadable on this child (never persisted / agent lacks resume) → start fresh.
          this.resumeAcpSessionId = null
          await this.openFreshSession()
        }
      } else {
        await this.openFreshSession()
      }
    }
    return { conn: this.conn, sid: this.acpSessionId! }
  }

  private async openFreshSession(): Promise<void> {
    const { sessionId, configOptions } = await this.conn!.newSessionWithOptions(this.cwd)
    this.acpSessionId = sessionId
    this.currentHooks?.configOptions(normalizeConfigOptions(configOptions))
  }

  async runTurn(text: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<void> {
    if (signal.aborted) throw abortError()
    // Consume turn context so each runTurn requires a fresh setTurnFsContext (no stale mode reuse).
    const turnCtx = this.turnCtx
    this.turnCtx = null
    if (!turnCtx) {
      throw new Error('AcpAgentProvider: setTurnFsContext required before runTurn')
    }
    this.currentHooks = hooks ?? null

    let aborted = false
    let conn: AcpConnection | null = null
    let sid: string | null = null
    // Register the abort handler BEFORE the (variable-latency) session setup — a warm child can be
    // mid-spawn/initialize, and an abort that fires during that window must not be lost.
    const onAbort = () => { aborted = true; if (conn && sid) void conn.cancel(sid) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const session = await this.ensureSession()
      conn = session.conn; sid = session.sid
      if (aborted) throw abortError() // aborted during session setup, before the prompt started

      conn.setFsContext(sid, turnCtx)

      conn.registerSink(sid, {
        onUpdate: (u) => this.applyUpdate(u, emit),
        onPermission: async (p) => {
          const choice = hooks
            ? await hooks.requestPermission({ requestId: p.toolCall?.toolCallId ?? `perm-${Date.now()}`, tool: mapTool(p.toolCall), options: p.options ?? [] })
            : ({ cancelled: true } as PermissionChoice)
          return 'optionId' in choice
            ? { outcome: { outcome: 'selected', optionId: choice.optionId } }
            : { outcome: { outcome: 'cancelled' } }
        },
      })

      await conn.prompt(sid, text)
      // Do NOT trust stopReason for cancellation (quirks.cancelReportsEndTurn): rely on our own flag.
      if (aborted) throw abortError()
    } finally {
      signal.removeEventListener('abort', onAbort)
      // Turn end: detach sink only — keep openSessions + sessionConfigOptions for multi-turn.
      if (conn && sid) conn.detachSink(sid)
    }
  }

  private applyUpdate(u: any, emit: GraphEmit): void {
    switch (u?.sessionUpdate) {
      case 'agent_message_chunk': { const t = textOf(u.content); if (t) emit.token(t); break }
      case 'agent_thought_chunk': { const t = textOf(u.content); if (t) emit.reasoning(t); break }
      case 'tool_call':
        emit.toolStarted(u.title ?? u.kind ?? 'tool', u.toolCallId, u.rawInput ?? u.kind ?? '')
        break
      case 'tool_call_update':
        if (u.status === 'completed' || u.status === 'failed') {
          const out = toolText(u.content) ?? (u.rawOutput !== undefined ? JSON.stringify(u.rawOutput) : undefined)
          emit.toolFinished(u.toolCallId, u.status === 'completed' ? 'finished' : 'error', out, u.status === 'failed' ? (out ?? 'error') : undefined)
        }
        break
      case 'plan': {
        // ACP Plan: complete list of entries with status — map to hip PlanItem[] for sticky checklist.
        const entries = Array.isArray(u.entries) ? u.entries : []
        const plan = entries
          .map((e: any) => ({
            content: String(e?.content ?? ''),
            status: mapPlanStatus(e?.status),
          }))
          .filter((e: { content: string }) => e.content.length > 0)
        if (plan.length) emit.planUpdated?.(plan)
        break
      }
      case 'config_option_update':
        this.currentHooks?.configOptions(normalizeConfigOptions(u.configOptions ?? []))
        break
    }
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.conn || !this.acpSessionId) return
    const res = await this.conn.setConfigOption(this.acpSessionId, configId, value)
    this.currentHooks?.configOptions(normalizeConfigOptions(res?.configOptions ?? []))
  }

  /** Settles after session/close (if advertised); does not kill the warm-pool child. */
  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposePromise = this.runDispose()
    return this.disposePromise
  }

  private async runDispose(): Promise<void> {
    if (this.conn && this.acpSessionId) {
      await this.conn.closeSession(this.acpSessionId)
    }
    this.acpSessionId = null
    // The connection stays warm for other conversations; the manager disposes it on shutdown.
    this.conn = null
  }
}

function textOf(content: any): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.type === 'text' ? (content.text ?? '') : ''
}
function toolText(content: any): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts = content.map((c) => (c?.type === 'content' ? textOf(c.content) : c?.type === 'diff' ? `--- ${c.path}\n${c.newText ?? ''}` : '')).filter(Boolean)
  return parts.length ? parts.join('\n') : undefined
}
function mapTool(tc: any): PermissionRequestPayload {
  const base = { title: tc?.title ?? tc?.kind ?? 'tool', kind: tc?.kind ?? 'other' }
  const content = tc?.content
  if (Array.isArray(content)) {
    const diffPart = content.find((c: any) => c?.type === 'diff')
    if (diffPart) return { ...base, diff: { path: diffPart.path, oldText: diffPart.oldText ?? '', newText: diffPart.newText ?? '' } }
    const text = toolText(content)
    if (text) return { ...base, content: text }
  }
  if (tc?.rawInput !== undefined) return { ...base, content: typeof tc.rawInput === 'string' ? tc.rawInput : JSON.stringify(tc.rawInput) }
  return base
}
function normalizeConfigOptions(opts: any[]): any[] {
  return (opts ?? []).filter((o) => o?.type === 'select').map((o) => ({
    id: o.id, name: o.name, category: o.category, currentValue: o.currentValue,
    options: (Array.isArray(o.options) ? o.options : []).map((x: any) => ({ value: x.value, name: x.name, description: x.description })),
  }))
}

function mapPlanStatus(status: unknown): 'pending' | 'in_progress' | 'completed' {
  if (status === 'completed' || status === 'done') return 'completed'
  if (status === 'in_progress' || status === 'in-progress' || status === 'active') return 'in_progress'
  return 'pending'
}
