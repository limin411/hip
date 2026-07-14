import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { resolve as pathResolve } from 'node:path'
import { normalizeSessionConfig, type SessionConfig } from '@hip/protocol'
import { connectSidecar } from '../sidecar/connect.js'
import { runTurn } from '../client/turn-runner.js'
import { StreamRenderer } from '../client/stream-renderer.js'
import type { HitlMode, PermissionModeCli, StreamMode } from '../types.js'

export interface ReplOpts {
  cwd?: string
  provider?: string
  model?: string
  baseURL?: string
  permissionMode?: PermissionModeCli
  disablePlan?: boolean
  hitl?: HitlMode
  stream?: StreamMode
  useUserHip?: boolean
  port?: number
  token?: string
  sidecarLog?: string
  systemPrompt?: string
}

/**
 * Interactive multi-turn REPL on one session (design PR9).
 * Commands: /exit /quit /help /id  — empty line ignored.
 */
export async function runRepl(opts: ReplOpts = {}): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write('hip repl requires a TTY\n')
    return 2
  }

  const cwd = pathResolve(opts.cwd ?? process.cwd())
  const provider = opts.provider ?? 'deepseek'
  const model = opts.model ?? 'deepseek-chat'
  const permissionMode = opts.permissionMode ?? 'edit'
  const disablePlan = opts.disablePlan ?? false
  const hitl: HitlMode = opts.hitl ?? 'prompt'
  const stream: StreamMode = opts.stream ?? 'all'

  const conn = await connectSidecar({
    useUserHip: opts.useUserHip !== false,
    allowNoKey: false,
    port: opts.port,
    token: opts.token,
    sidecarLog: opts.sidecarLog,
    sidecar: opts.port || opts.token || opts.sidecarLog ? 'auto' : 'spawn',
  })

  if (!conn.hasApiKey) {
    process.stderr.write('No API key configured (hip config auth-status). Exiting.\n')
    await conn.close()
    return 1
  }

  const sessionId = randomUUID()
  const config: SessionConfig = normalizeSessionConfig({
    llmProvider: provider,
    model,
    baseURL: opts.baseURL,
    tools: [],
    cwd,
    permissionMode,
    disablePlan,
    surface: 'code',
    useEventSource: true,
    enableStickyApproval: true,
    systemPrompt: opts.systemPrompt,
  })

  conn.client.send({ type: 'session:create', id: sessionId, config })
  // brief wait for create
  await new Promise((r) => setTimeout(r, 200))

  process.stdout.write(`hip repl  session=${sessionId.slice(0, 8)}…  cwd=${cwd}\n`)
  process.stdout.write(`model ${provider}/${model}  permission=${permissionMode}  hitl=${hitl}\n`)
  process.stdout.write('Type a message, or /help. Ctrl-C or /exit to quit.\n\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const question = (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, resolve)
    })

  let exitCode = 0
  try {
    for (;;) {
      const line = (await question('hip> ')).trim()
      if (!line) continue
      if (line === '/exit' || line === '/quit') break
      if (line === '/help') {
        process.stdout.write('Commands: /exit /quit /help /id\n')
        process.stdout.write('Otherwise: send a user turn to the agent.\n')
        continue
      }
      if (line === '/id') {
        process.stdout.write(`${sessionId}\n`)
        continue
      }

      const renderer = StreamRenderer.fromRunOpts({ stream, json: false })
      const userMessageId = randomUUID()
      try {
        const outcome = await runTurn({
          sessionId,
          userMessageId,
          prompt: line,
          hitl,
          maxPlanApprovals: 1,
          settleMs: 2000,
          deadlineAt: null,
          isTty: true,
          send: (m) => conn.client.send(m),
          subscribe: (h) => conn.client.onMessage(h),
          onTextDelta: (d) => renderer.onTextDelta(d),
          onTool: (i) => renderer.onTool(i),
          onAgent: (i) => renderer.onAgent(i),
          onReasoning: (d) => renderer.onReasoning(d),
          onInterrupt: (q, k) => {
            renderer.onInterrupt(q, k)
            // P0 REPL: auto-fail non-text HITL with message; full TTY approve later
            process.stderr.write('(interrupt — use hip run --hitl auto for unattended plan approve)\n')
          },
        })
        renderer.endText()
        if (outcome.status !== 'ok') {
          process.stderr.write(`[${outcome.status}] exit=${outcome.exitCode}\n`)
          for (const e of outcome.errors) process.stderr.write(`  ${e.code}: ${e.message}\n`)
        }
      } catch (err) {
        process.stderr.write(`[error] ${err instanceof Error ? err.message : String(err)}\n`)
        exitCode = 1
      }
      process.stdout.write('\n')
    }
  } finally {
    rl.close()
    try {
      conn.client.send({ type: 'session:destroy', sessionId })
    } catch {
      /* ignore */
    }
    await conn.close()
  }
  return exitCode
}
