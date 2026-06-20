import type { ServerMessage, SessionConfig, AgentRole, WorkflowDef, OrchestratorEvent } from '@hip/protocol'
import type { TraceRun } from './tool-trace.js'
import { IdleWatchdog } from './idle-watchdog.js'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { runWorkflow } from '../orchestrator/executor.js'
import { createSessionAgentRunner } from './orchestrator-adapter.js'
import { runSubagent } from './subagent.js'
import { CHILD_MAX_STEPS } from './loop-control.js'
import type { OrchestratorEventSink, AgentRunner } from '../orchestrator/ports.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { SessionStore } from '../persistence/store.js'

type SendFn = (msg: ServerMessage) => void

export interface WorkflowRunDeps {
  id: string
  config: SessionConfig
  modelRunner: () => ModelRunner
  summarizer: () => Summarizer
  invokerFactory: (cwd: string) => AgentInvoker
  store: SessionStore | undefined
  idleTimeoutMs: number
  pendingPermissions: Map<string, (c: { optionId: string } | { cancelled: true }) => void>
  orchestratorRunner?: AgentRunner
}

export async function runWorkflowTurn(
  deps: WorkflowRunDeps,
  def: WorkflowDef,
  send: SendFn,
  finalize: (send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean) => string,
): Promise<string> {
  const abortController = new AbortController()
  deps.orchestratorRunner = undefined // local ref for mutation
  let timedOut = false
  const watchdog = new IdleWatchdog(deps.idleTimeoutMs, () => { timedOut = true; abortController.abort() })

  const turnId = `asst-supervisor-${Date.now()}`
  const trajectory = new Map<string, TraceRun>()
  let agentSeq = 0
  const started = new Set<string>()

  const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string) => {
    if (started.has(agentId)) return
    started.add(agentId)
    trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    send({ type: 'agent:started', sessionId: deps.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
  }

  const ensureFinished = (agentId: string, output: string) => {
    if (!started.has(agentId)) return
    const r = trajectory.get(agentId)
    if (r) { r.output = output; r.finishedAt = Date.now() }
    started.delete(agentId)
    send({ type: 'agent:finished', sessionId: deps.id, turnId, agentId })
  }

  const finishRemaining = () => {
    for (const id of started) {
      const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
      send({ type: 'agent:finished', sessionId: deps.id, turnId, agentId: id })
    }
    started.clear()
  }

  let runner: AgentRunner
  if (deps.orchestratorRunner) {
    runner = deps.orchestratorRunner
  } else {
    const cwd = deps.config.cwd ?? process.cwd()
    runner = createSessionAgentRunner(
      cwd,
      deps.invokerFactory,
      async (input: string, signal: AbortSignal): Promise<string> => {
        return runSubagent({
          runner: deps.modelRunner(),
          root: deps.config.cwd ?? process.cwd(),
          summarizer: deps.summarizer(),
          emit: { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {} },
          signal,
          description: input,
          childMaxSteps: CHILD_MAX_STEPS,
          permissionMode: 'full',
          requestApproval: undefined,
        })
      },
    )
    deps.orchestratorRunner = runner
  }

  const eventSink: OrchestratorEventSink = {
    emit(e: OrchestratorEvent) {
      switch (e.type) {
        case 'node:started':
          ensureStarted(e.nodeId, 'worker', 'supervisor')
          break
        case 'node:succeeded':
          ensureFinished(e.nodeId, e.output.text)
          break
        case 'node:failed':
          ensureFinished(e.nodeId, `Error: ${e.error}`)
          break
        case 'node:skipped':
          ensureFinished(e.nodeId, '(skipped)')
          break
        case 'run:cancelled':
          abortController.abort()
          break
        case 'run:started':
        case 'run:finished':
          break
      }
    },
  }

  try {
    const runState = await runWorkflow(def, { agentRunner: runner, eventSink }, { runId: turnId, signal: abortController.signal })
    finishRemaining()

    const outputs = Object.values(runState.nodes)
      .filter((n) => n.status === 'succeeded' && n.output)
      .map((n) => n.output!)
    let finalText: string
    if (outputs.length === 0) {
      finalText = '(workflow completed)'
    } else if (outputs.length === 1) {
      finalText = outputs[0].text
    } else {
      const rawTexts = outputs.map((o) => o.text)
      const fallback = rawTexts.join('\n\n')
      try {
        finalText = await runSubagent({
          runner: deps.modelRunner(),
          root: deps.config.cwd ?? process.cwd(),
          summarizer: deps.summarizer(),
          emit: { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {} },
          signal: abortController.signal,
          description: `You are an aggregator. Merge these subagent results into one coherent summary:\n\n${rawTexts.join('\n\n---\n\n')}`,
          childMaxSteps: CHILD_MAX_STEPS,
          permissionMode: 'chat',
          requestApproval: undefined,
        }) || fallback
      } catch {
        finalText = fallback
      }
    }

    return finalize(send, turnId, finalText, trajectory, false)
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    finishRemaining()
    if (isAbort) {
      send({
        type: 'error',
        sessionId: deps.id,
        code: timedOut ? 'TIMEOUT' : 'CANCELLED',
        message: timedOut ? '' : 'User cancelled the request',
      })
      return ''
    }
    send({
      type: 'error',
      sessionId: deps.id,
      code: timedOut ? 'TIMEOUT' : 'AGENT_ERROR',
      message: timedOut ? '' : err instanceof Error ? err.message : String(err),
    })
    return ''
  } finally {
    watchdog.stop()
    if (deps.pendingPermissions.size) {
      for (const resolve of deps.pendingPermissions.values()) resolve({ cancelled: true })
      deps.pendingPermissions.clear()
    }
  }
}
