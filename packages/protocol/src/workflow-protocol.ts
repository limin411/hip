/** Agent orchestration foundation types (workflow DAG runtime). */
import type { AgentConfig } from './providers-agents.js'
import type { NodeId, WorkflowNode } from './orchestration-types.js'
export type { NodeId } from './orchestration-types.js'

export type AgentId = string

export interface AgentCapabilities {
  streamsReasoning: boolean
  toolCalls: boolean
  hitl: boolean        // 交互式权限往返 (ExternalAgentHooks.requestPermission)
  modelSwitch: boolean // 实时换模型 (setConfigOption)
}

export interface AgentDescriptor {
  id: AgentId
  name: string
  kind: AgentConfig['kind'] // 'custom' | 'opencode' | 'acp'
  capabilities: AgentCapabilities
}

export interface AgentNode {
  id: NodeId
  type: 'agent'
  agentId: AgentId
  /** 含 {{nodeId}} / {{input}} / {{input.key}} 占位,引用上游产物或运行输入。 */
  inputTemplate: string
}

export interface EdgeCondition { kind: 'always' | 'contains' | 'equals'; value?: string }
export interface WorkflowEdge { from: NodeId; to: NodeId; when?: EdgeCondition } // when 省略=always

export interface WorkflowDef {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entry: NodeId[]
}

export type NodeStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
export interface NodeOutput { text: string; data?: unknown }
export interface NodeRunState { status: NodeStatus; output?: NodeOutput; error?: string }
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface RunState {
  runId: string
  workflowId: string
  status: RunStatus
  nodes: Record<NodeId, NodeRunState>
}

export type OrchestratorEvent =
  | { type: 'run:started' }
  | { type: 'node:started'; nodeId: NodeId }
  | { type: 'node:succeeded'; nodeId: NodeId; output: NodeOutput }
  | { type: 'node:failed'; nodeId: NodeId; error: string }
  | { type: 'node:skipped'; nodeId: NodeId }
  | { type: 'run:cancelled' }
  | { type: 'run:finished'; status: RunStatus }
