import type { StreamMode } from '../types.js'
import { streamToStderr } from './json-channel.js'

export interface StreamRendererOpts {
  mode: StreamMode
  /** When true ( --json without --output ), assistant text goes to stderr. */
  jsonForcesTextToStderr: boolean
  textStream?: NodeJS.WritableStream
  metaStream?: NodeJS.WritableStream
}

/**
 * Human-readable turn streaming per Harness ABI §B.
 * Does not emit HipRunResult JSON (json-channel owns that).
 */
export class StreamRenderer {
  private readonly mode: StreamMode
  private readonly textOut: NodeJS.WritableStream
  private readonly metaOut: NodeJS.WritableStream
  private textStarted = false

  constructor(opts: StreamRendererOpts) {
    this.mode = opts.mode
    const textDefault = opts.jsonForcesTextToStderr ? process.stderr : process.stdout
    this.textOut = opts.textStream ?? textDefault
    this.metaOut = opts.metaStream ?? process.stderr
  }

  static fromRunOpts(opts: { stream?: StreamMode; json?: boolean; output?: string }): StreamRenderer {
    const mode = opts.stream ?? 'text'
    return new StreamRenderer({
      mode,
      jsonForcesTextToStderr: streamToStderr(opts),
    })
  }

  get enabled(): boolean {
    return this.mode !== 'none'
  }

  onTextDelta(delta: string): void {
    if (this.mode !== 'text' && this.mode !== 'all') return
    if (!this.textStarted) this.textStarted = true
    this.textOut.write(delta)
  }

  onTool(info: { callId: string; name: string; phase: 'start' | 'finish'; error?: string }): void {
    if (this.mode !== 'tools' && this.mode !== 'all') return
    if (info.phase === 'start') {
      this.metaOut.write(`[tool] → ${info.name} (${info.callId})\n`)
    } else if (info.error) {
      this.metaOut.write(`[tool] ✗ ${info.name}: ${info.error}\n`)
    } else {
      this.metaOut.write(`[tool] ✓ ${info.name}\n`)
    }
  }

  onAgent(info: { phase: 'start' | 'finish'; agentId: string; role?: string }): void {
    if (this.mode !== 'all') return
    const mark = info.phase === 'start' ? '▶' : '■'
    this.metaOut.write(`[agent] ${mark} ${info.agentId}${info.role ? ` (${info.role})` : ''}\n`)
  }

  onReasoning(delta: string): void {
    if (this.mode !== 'all') return
    this.metaOut.write(delta)
  }

  onInterrupt(question: string, contextKind?: string): void {
    if (this.mode === 'none') return
    const kind = contextKind ? ` [${contextKind}]` : ''
    this.metaOut.write(`\n[interrupt]${kind} ${question}\n`)
  }

  onMeta(line: string): void {
    if (this.mode === 'none') return
    this.metaOut.write(line.endsWith('\n') ? line : line + '\n')
  }

  /** Ensure trailing newline after assistant text so shell prompt is clean. */
  endText(): void {
    if (this.textStarted && (this.mode === 'text' || this.mode === 'all')) {
      this.textOut.write('\n')
    }
  }
}
