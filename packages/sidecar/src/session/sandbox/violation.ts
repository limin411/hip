// packages/sidecar/src/session/sandbox/violation.ts
// Sandbox denial classification (G4): normalize seatbelt/bwrap denial output
// into typed violations with recovery guidance, so the agent loop can turn a
// denial into an actionable message (request allowlist / switch permission
// mode) instead of a confusing opaque error.

export type SandboxViolationKind = 'file_read' | 'file_write' | 'network' | 'unknown'

export interface SandboxViolation {
  kind: SandboxViolationKind
  /** Short machine-readable label. */
  label: string
  /** Human guidance for recovery. */
  guidance: string
}

const READ_PATTERNS = [
  /\bdeny\b.*\bfile-read/i,
  /\bdeny\b.*\bread-data/i,
  /\bOperation not permitted\b/i,
  /\bEACCES\b/,
]

const WRITE_PATTERNS = [
  /\bdeny\b.*\bfile-write/i,
  /\bdeny\b.*\bwrite-data/i,
  /\bRead-only file system\b/i,
  /\bEROFS\b/,
]

const NETWORK_PATTERNS = [
  /\bdeny\b.*\bnetwork/i,
  /\bnetwork-outbound\b/i,
  /\bConnection refused\b/i,
  /\bENETUNREACH\b/,
  /\bETIMEDOUT\b/,
]

/** Classify sandbox denial output (stdout+stderr combined). */
export function classifySandboxViolation(output: string): SandboxViolation {
  if (NETWORK_PATTERNS.some((p) => p.test(output))) {
    return {
      kind: 'network',
      label: 'network_denied',
      guidance:
        'The sandbox denied outbound network. If this tool needs network, allow it via network policy or run outside the sandbox (permission mode full / [sandbox] mode off).',
    }
  }
  if (WRITE_PATTERNS.some((p) => p.test(output))) {
    return {
      kind: 'file_write',
      label: 'write_denied',
      guidance:
        'The sandbox denied a file write outside the workspace root. Write only inside the project directory, or switch permission mode to full to allow writes anywhere.',
    }
  }
  if (READ_PATTERNS.some((p) => p.test(output))) {
    return {
      kind: 'file_read',
      label: 'read_denied',
      guidance:
        'The sandbox denied a file read outside allowed roots. Add the path to read-only roots (hip.toml [sandbox]) or switch permission mode to full.',
    }
  }
  return {
    kind: 'unknown',
    label: 'unknown_violation',
    guidance: 'The sandbox denied the operation. Check the command output above.',
  }
}
