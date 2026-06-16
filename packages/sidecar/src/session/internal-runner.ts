import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit, GraphCtx } from './graph.js'
import { buildGraph } from './graph.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { buildManagedAgentPrompt } from './system-prompt.js'
import { lastAiText } from './subagent.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { getActiveModel } from '../config/providers.js'
import type { Summarizer } from './compaction.js'
import type { ResolvedModel } from './agents/registry.js'

/** Keep only the tools whose name is in `allowed`. undefined ⇒ keep all (legacy-safe). */
export function filterTools(tools: StructuredToolInterface[], allowed?: string[]): StructuredToolInterface[] {
  if (!allowed) return tools
  const set = new Set(allowed)
  return tools.filter((t) => set.has(t.name))
}

export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
}

/**
 * Run an internal managed agent: hip's built-in ReAct loop with a custom persona prompt, a model of
 * the agent's choosing (or the global active model), and a tool allow-list. Depth-1 (no task/dispatch).
 * Streams every event through `emit` and returns the final assistant text.
 */
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const { resolved, cwd, prompt, allowedTools, task, emit, signal, childMaxSteps } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools (no task/dispatch closures → depth-1), then narrow to the allow-list.
  const tools = filterTools(buildTools(cwd, undefined, cwd), allowedTools)
  const toolNames = tools.map((t) => t.name)
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(buildManagedAgentPrompt({ cwd, persona: prompt, toolNames })), new HumanMessage(task)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = (final as { pendingQuestion?: string }).pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
