import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'
import { normalizeSessionConfig, type SessionConfig } from '@hip/protocol'
import type { HipRunOptions, HipRunResult, HitlMode } from './types.js'
import { exitForStatus, mapErrorCode } from './types.js'
import { connectSidecar } from './sidecar/connect.js'
import { DiscoveryError } from './sidecar/discovery.js'
import type { SidecarConnection } from './sidecar/connect.js'
import { runTurn } from './client/turn-runner.js'
import { buildResult, emptyResult } from './client/result-builder.js'
import { emitResultJson } from './client/json-channel.js'
import { StreamRenderer } from './client/stream-renderer.js'
import { resolvePreset } from './presets.js'
import { captureGitAfter, captureGitBaseline } from './artifacts/git.js'
import { exportArtifacts, type TraceEvent } from './artifacts/export.js'

const DEFAULT_PROVIDER = 'deepseek'
const DEFAULT_MODEL = 'deepseek-chat'

function readPrompt(opts: HipRunOptions): string {
  if (opts.file) {
    return readFileSync(opts.file, 'utf8')
  }
  return (opts.prompt ?? '').trim()
}

/**
 * Programmatic entry: run one turn against the product sidecar (attach-only by default).
 * Dev isolation spawn requires HIP_CLI_DEV_SPAWN=1 and preset harness / --sidecar spawn.
 */
