import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { AgentProvider, ExternalAgentHooks, PermissionChoice } from './types.js'
import type { ResolvedModel } from './registry.js'
import { acpConnections, type AcpConnection } from './acp-connection.js'
import { quirksFor } from './acp-quirks.js'

function abortError(): Error { const e = new Error('aborted'); e.name = 'AbortError'; return e }

export class AcpAgentProvider implements AgentProvider {
  private conn: AcpConnection | null = null
  private acpSessionId: string | null = null
  private readonly quirks: ReturnType<typeof quirksFor>
  private currentHooks: ExternalAgentHooks | null = null

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

  private async ensureSession(): Promise<{ conn: AcpConnection; sid: string }> {
    if (!this.conn) this.conn = await acpConnections.acquire(this.agent, this.model)
    if (!this.acpSessionId) {
      if (this.resumeAcpSessionId) {
        await this.conn.loadSession(this.resumeAcpSessionId, this.cwd)
        this.acpSessionId = this.resumeAcpSessionId
      } else {
        const { sessionId, configOptions } = await this.conn.newSessionWithOptions(this.cwd)
        this.acpSessionId = sessionId
        this.currentHooks?.configOptions(normalizeConfigOptions(configOptions))
      }
    }
    return { conn: this.conn, sid: this.acpSessionId }
  }

  async runTurn(text: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<void> {
    if (signal.aborted) throw abortError()
    this.currentHooks = hooks ?? null
    const { conn, sid } = await this.ensureSession()

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

    let aborted = false
    const onAbort = () => { aborted = true; void conn.cancel(sid) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await conn.prompt(sid, text)
      // Do NOT trust stopReason for cancellation (quirks.cancelReportsEndTurn): rely on our own flag.
      if (aborted) throw abortError()
    } finally {
      signal.removeEventListener('abort', onAbort)
      conn.releaseSession(sid)
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

  dispose(): void {
    if (this.conn && this.acpSessionId) this.conn.releaseSession(this.acpSessionId)
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
function mapTool(tc: any) {
  return { title: tc?.title ?? tc?.kind ?? 'tool', kind: tc?.kind ?? 'other' }
}
function normalizeConfigOptions(opts: any[]): any[] {
  return (opts ?? []).filter((o) => o?.type === 'select').map((o) => ({
    id: o.id, name: o.name, category: o.category, currentValue: o.currentValue,
    options: (Array.isArray(o.options) ? o.options : []).map((x: any) => ({ value: x.value, name: x.name, description: x.description })),
  }))
}
