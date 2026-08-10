/** Harness ABI types — frozen schemaVersion 1 (see design 2026-07-14-hip-cli-design). */

export type HipRunStatus =
  | 'ok'
  | 'error'
  | 'invalid_args'
  | 'sidecar'
  | 'timeout'
  | 'cancelled'
  | 'hitl_blocked'
  | 'awaiting_user'

export type HitlMode = 'auto' | 'fail' | 'prompt'
export type StreamMode = 'text' | 'tools' | 'all' | 'none'
export type PermissionModeCli = 'chat' | 'edit' | 'full'
export type SidecarMode = 'spawn' | 'attach' | 'auto'
export type PresetName = 'harness' | 'interactive' | 'readonly'

export interface HipRunResult {
  schemaVersion: 1
  status: HipRunStatus
  exitCode: number
  sessionId: string
  hasApiKeyAtReady?: boolean
  turn?: {
    userMessageId: string
    assistantMessageId?: string
    stopped?: boolean
    completeCount?: number
  }
  text: string
  interrupt?: {
    question: string
    contextKind?: string
    contextRaw?: string
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /**
   * Per-step model-call timing (G2, optional, backward compatible): derived
   * from trace.jsonl loop.timing events. Absent on older sidecars / when
   * timing is disabled.
   */
  turnTiming?: Array<{
    step: number
    ttftMs: number
    ttfmMs: number
    totalMs: number
  }>
  tools: Array<{
    callId: string
    name: string
    status: 'finished' | 'error' | 'running'
    error?: string
  }>
  errors: Array<{ code: string; message: string }>
  timing: {
    startedAt: string
    finishedAt: string
    durationMs: number
  }
  config: {
    cwd: string
    provider: string
    model: string
    modelResolved?: string
    permissionMode: string
    disablePlan: boolean
    agentId?: string
    preset?: string
    hitl: HitlMode
  }
  git?: {
    isRepo: boolean
    dirtyBefore: boolean
    dirtyAfter?: boolean
    patchStatus: 'written' | 'skipped_not_repo' | 'skipped_no_git' | 'failed'
    patchError?: string
  } | null
  artifacts?: {
    dir?: string
    patch?: string
    diffSummary?: string
    trace?: string
    usage?: string
    result?: string
  }
}

export interface HipRunOptions {
  prompt?: string
  file?: string
  cwd?: string
  provider?: string
  model?: string
  baseURL?: string
  agent?: string
  permissionMode?: PermissionModeCli
  disablePlan?: boolean
  forcePlan?: boolean
  incognito?: boolean
  systemPrompt?: string
  timeoutSec?: number
  json?: boolean
  output?: string
  outDir?: string
  stream?: StreamMode
  preset?: PresetName
  hitl?: HitlMode
  sidecar?: SidecarMode
  port?: number
  token?: string
  sidecarLog?: string
  db?: 'file' | 'memory'
  useUserHip?: boolean
  keepUserHome?: boolean
  noParentWatch?: boolean
  maxPlanApprovals?: number
  allowNoKey?: boolean
  requireGit?: boolean
  /** Disable secret redaction in trace artifacts (default: redact). */
  traceRaw?: boolean
  /** When set, use this env instead of process.env (tests). */
  env?: NodeJS.ProcessEnv
}

export const STATUS_EXIT: Record<HipRunStatus, number> = {
  ok: 0,
  error: 1,
  invalid_args: 2,
  sidecar: 3,
  timeout: 4,
  hitl_blocked: 5,
  awaiting_user: 5,
  cancelled: 130,
}

export function exitForStatus(status: HipRunStatus): number {
  return STATUS_EXIT[status]
}

export function mapErrorCode(code: string): { status: HipRunStatus; exitCode: number } {
  const c = code.toUpperCase()
  if (c === 'TIMEOUT') return { status: 'timeout', exitCode: 4 }
  if (c === 'CANCELLED') return { status: 'cancelled', exitCode: 130 }
  if (
    c === 'HANDSHAKE_TIMEOUT' ||
    c === 'WS_AUTH_FAILED' ||
    c === 'SIDECAR_ENTRY_NOT_FOUND' ||
    c === 'SIDECAR_SPAWN_FAILED' ||
    c === 'WS_DISCONNECT' ||
    c === 'APP_NOT_RUNNING' ||
    c === 'DISCOVERY_INVALID' ||
    c === 'DISCOVERY_INSECURE'
  ) {
    return { status: 'sidecar', exitCode: 3 }
  }
  return { status: 'error', exitCode: 1 }
}
