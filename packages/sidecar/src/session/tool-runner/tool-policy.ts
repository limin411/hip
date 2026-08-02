import type { PermissionMode } from '@hip/protocol'

export type RiskLevel = 'low' | 'medium' | 'high'

export type ApprovalKind = 'none' | 'self' | 'auto_allow' | 'ask'

export type ToolClassification = {
  risk: RiskLevel
  approval: ApprovalKind
}

export interface ToolPolicy {
  classify(toolName: string, mode: PermissionMode, registeredTools?: Set<string>): ToolClassification
}

export const READ_TOOLS = new Set([
  'read_file',
  'ls',
  'glob',
  'grep',
  'use_skill',
  'web_search',
  'web_fetch',
])

const WRITE_TOOLS = new Set(['write_file', 'edit_file'])

const PLAN_TOOLS = new Set(['write_todos'])

const SCRIPT_TOOLS = new Set(['run_script'])

const GIT_TOOLS = new Set([
  'git_commit',
  'git_create_branch',
  'git_switch_branch',
])

/** Tools that spawn or orchestrate sub-agents (medium risk; may run concurrently). */
export const DELEGATE_TOOLS = new Set([
  'task',
  'dispatch_agent',
  'task_batch',
  'task_retry',
  'task_stop',
  'task_output',
])

const MEDIUM_TOOLS = new Set(['generate_agent'])

const LOW_RISK_NONE: ToolClassification = { risk: 'low', approval: 'none' }
const MEDIUM_RISK_NONE: ToolClassification = { risk: 'medium', approval: 'none' }
const MEDIUM_RISK_ASK: ToolClassification = { risk: 'medium', approval: 'ask' }

export function defaultToolPolicy(opts: {
  selfGatedTools: Set<string>
}): ToolPolicy {
  const selfGated = opts.selfGatedTools

  return {
    classify(toolName: string, mode: PermissionMode, registeredTools?: Set<string>): ToolClassification {
      if (selfGated.has(toolName)) {
        if (mode === 'full') {
          return { risk: 'high', approval: 'auto_allow' }
        }
        return { risk: 'high', approval: 'self' }
      }

      if (READ_TOOLS.has(toolName) || PLAN_TOOLS.has(toolName)) {
        return LOW_RISK_NONE
      }

      if (
        WRITE_TOOLS.has(toolName) ||
        SCRIPT_TOOLS.has(toolName) ||
        GIT_TOOLS.has(toolName) ||
        MEDIUM_TOOLS.has(toolName) ||
        DELEGATE_TOOLS.has(toolName)
      ) {
        return MEDIUM_RISK_NONE
      }

      if (toolName.startsWith('mcp__')) {
        // MCP tools don't modify local files — auto-allow in all modes
        return { risk: 'medium', approval: 'auto_allow' }
      }

      if (registeredTools?.has(toolName)) {
        return MEDIUM_RISK_NONE
      }

      // Unknown tools don't modify local files — auto-allow in all modes
      return MEDIUM_RISK_NONE
    },
  }
}
