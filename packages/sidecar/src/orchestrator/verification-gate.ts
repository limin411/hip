/**
 * VerificationGate 接口定义
 * 可插拔验证门控: 在 agent 产出被执行前进行校验
 */

export interface GateContext {
  cwd: string
  sessionId: string
  runId: string
  config?: Record<string, unknown>
}

export interface GateFailure {
  message: string
  file?: string
  line?: number
  severity: 'error' | 'warning'
}

export interface GateResult {
  passed: boolean
  failures: GateFailure[]
  suggestions: string[]
  durationMs: number
}

export type VerificationGateKind = string

export interface VerificationGate {
  readonly kind: string
  readonly description: string
  run(ctx: GateContext): Promise<GateResult>
}
