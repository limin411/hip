// ──────────────────────────────────────────────────────────────────
// Agent team types — reusable team definitions with role assignments
// (Phase 3, Task 3.1)
// ──────────────────────────────────────────────────────────────────

/** Standard roles a team member can hold. */
export type TeamRole = 'architect' | 'coder' | 'reviewer' | 'qa' | 'custom'

/** One agent assigned to a role within a team. */
export interface TeamMember {
  role: TeamRole
  /** References an AgentConfig.id (from the `[agents]` section). */
  agentId: string
  /** Free-text label when role is 'custom'. */
  customRole?: string
}

/** An ordered step in a team's execution pipeline. Each step maps to one
 *  WorkflowNode (AgentNode) when the team is run. */
export interface TeamPipelineStep {
  /** The role that should execute this step (matches a TeamMember.role). */
  role: string
  /** Override the member's agentId for this step. When omitted, uses the
   *  member whose role matches this step's role. */
  agentId?: string
  /** Template for the agent's input. Supports:
   *   - `{{input}}` — the team-level input
   *   - `{{<role>}}` — the output of the pipeline step that ran <role>
   *   - arbitrary static text mixed with the above placeholders.
   *  Resolved by the DAG orchestrator's resolveInput. */
  inputTemplate: string
}

/** A named, reusable team definition. */
export interface TeamConfig {
  id: string
  name: string
  description?: string
  /** Ordered list of team members (one per role). */
  members: TeamMember[]
  /** The execution pipeline — which steps run and in what order.
   *  Each step becomes an AgentNode in the generated WorkflowDef. */
  pipeline: TeamPipelineStep[]
}

/** Output from one completed pipeline step. */
export interface TeamStepOutput {
  role: string
  agentId: string
  status: 'succeeded' | 'failed' | 'skipped' | 'cancelled'
  output: string
  error?: string
}

/** Final result of a team run. */
export interface TeamResult {
  success: boolean
  outputs: TeamStepOutput[]
  /** Convenience: the last step's output text, or empty string if no step succeeded. */
  finalOutput: string
  stepCount: number
}
