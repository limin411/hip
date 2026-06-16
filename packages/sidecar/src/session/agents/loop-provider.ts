import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { ResolvedModel } from './registry.js'
import { parseRichLine, type RichEvent } from './adapters.js'
import type { AgentProvider } from './types.js'
export type { AgentProvider } from './types.js'

const RS = '\x1e'              // end-of-turn sentinel (ASCII record separator)
const KILL_GRACE_MS = 2000

function abortError(): Error {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}

/** Long-lived subprocess that multiplexes turns over stdin/stdout, framed by the RS sentinel. */
export class LoopAgentProvider implements AgentProvider {
  private child: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private stderrTail = ''
  private active: { emit: GraphEmit; signal: AbortSignal; onAbort: () => void; resolve: () => void; reject: (e: Error) => void } | null = null

  constructor(
    private readonly agent: AgentConfig,
    private readonly cwd: string,
    private readonly model: ResolvedModel | null,
  ) {}

  runTurn(text: string, emit: GraphEmit, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError())
    if (!this.child) this.child = this.spawnChild()
    this.buf = ''
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => { this.kill(); this.settle('reject', abortError()) }
      this.active = { emit, signal, onAbort, resolve, reject }
      signal.addEventListener('abort', onAbort, { once: true })
      const payload = this.agent.transport === 'rich'
        ? JSON.stringify({ type: 'user', text }) + '\n'
        : text + RS
      // If the child died without its exit handler having cleared this.child yet, the write throws
      // synchronously (EPIPE / ERR_STREAM_DESTROYED). Route it through settle so the abort listener
      // is removed (no leak) and the turn rejects with a descriptive error.
      try {
        this.child!.stdin.write(payload)
      } catch (err) {
        this.settle('reject', new Error(`failed to write to agent: ${err instanceof Error ? err.message : String(err)}`))
      }
    })
  }

  dispose(): void {
    // Reject any in-flight turn immediately rather than waiting up to KILL_GRACE_MS for the child's
    // exit to fire. settle is a no-op when this.active is null.
    this.settle('reject', abortError())
    this.kill()
  }

  private spawnChild(): ChildProcessWithoutNullStreams {
    // Model rollback: hip no longer pushes its model/key into CLI agents — they self-manage. The
    // `model` ctor param is retained only for the shared (agent, cwd, model) provider-factory signature.
    void this.model
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (this.agent.env) Object.assign(env, this.agent.env)
    const child = spawn(this.agent.command, this.agent.args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    // Guard every handler against a stale child: after an abort, the old child is SIGINT'd but
    // exits asynchronously, by which point a new child may already be current. A stale handler
    // must not clobber this.child / settle / append to buffers for the new turn.
    child.stdout.on('data', (chunk: string) => { if (child !== this.child) return; this.onStdout(chunk) })
    child.stderr.on('data', (chunk: string) => { if (child !== this.child) return; this.stderrTail = (this.stderrTail + chunk).slice(-2000) })
    child.on('error', (err) => { if (child !== this.child) return; this.settle('reject', new Error(`agent process error: ${err.message}`)) })
    child.on('exit', (code) => {
      if (child !== this.child) return
      this.child = null
      const tail = this.stderrTail.trim().slice(-500)
      this.settle('reject', new Error(`agent exited (code ${code ?? 'null'})${tail ? `: ${tail}` : ''}`))
    })
    return child
  }

  private onStdout(chunk: string): void {
    if (!this.active) return
    this.buf += chunk
    if (this.agent.transport === 'rich') {
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        const ev = parseRichLine(line)
        if (!ev) continue
        if (ev.kind === 'done') { this.settle('resolve'); return }
        this.applyRich(ev)
      }
    } else {
      const rs = this.buf.indexOf(RS)
      if (rs >= 0) {
        const text = this.buf.slice(0, rs)
        this.buf = this.buf.slice(rs + 1)
        if (text) this.active.emit.token(text)
        this.settle('resolve')
        return
      }
      if (this.buf) { this.active.emit.token(this.buf); this.buf = '' }
    }
  }

  private applyRich(ev: Exclude<RichEvent, { kind: 'done' }>): void {
    const emit = this.active!.emit
    switch (ev.kind) {
      case 'text': emit.token(ev.delta); break
      case 'reasoning': emit.reasoning(ev.delta); break
      case 'tool_start': emit.toolStarted(ev.name, ev.id, ev.input); break
      case 'tool_end': emit.toolFinished(ev.id, ev.ok ? 'finished' : 'error', ev.output, ev.ok ? undefined : (ev.output ?? 'error')); break
    }
  }

  private settle(how: 'resolve' | 'reject', err?: Error): void {
    const a = this.active
    if (!a) return
    this.active = null
    a.signal.removeEventListener('abort', a.onAbort)
    if (how === 'resolve') a.resolve()
    else a.reject(err ?? new Error('agent failed'))
  }

  private kill(): void {
    const c = this.child
    if (!c) return
    this.child = null
    // Detach all listeners so this (now dying) child can no longer fire any handler — belt-and-
    // suspenders with the per-handler `child !== this.child` guard, since handlers are also bound
    // to the local child const.
    c.removeAllListeners()
    try { c.kill('SIGINT') } catch { /* already gone */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL') } catch { /* gone */ } }, KILL_GRACE_MS)
    t.unref?.()
  }
}
