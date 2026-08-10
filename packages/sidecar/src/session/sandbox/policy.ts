// packages/sidecar/src/session/sandbox/policy.ts
// Sandbox requirement derivation (G4): permission profile + network policy →
// what the OS-level sandbox must allow. Pure and platform-neutral; rendering
// happens in launcher.ts. Fail-closed: anything not explicitly allowed is
// denied.
import type { PermissionMode } from '@hip/protocol'

export interface SandboxPolicyInput {
  /** Permission mode of the session ('edit' default, 'full' un-jails). */
  permissionMode?: PermissionMode
  /** Absolute cwd — the only writable root under 'edit'. */
  cwd: string
  /** Additional read-only roots (e.g. global skills dir). */
  readOnlyRoots?: string[]
  /** When true, network is allowed (otherwise denied). */
  allowNetwork?: boolean
}

export interface SandboxPolicy {
  /** Writable roots (absolute). */
  writeRoots: string[]
  /** Read-only roots (absolute). */
  readOnlyRoots: string[]
  /** True when outbound network is permitted. */
  allowNetwork: boolean
}

/**
 * Derive the sandbox requirement. 'full' permission mode keeps the sandbox
 * permissive (writes anywhere the user can); 'edit' restricts writes to cwd.
 * Never throws.
 */
export function deriveSandboxPolicy(input: SandboxPolicyInput): SandboxPolicy {
  const isFull = input.permissionMode === 'full'
  return {
    writeRoots: isFull ? ['/'] : [input.cwd],
    readOnlyRoots: [...(input.readOnlyRoots ?? [])],
    allowNetwork: input.allowNetwork === true,
  }
}
