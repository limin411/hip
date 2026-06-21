/**
 * multi-agent-handoff — shared helpers + the multi-agent tools node.
 *
 * Extracted from multi-agent-graph.ts to keep the graph builder under the
 * 250-LOC ceiling. Owns:
 *   - The handoff tool name prefix and matching helpers.
 *   - `ctxOf` / `agentNodeName` — shared by the tools node (this file) and the
 *     agent node + routers (multi-agent-graph.ts).
 *   - `buildHandoffTool` — produces the schema'd tool the model calls; the
 *     tools node intercepts these calls by name and never actually invokes it.
 *   - `multiAgentToolsNode` — executes normal tools and emits
 *     `Command(goto, update)` for handoffs.
 *
 * Runtime dependency is one-way: multi-agent-graph.ts imports from this file.
 * The `import type` in the other direction is erased at compile time.
 */
import { Command, type LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { AgentProfile } from './agent-profile.js'
import type { MultiAgentCtx, MultiState, MultiUpdate } from './multi-agent-graph.js'

/** Prefix every handoff tool name shares. The tools node matches this to detect handoffs. */
export const HANDOFF_TOOL_PREFIX = 'handoff_to_'

/** Extract the per-invoke MultiAgentCtx from a LangGraph config. */
export function ctxOf(config: LangGraphRunnableConfig): MultiAgentCtx {
  const ctx = (config.configurable as { ctx?: MultiAgentCtx } | undefined)?.ctx
  if (!ctx) throw new Error('multi-agent graph invoked without configurable.ctx')
  return ctx
}

/** Map a profile id to its StateGraph node name. */
export function agentNodeName(profileId: string): string {
  return `agent_${profileId}`
}

/**
 * Build a handoff tool for a target profile. Its function is a placeholder —
 * the multi-agent tools node intercepts handoff calls by name and never
 * actually invokes this function. The tool exists so the model sees a
 * well-formed schema + description for each available handoff.
 */
export function buildHandoffTool(target: AgentProfile): StructuredToolInterface {
  const description = target.description
    ? `Hand off the conversation to the ${target.name} agent: ${target.description}.`
    : `Hand off the conversation to the ${target.name} agent.`
  return tool(
    async () => `Transferring to ${target.name}.`,
    {
      name: `${HANDOFF_TOOL_PREFIX}${target.id}`,
      description,
      schema: z.object({}).describe('No arguments; the handoff is unconditional.'),
    },
  )
}

/** Normalize a tool's invoke result into a string content for ToolMessage. */
export function toolMessageContent(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && 'content' in result) {
    const c = (result as { content?: unknown }).content
    if (typeof c === 'string') return c
    return JSON.stringify(c ?? result)
  }
  return JSON.stringify(result)
}

/**
 * Shared tools node. For each tool call in the trailing AIMessage:
 *   - handoff tool with a known target → record target, emit placeholder
 *     ToolMessage, then return `Command(goto=agent_<id>, update)` which both
 *     updates state and overrides the default post-tool edge.
 *   - handoff tool with an unknown target → emit error ToolMessage; the loop
 *     falls back to the same agent (no routing override).
 *   - normal tool → look up and invoke; capture output or error.
 */
export async function multiAgentToolsNode(
  state: MultiState,
  config: LangGraphRunnableConfig,
): Promise<Partial<MultiUpdate> | Command<unknown, MultiUpdate, string>> {
  const ctx = ctxOf(config)
  const last = state.messages[state.messages.length - 1] as AIMessage
  const calls = last.tool_calls ?? []
  if (calls.length === 0) return {}

  const out: BaseMessage[] = []
  const toolMap = new Map(ctx.tools.map((t) => [t.name, t]))
  const knownProfileIds = new Set(ctx.profiles.map((p) => p.id))
  let handoffTarget: string | undefined

  for (const call of calls) {
    const callId = call.id ?? call.name
    if (call.name.startsWith(HANDOFF_TOOL_PREFIX)) {
      const targetId = call.name.slice(HANDOFF_TOOL_PREFIX.length)
      if (!knownProfileIds.has(targetId)) {
        out.push(new ToolMessage({
          content: `Error: cannot hand off to unknown agent "${targetId}".`,
          tool_call_id: callId,
          name: call.name,
        }))
        continue
      }
      // Multiple handoffs in one batch: the LAST valid one wins.
      handoffTarget = targetId
      out.push(new ToolMessage({
        content: `Handing off to ${targetId}.`,
        tool_call_id: callId,
        name: call.name,
      }))
      continue
    }
    const t = toolMap.get(call.name)
    if (!t) {
      const errContent = `Error: tool "${call.name}" is not available.`
      out.push(new ToolMessage({ content: errContent, tool_call_id: callId, name: call.name }))
      ctx.emit.toolFinished(callId, 'error', undefined, errContent)
      continue
    }
    ctx.emit.toolStarted(call.name, callId, call.args)
    try {
      const result = await t.invoke(call.args as Record<string, unknown>)
      const content = toolMessageContent(result)
      out.push(new ToolMessage({ content, tool_call_id: callId, name: call.name }))
      ctx.emit.toolFinished(callId, 'finished', content)
    } catch (err) {
      const errMsg = (err as Error).message
      out.push(new ToolMessage({ content: `Error: ${errMsg}`, tool_call_id: callId, name: call.name }))
      ctx.emit.toolFinished(callId, 'error', undefined, errMsg)
    }
  }

  if (handoffTarget) {
    return new Command({
      update: { messages: out, activeAgent: handoffTarget },
      goto: agentNodeName(handoffTarget),
    })
  }
  return { messages: out }
}
