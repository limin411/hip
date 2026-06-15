import type { GraphEmit } from '../graph.js'
import type { AcpConfigOption, PermissionRequestPayload, PermissionOption } from '@hip/protocol'

export type PermissionChoice = { optionId: string } | { cancelled: true }

/** Out-of-band sinks an external provider may drive during a turn (beyond GraphEmit). */
export interface ExternalAgentHooks {
  /** Agent → client permission request; resolves with the user's choice. Blocks the agent's tool. */
  requestPermission(req: { requestId: string; tool: PermissionRequestPayload; options: PermissionOption[] }): Promise<PermissionChoice>
  /** Agent advertises/updates its session config selectors (model/mode). */
  configOptions(options: AcpConfigOption[]): void
}

/** A turn-level agent. The built-in agent stays inline in Session; this is the external seam. */
export interface AgentProvider {
  runTurn(text: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<void>
  dispose(): void
  /** ACP control-plane: switch the live model/mode. Optional (custom CLI agents omit it). */
  setConfigOption?(configId: string, value: string): Promise<void>
}
