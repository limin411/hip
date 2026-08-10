// packages/sidecar/src/session/sandbox/index.ts
// Sandbox facade (G4): `[sandbox] mode = off | auto | require` + argv builder.
// The launcher output is passed to the shell spawn path (spawnShell) so
// OS-level enforcement lands under the permission decision layer.
import type { PermissionMode } from '@hip/protocol'
import { deriveSandboxPolicy, type SandboxPolicy, type SandboxPolicyInput } from './policy.js'
import { buildSandboxArgv } from './launcher.js'

export { deriveSandboxPolicy, type SandboxPolicy, type SandboxPolicyInput } from './policy.js'
export { renderSeatbeltProfile, renderBwrapArgv, buildSandboxArgv } from './launcher.js'
export { classifySandboxViolation, type SandboxViolation, type SandboxViolationKind } from './violation.js'

export type SandboxMode = 'off' | 'auto' | 'require'

export interface SandboxRequest {
  /** Session cwd — writable root under 'edit'. */
  cwd: string
  permissionMode?: PermissionMode
  /** True when this execution is unattended (background / cron / --hitl auto). */
  unattended: boolean
  /** hip.toml [sandbox] mode. Default 'auto'. */
  mode?: SandboxMode
  readOnlyRoots?: string[]
  allowNetwork?: boolean
}

export type SandboxDecision =
  | { active: false; reason: 'off' | 'not-required' | 'unsupported' }
  | { active: true; kind: 'seatbelt' | 'bwrap'; argv: string[]; policy: SandboxPolicy }

/**
 * Decide whether a command must run inside the OS sandbox and build its argv.
 * - mode=require: always (unsupported platforms degrade to inactive).
 * - mode=auto: only unattended executions (background/cron/automation/hitl-auto).
 * - mode=off: never.
 */
export function decideSandbox(req: SandboxRequest): SandboxDecision {
  if (req.mode === 'off') return { active: false, reason: 'off' }
  if (req.mode !== 'require' && !req.unattended) {
    return { active: false, reason: 'not-required' }
  }
  const policy = deriveSandboxPolicy({
    permissionMode: req.permissionMode,
    cwd: req.cwd,
    readOnlyRoots: req.readOnlyRoots,
    allowNetwork: req.allowNetwork,
  })
  const kind =
    process.platform === 'darwin' ? ('seatbelt' as const) : process.platform === 'linux' ? ('bwrap' as const) : null
  if (!kind) return { active: false, reason: 'unsupported' }
  const probe = buildSandboxArgv('true', policy)
  if (!probe.ok) return { active: false, reason: 'unsupported' }
  return { active: true, kind, argv: probe.argv, policy }
}

/** Wrap a concrete command with the decided sandbox (or pass through). */
export function sandboxCommand(command: string, decision: SandboxDecision): string {
  if (!decision.active) return command
  const built = buildSandboxArgv(command, decision.policy)
  if (!built.ok) return command
  // argv → shell-escaped string for the `sh -c` spawn path.
  return built.argv.map((a) => (/^[A-Za-z0-9_./:=-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')
}
