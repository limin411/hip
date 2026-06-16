import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { childSystemPrompt } from './system-prompt.js'

export interface RunSubagentArgs {
  runner: ModelRunner
  root: string
  summarizer: Summarizer
  emit: GraphEmit
  signal: AbortSignal
  description: string
  childMaxSteps: number
}

/** Last assistant message's text content (string content, or joined text blocks). */
export function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!(m instanceof AIMessage)) continue
    if (typeof m.content === 'string') return m.content
    return m.content
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
      .map((b) => b.text)
      .join('')
  }
  return ''
}

/**
 * Run a depth-1 sub-agent to completion and return its final assistant text.
 *
 * - Child toolset = buildTools(root) with NO spawn closure → no `task` tool (depth-1, P3-D3).
 * - Shares the parent cwd (`root`) and the parent AbortSignal (cancel propagates into the child stream).
 * - Capped at `childMaxSteps` (independent of the parent MAX_STEPS).
 * - If the child would HITL-pause (status === 'awaiting_user'), it does NOT escalate: returns its
 *   partial assistant text with the pending question appended as context (P3-D3, no agent:interrupt).
 */
export async function runSubagent(args: RunSubagentArgs): Promise<string> {
  const { runner, root, summarizer, emit, signal, description, childMaxSteps } = args
  const tools = buildTools(root) // depth-1: no task tool
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(childSystemPrompt(description, root)), new HumanMessage(description)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = final.pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
