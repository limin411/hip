import type { HipRunOptions, HipRunResult, HipRunStatus, HitlMode } from '../types.js'
import { exitForStatus } from '../types.js'
import type { TurnRunnerOutcome } from './turn-runner.js'

export function emptyResult(partial: {
  status: HipRunStatus
  sessionId?: string
  cwd: string
  provider: string
  model: string
  permissionMode: string
  disablePlan: boolean
  hitl: HitlMode
  preset?: string
  agentId?: string
  errors?: HipRunResult['errors']
  hasApiKeyAtReady?: boolean
  startedAt: number
}): HipRunResult {
  const finishedAt = Date.now()
  const status = partial.status
  return {
    schemaVersion: 1,
    status,
    exitCode: exitForStatus(status),
    sessionId: partial.sessionId ?? '',
    hasApiKeyAtReady: partial.hasApiKeyAtReady,
    text: '',
    tools: [],
    errors: partial.errors ?? [],
    timing: {
      startedAt: new Date(partial.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - partial.startedAt,
    },
    config: {
      cwd: partial.cwd,
      provider: partial.provider,
      model: partial.model,
      permissionMode: partial.permissionMode,
      disablePlan: partial.disablePlan,
      agentId: partial.agentId,
      preset: partial.preset,
      hitl: partial.hitl,
    },
  }
}

export function buildResult(args: {
  outcome: TurnRunnerOutcome
  sessionId: string
  opts: HipRunOptions
  cwd: string
  provider: string
  model: string
  permissionMode: string
  disablePlan: boolean
  hitl: HitlMode
  startedAt: number
}): HipRunResult {
  const finishedAt = Date.now()
  return {
    schemaVersion: 1,
    status: args.outcome.status,
    exitCode: args.outcome.exitCode,
    sessionId: args.sessionId,
    hasApiKeyAtReady: args.outcome.hasApiKeyAtReady,
    turn: args.outcome.turn,
    text: args.outcome.text,
    interrupt: args.outcome.interrupt,
    usage: args.outcome.usage,
    tools: args.outcome.tools,
    errors: args.outcome.errors,
    timing: {
      startedAt: new Date(args.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - args.startedAt,
    },
    config: {
      cwd: args.cwd,
      provider: args.provider,
      model: args.model,
      permissionMode: args.permissionMode,
      disablePlan: args.disablePlan,
      agentId: args.opts.agent,
      preset: args.opts.preset,
      hitl: args.hitl,
    },
  }
}
