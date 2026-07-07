import type { VerificationGate, VerificationGateKind } from '../verification-gate.js'
import { typecheckGate } from './typecheck-gate.js'
import { lintGate } from './lint-gate.js'
import { testGate } from './test-gate.js'
import { scriptGate } from './script-gate.js'

const builtins: Record<string, VerificationGate> = {
  typecheck: typecheckGate,
  lint: lintGate,
  test: testGate,
  script: scriptGate,
}

/** Resolve a gate by kind. Throws if unknown. */
export function resolveGate(kind: VerificationGateKind): VerificationGate {
  const gate = builtins[kind]
  if (!gate) throw new Error(`Unknown gate kind: ${kind}`)
  return gate
}

/** Register a custom gate (e.g. from a plugin). */
export function registerGate(gate: VerificationGate): void {
  builtins[gate.kind] = gate
}

/** List all registered gate kinds. */
export function listGates(): string[] {
  return Object.keys(builtins)
}
