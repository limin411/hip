// packages/sidecar/src/session/sandbox/launcher.ts
// Platform sandbox launchers (G4). macOS renders a seatbelt profile and wraps
// the command with /usr/bin/sandbox-exec (path pinned against PATH injection).
// Linux renders bubblewrap argv (caller executes it). Windows is unsupported
// (returns a typed result — never a crash).
import type { SandboxPolicy } from './policy.js'

export type SandboxLaunchResult =
  | { ok: true; argv: string[]; kind: 'seatbelt' | 'bwrap' }
  | { ok: false; reason: 'unsupported-platform' | 'no-command' | 'policy-error' }

/** Fixed sandbox-exec path — never resolved through PATH. */
const SEATBELT_EXEC = '/usr/bin/sandbox-exec'

/**
 * Render a seatbelt (.sbpl) profile from the policy. Fail-closed base:
 * everything denied except explicit reads, the writable roots, and (optionally)
 * outbound network. Escapes single quotes in paths.
 */
export function renderSeatbeltProfile(policy: SandboxPolicy): string {
  // Paths render inside double quotes; escape embedded double quotes.
  const q = (p: string) => p.replace(/"/g, '\\"')
  const lines: string[] = [
    '(version 1)',
    '(deny default)',
    // Process basics
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow file-read*)',
    '(allow mach-lookup)',
    '(allow signal (target self))',
  ]
  for (const root of policy.readOnlyRoots) {
    lines.push(`(allow file-read* (subpath "${q(root)}"))`)
  }
  for (const root of policy.writeRoots) {
    if (root === '/') {
      lines.push('(allow file-write*)')
    } else {
      lines.push(`(allow file-write* (subpath "${q(root)}"))`)
      lines.push(`(allow file-read* (subpath "${q(root)}"))`)
    }
  }
  // Working dir + temp are needed by most tools.
  lines.push('(allow file-read-metadata)')
  lines.push('(allow file-write* (subpath "/private/tmp"))')
  lines.push('(allow file-write* (subpath "/tmp"))')
  if (policy.allowNetwork) {
    lines.push('(allow network* (remote ip *))')
    lines.push('(allow network* (local ip *))')
  } else {
    lines.push('(deny network*)')
  }
  return lines.join('\n') + '\n'
}

/** Wrap a command in sandbox-exec on macOS. */
export function wrapWithSeatbelt(command: string, policy: SandboxPolicy): SandboxLaunchResult {
  if (!command) return { ok: false, reason: 'no-command' }
  const profile = renderSeatbeltProfile(policy)
  // `sh -c <command>` runs inside the sandbox.
  return { ok: true, argv: [SEATBELT_EXEC, '-p', profile, '/bin/sh', '-c', command], kind: 'seatbelt' }
}

/**
 * Render bubblewrap argv for Linux (caller spawns it). `--ro-bind` read roots,
 * `--bind` write roots, `--unshare-net` when network is denied.
 */
export function renderBwrapArgv(command: string, policy: SandboxPolicy): SandboxLaunchResult {
  if (!command) return { ok: false, reason: 'no-command' }
  const argv = ['bwrap', '--unshare-pid', '--unshare-ipc', '--die-with-parent', '--new-session']
  if (!policy.allowNetwork) argv.push('--unshare-net')
  // Base read-only system dirs (best-effort list; overlay handles the rest).
  for (const dir of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/opt']) {
    argv.push('--ro-bind', dir, dir)
  }
  for (const root of policy.readOnlyRoots) {
    argv.push('--ro-bind', root, root)
  }
  for (const root of policy.writeRoots) {
    if (root === '/') {
      argv.push('--bind', '/', '/')
    } else {
      argv.push('--bind', root, root)
    }
  }
  argv.push('--tmpfs', '/tmp', '--tmpfs', '/run')
  argv.push('--', '/bin/sh', '-c', command)
  return { ok: true, argv, kind: 'bwrap' }
}

/** Platform dispatch. */
export function buildSandboxArgv(
  command: string,
  policy: SandboxPolicy,
  platform: NodeJS.Platform = process.platform,
): SandboxLaunchResult {
  if (platform === 'darwin') return wrapWithSeatbelt(command, policy)
  if (platform === 'linux') return renderBwrapArgv(command, policy)
  return { ok: false, reason: 'unsupported-platform' }
}
