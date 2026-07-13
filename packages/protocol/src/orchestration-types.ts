/** Workflow node identifier (shared with workflow-protocol). */
export type NodeId = string

// ── 编排模式 ──
/**
 * Per-session orchestration mode field (compat storage only).
 * @deprecated Product path ignores orchMode for turn routing (agent-driven orchestration).
 * Kept for session JSON / `session:setOrchMode` WS compatibility. Prefer explicit
 * `pendingWorkflowDef` / `workflow:run` for DAG. Historical meaning: 'fast' = ReAct,
 * 'dag' = workflow orchestrator — routing no longer keys off this.
 */
export type OrchestrationMode = 'fast' | 'dag'

// ── 并行合并策略 ──
/** How a ParallelNode resolves its children's results. */
export type MergeStrategy = 'all' | 'any' | 'vote'

// ── 验证门控类型 ──
/** Built-in verification gate kinds. 'script' runs an arbitrary shell command. */
export type VerificationGateKind = 'typecheck' | 'lint' | 'test' | 'script'

// ── 扩展的工作流节点类型 ──

/**
 * Execute a specific tool directly (not via LLM agent).
 * @deprecated Rejected by `validateWorkflow` (unsupported-node). No executor
 * launch path. Prefer agent tools. C-shrink may hard-delete this type after
 * the deprecate window.
 */
export interface ToolNode {
  type: 'tool'
  id: NodeId
  toolName: string
  /** Static input; supports {{nodeId}} / {{input}} templates. */
  inputTemplate: string
}

/**
 * Fan-out sub-DAGs that execute in parallel.
 * Fully supported: structural in validate; merge strategies (all/any/vote) in reduce.
 */
export interface ParallelNode {
  type: 'parallel'
  id: NodeId
  nodes: WorkflowNode[]
  mergeStrategy: MergeStrategy
}

/** A verification gate that must pass before downstream nodes execute. */
export interface GateNode {
  type: 'gate'
  id: NodeId
  gateKind: VerificationGateKind
  /** Gate-specific config (e.g. test command, lint rules). */
  config?: Record<string, unknown>
}

/**
 * Pause execution and require human input before continuing.
 * @deprecated Rejected by `validateWorkflow` (unsupported-node). No executor
 * launch path. Prefer ReAct planPause / agent:interrupt for HITL. C-shrink
 * may hard-delete this type after the deprecate window.
 */
export interface HumanNode {
  type: 'human'
  id: NodeId
  /** The question to present to the user. */
  question: string
  /** Optional timeout in ms. After timeout, the node is skipped. */
  timeoutMs?: number
}

/** The full workflow node union. AgentNode is imported from index.ts. */
export type WorkflowNode =
  | import('./index.js').AgentNode
  | ToolNode
  | ParallelNode
  | GateNode
  | HumanNode