export async function runHip(opts: HipRunOptions = {}): Promise<HipRunResult> {
  const startedAt = Date.now()
  const preset = resolvePreset(opts.preset, opts)
  const cwd = pathResolve(opts.cwd ?? process.cwd())
  const provider = opts.provider ?? DEFAULT_PROVIDER
  const model = opts.model ?? DEFAULT_MODEL
  const permissionMode = preset.permissionMode
  const disablePlan = preset.disablePlan
  const hitl: HitlMode = preset.hitl
  const stream = opts.stream ?? preset.stream ?? 'text'
  const maxPlanApprovals = opts.maxPlanApprovals ?? 1
  const streamRenderer = StreamRenderer.fromRunOpts({ ...opts, stream })

  const baseMeta = {
    cwd,
    provider,
    model,
    permissionMode,
    disablePlan,
    hitl,
    preset: opts.preset,
    agentId: opts.agent,
    startedAt,
  }

  const prompt = readPrompt(opts)
  if (!prompt) {
    const result = emptyResult({
      ...baseMeta,
      status: 'invalid_args',
      errors: [{ code: 'INVALID_ARGS', message: 'prompt required (positional or --file)' }],
    })
    emitResultJson(result, opts)
    return result
  }

  if (hitl === 'prompt' && !process.stdin.isTTY && opts.preset === 'interactive') {
    const result = emptyResult({
      ...baseMeta,
      status: 'invalid_args',
      errors: [{ code: 'INVALID_ARGS', message: 'hitl=prompt requires a TTY' }],
    })
    emitResultJson(result, opts)
    return result
  }

  const gitBaseline = captureGitBaseline(cwd)
  if (opts.requireGit && (!gitBaseline.isRepo || gitBaseline.error === 'no_git')) {
    const result = emptyResult({
      ...baseMeta,
      status: 'invalid_args',
      errors: [
        {
          code: 'REQUIRE_GIT',
          message: gitBaseline.error === 'no_git' ? 'git binary not found' : 'cwd is not a git repository',
        },
      ],
    })
    emitResultJson(result, opts)
    return result
  }

  let conn: SidecarConnection | null = null
  const sessionId = randomUUID()
  const userMessageId = randomUUID()
  const childEnv = opts.env ?? process.env
  const trace: TraceEvent[] = []
  const pushTrace = (type: string, payload?: unknown) => {
    trace.push({ ts: new Date().toISOString(), type, payload })
  }

  const finalize = (result: HipRunResult): HipRunResult => {
    const gitAfter = captureGitAfter(cwd, gitBaseline, { outDir: opts.outDir })
    result.git = gitAfter.git
    if (opts.outDir) {
      // re-export with git fields filled
      result.artifacts = exportArtifacts({
        outDir: opts.outDir,
        result,
        trace,
        traceRaw: opts.traceRaw,
      })
      if (gitAfter.patch) result.artifacts.patch = gitAfter.patch
    }
    emitResultJson(result, opts)
    return result
  }

  try {
    // Product: discovery attach. Dev isolation: HIP_CLI_DEV_SPAWN=1 + sidecar spawn / harness.
    const wantDevSpawn =
      opts.sidecar === 'spawn' ||
      (opts.preset === 'harness' && process.env.HIP_CLI_DEV_SPAWN === '1') ||
      process.env.HIP_CLI_DEV_SPAWN === '1'
    const sidecarMode = wantDevSpawn ? 'spawn' : opts.sidecar === 'auto' ? 'auto' : 'attach'

    let hasApiKeyAtReady: boolean
    try {
      conn = await connectSidecar({
        sidecar: sidecarMode,
        port: opts.port,
        token: opts.token,
        sidecarLog: opts.sidecarLog,
        useUserHip: opts.useUserHip ?? !wantDevSpawn,
        allowNoKey: opts.allowNoKey,
        dbMemory: opts.db === 'memory' || wantDevSpawn,
        env: childEnv,
        noParentWatch: opts.noParentWatch,
        clientRole: 'cli',
      })
      hasApiKeyAtReady = conn.hasApiKey
      pushTrace(conn.spawned ? 'sidecar:spawn' : 'sidecar:attach', {
        hasApiKey: hasApiKeyAtReady,
        guiPresent: conn.guiPresent,
      })
    } catch (err) {
      const code =
        err instanceof DiscoveryError
          ? err.code
          : ((err as { code?: string }).code ?? 'APP_NOT_RUNNING')
      const mapped = mapErrorCode(code)
      const result = emptyResult({
        ...baseMeta,
        status: mapped.status,
        sessionId,
        hasApiKeyAtReady: false,
        errors: [{ code, message: err instanceof Error ? err.message : String(err) }],
      })
      result.exitCode = mapped.exitCode
      return finalize(result)
    }
    const client = conn.client

    const config: SessionConfig = normalizeSessionConfig({
      llmProvider: provider,
      model,
      baseURL: opts.baseURL,
      tools: [],
      cwd,
      agentId: opts.agent,
      permissionMode,
      disablePlan,
      forcePlan: opts.forcePlan ?? false,
      surface: 'code',
      useEventSource: true,
      enableStickyApproval: false,
      systemPrompt: opts.systemPrompt,
      incognito: opts.incognito ?? preset.incognito,
    })

    client.send({ type: 'session:create', id: sessionId, config })
    pushTrace('session:create', { sessionId, cwd, permissionMode, disablePlan })

    // Wait briefly for session:created (best-effort; send may proceed either way)
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        unsub()
        resolve()
      }, 2000)
      const unsub = client.onMessage((msg) => {
        if (msg.type === 'session:created' && msg.sessionId === sessionId) {
          clearTimeout(t)
          unsub()
          resolve()
        }
        if (msg.type === 'error') {
          clearTimeout(t)
          unsub()
          resolve()
        }
      })
    })

    const deadlineAt =
      opts.timeoutSec && opts.timeoutSec > 0 ? Date.now() + opts.timeoutSec * 1000 : null

    const outcome = await runTurn({
      sessionId,
      userMessageId,
      prompt,
      hitl,
      maxPlanApprovals,
      settleMs: 2000,
      deadlineAt,
      allowNoKey: opts.allowNoKey,
      guiPresent: conn.guiPresent,
      send: (m) => client.send(m),
      subscribe: (h) => client.onMessage(h),
      onTextDelta: (d) => streamRenderer.onTextDelta(d),
      onTool: (info) => streamRenderer.onTool(info),
      onAgent: (info) => streamRenderer.onAgent(info),
      onReasoning: (d) => streamRenderer.onReasoning(d),
      onInterrupt: (q, k) => streamRenderer.onInterrupt(q, k),
      onTrace: (type, payload) => pushTrace(type, payload),
    })

    streamRenderer.endText()

    if (outcome.hasApiKeyAtReady === undefined) outcome.hasApiKeyAtReady = hasApiKeyAtReady

    const result = buildResult({
      outcome,
      sessionId,
      opts,
      cwd,
      provider,
      model,
      permissionMode,
      disablePlan,
      hitl,
      startedAt,
    })
    return finalize(result)
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'ERROR'
    const mapped = mapErrorCode(code)
    const result = emptyResult({
      ...baseMeta,
      status: mapped.status === 'error' && code.includes('SIDECAR') ? 'sidecar' : mapped.status,
      sessionId,
      errors: [
        {
          code,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    })
    result.exitCode = mapped.exitCode
    if (result.status === 'error' && /SIDECAR|HANDSHAKE|WS_/.test(code)) {
      result.status = 'sidecar'
      result.exitCode = 3
    }
    return finalize(result)
  } finally {
    if (conn) {
      try {
        conn.client.send({ type: 'message:cancel', sessionId })
      } catch {
        /* ignore */
      }
      await conn.close()
    }
  }
}

export function exitCodeOf(result: HipRunResult): number {
  return result.exitCode ?? exitForStatus(result.status)
}
