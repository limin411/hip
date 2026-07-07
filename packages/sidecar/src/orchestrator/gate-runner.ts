/**
 * Gate runner — executes a `GateNode` within a `DurableExecutor` workflow.
 *
 * Resolves the gate implementation by `gateKind` via `resolveGate`,
 * then calls its `run` method with the provided `GateContext` (enriched
 * with the node's own `config`).
 */

import type { GateNode } from '@hip/protocol'
import type { GateContext, GateResult } from './verification-gate.js'
import { resolveGate } from './gates/index.js'

/**
 * Execute a `GateNode` within a workflow.
 *
 * @param node - The gate node from the workflow definition.
 * @param ctx  - The base gate context (cwd, sessionId, runId, optional config).
 * @returns    - The gate result (passed/failed, failures, suggestions).
 * @throws     - If `node.gateKind` is not a registered gate kind.
 */
export async function runGateNode(
  node: GateNode,
  ctx: GateContext,
): Promise<GateResult> {
  const gate = resolveGate(node.gateKind)
  return gate.run({ ...ctx, config: node.config })
}
