import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'
import { buildAcpSpawn } from './acp-config.js'

/** Per-ACP-session handlers, registered by the provider for the duration of a turn. */
export interface AcpSessionSink {
  onUpdate(update: any): void
  onPermission(req: any): Promise<{ outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } }>
}

/** One warm `<agent> acp` child + JSON-RPC connection, multiplexing many ACP sessions. */
export class AcpConnection {
  private child: ChildProcessWithoutNullStreams
  private conn: ClientSideConnection
  private initPromise: Promise<void> | null = null
  /** ACP sessions currently held open over this child (open/close lifecycle). */
  private readonly openSessions = new Set<string>()
  /** Turn-scoped routing sinks keyed by acp session id. */
  private readonly sinks = new Map<string, AcpSessionSink>()
  private refs = 0
  /** auth methods advertised at initialize(), reused for authenticate-on-demand (no re-init). */
  private authMethods: Array<{ id: string }> = []
  /** Tail of the child's stderr, kept for diagnostics on death. */
  private stderrTail = ''

  constructor(private readonly agent: AgentConfig, private readonly model: ResolvedModel | null) {
    const { command, args, env } = buildAcpSpawn(agent, model)
    this.child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.setEncoding('utf8')
    // Drain stderr — `setEncoding` alone does NOT put the stream in flowing mode, and an
    // unconsumed ~64KB pipe buffer would block the (verbose) child's stdout responses → deadlock.
    this.child.stderr.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-4000) })
    this.child.on('exit', () => this.handleClosed(new Error('acp agent process exited')))
    this.child.on('error', (err) => this.handleClosed(new Error(`acp agent process error: ${err.message}`)))
    this.conn = new ClientSideConnection(
      () => ({
        sessionUpdate: async (p: any) => { this.sinks.get(p.sessionId)?.onUpdate(p.update) },
        requestPermission: async (p: any) => {
          const sink = this.sinks.get(p.sessionId)
          if (!sink) return { outcome: { outcome: 'cancelled' } }
          return sink.onPermission(p)
        },
        readTextFile: async () => ({ content: '' }),
        writeTextFile: async () => ({}),
      }),
      ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>),
    )
  }

  get childPid(): number { return this.child.pid ?? -1 }
  /** Number of ACP sessions currently held open over this warm child. */
  get sessionCount(): number { return this.openSessions.size }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.conn
        .initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } })
        .then((r) => { this.authMethods = (r as { authMethods?: Array<{ id: string }> }).authMethods ?? [] })
    }
    return this.initPromise
  }

  /** Create a new ACP session (cwd-scoped). Authenticates on demand if the agent demands it. */
  async newSession(cwd: string): Promise<string> {
    await this.ensureInit()
    try {
      const r = await this.conn.newSession({ cwd, mcpServers: [] })
      this.openSessions.add(r.sessionId)
      return r.sessionId
    } catch (e: any) {
      if (this.isAuthRequired(e)) {
        await this.conn.authenticate({ methodId: this.firstAuthMethod() })
        const r = await this.conn.newSession({ cwd, mcpServers: [] })
        this.openSessions.add(r.sessionId)
        return r.sessionId
      }
      throw e
    }
  }

  async loadSession(acpSessionId: string, cwd: string): Promise<void> {
    await this.ensureInit()
    await this.conn.loadSession({ sessionId: acpSessionId, cwd, mcpServers: [] })
    this.openSessions.add(acpSessionId)
  }

  async newSessionWithOptions(cwd: string): Promise<{ sessionId: string; configOptions: any[] }> {
    await this.ensureInit()
    const r = await this.conn.newSession({ cwd, mcpServers: [] }) as { sessionId: string; configOptions?: any[] }
    this.openSessions.add(r.sessionId)
    return { sessionId: r.sessionId, configOptions: r.configOptions ?? [] }
  }

  registerSink(acpSessionId: string, sink: AcpSessionSink): void {
    if (!this.sinks.has(acpSessionId)) this.refs++
    this.sinks.set(acpSessionId, sink)
  }
  releaseSession(acpSessionId: string): void {
    if (this.sinks.delete(acpSessionId)) this.refs = Math.max(0, this.refs - 1)
    this.openSessions.delete(acpSessionId)
  }

  prompt(acpSessionId: string, text: string): Promise<{ stopReason: string }> {
    return this.conn.prompt({ sessionId: acpSessionId, prompt: [{ type: 'text', text }] }) as Promise<{ stopReason: string }>
  }
  cancel(acpSessionId: string): Promise<void> { return this.conn.cancel({ sessionId: acpSessionId }) as Promise<void> }
  setConfigOption(acpSessionId: string, configId: string, value: string): Promise<any> {
    return this.conn.setSessionConfigOption({ sessionId: acpSessionId, configId, value })
  }

  get isIdle(): boolean { return this.refs === 0 }
  dispose(): void { try { this.child.kill('SIGTERM') } catch { /* already dead */ } }

  private closed = false
  /** Set by the manager so a dead child evicts itself from the pool. */
  onClosed: (() => void) | null = null
  private handleClosed(_err: Error): void {
    if (this.closed) return
    this.closed = true
    this.sinks.clear()
    this.onClosed?.()
    // In-flight conn.prompt(...) promises reject on their own when the ndJson stream closes.
  }
  get isClosed(): boolean { return this.closed }

  private isAuthRequired(e: any): boolean {
    return !!(e && (e.data?.authRequired || /auth_required|authentication required/i.test(String(e.message ?? ''))))
  }
  private firstAuthMethod(): string {
    // Reuse the methods captured by ensureInit() (always called before newSession) — no re-initialize.
    return this.authMethods[0]?.id ?? 'login'
  }
}

/** Module-singleton pool: one AcpConnection per agent-config key, shared across hip Sessions. */
export class AcpConnectionManager {
  private readonly conns = new Map<string, AcpConnection>()

  private key(agent: AgentConfig, model: ResolvedModel | null): string {
    return JSON.stringify([agent.id, agent.boundModel ?? null, model ?? null, agent.command, agent.args, agent.env ?? null])
  }

  async acquire(agent: AgentConfig, model: ResolvedModel | null): Promise<AcpConnection> {
    const k = this.key(agent, model)
    let c = this.conns.get(k)
    if (c?.isClosed) { this.conns.delete(k); c = undefined }
    if (!c) {
      c = new AcpConnection(agent, model)
      c.onClosed = () => { if (this.conns.get(k) === c) this.conns.delete(k) }
      this.conns.set(k, c)
    }
    return c
  }

  disposeAll(): void { for (const c of this.conns.values()) c.dispose(); this.conns.clear() }
}

/** Process-wide pool. Disposed on sidecar shutdown (see main.ts). */
export const acpConnections = new AcpConnectionManager()
