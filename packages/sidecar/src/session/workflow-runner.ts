import type { ServerMessage, SessionConfig, AgentRole, WorkflowDef, OrchestratorEvent } from '@hip/protocol'
import type { TraceRun } from './tool-trace.js'
import { ReasoningTracker, stringify } from './tool-trace.js'
import { IdleWatchdog, idleTimeoutMessage } from './idle-watchdog.js'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { runWorkflow } from '../orchestrator/executor.js'
import { DurableExecutor } from '../orchestrator/durable-executor.js'
import { createSessionAgentRunner } from './orchestrator-adapter.js'
import { runSubagent } from './subagent.js'
import { CHILD_MAX_STEPS } from './loop-control.js'
import { SqliteWorkflowStore } from '../persistence/workflow-store.js'
import type { OrchestratorEventSink, AgentRunner } from '../orchestrator/ports.js'
import type { GraphEmit } from './graph.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { SessionStore } from '../persistence/store.js'
import type { NetworkPolicy } from './network-policy.js'
import type { ToolOutputStore } from './tool-output-store.js'
import type { GuardianReviewer } from './guardian.js'
import type { HookRegistry } from './hooks/registry.js'
import { safeErrorMessage } from './error.js'

type SendFn = (msg: ServerMessage) => void

/** Best-effort final text from in-flight agent trajectory (supervisor last, else any non-empty). */
export function collectTrajectoryText(trajectory: Map<string, TraceRun>): string {
  const runs = [...trajectory.entries()]
  const supervisor = runs.find(([id]) => id === 'supervisor')?.[1]
  if (supervisor?.output?.trim()) return supervisor.output
  const withOutput = runs.map(([, r]) => r.output).filter((t) => typeof t === 'string' && t.trim())
  if (withOutput.length === 1) return withOutput[0]!
  if (withOutput.length > 1) return withOutput.join('\n\n')
  return ''
}

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
  networkPolicy?: NetworkPolicy
  toolOutputStore?: ToolOutputStore
  guardianReviewer?: GuardianReviewer
  /** Session plugin hook registry — required for tool + turn lifecycle parity. */
  hooks: HookRegistry
}

export type WorkflowTurnOpts = {
  runInputs?: { text: string; data?: unknown }
  signal?: AbortSignal
  /**
   * When true, skip UserPromptSubmit (already fired by processInput on message:send + dag).
   * Default false for workflow:run direct entry.
   */
  skipUserPromptSubmit?: boolean
}

export async function runWorkflowTurn(
  deps: WorkflowRunDeps,
  def: WorkflowDef,
  send: SendFn,
  finalize: (send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean) => string,
  opts?: WorkflowTurnOpts,
): Promise<string> {
  // Local controller for idle watchdog + executor; link Session.cancel via opts.signal.
  const abortController = new AbortController()
  const external = opts?.signal
  if (external) {
    if (external.aborted) abortController.abort()
    else external.addEventListener('abort', () => abortController.abort(), { once: true })
  }
  deps.orchestratorRunner = undefined // local ref for mutation
  let timedOut = false
  const watchdog = new IdleWatchdog(deps.idleTimeoutMs, () => { timedOut = true; abortController.abort() })

  const turnId = `asst-supervisor-${Date.now()}`
  const trajectory = new Map<string, TraceRun>()
  let agentSeq = 0; let stepSeq = 0
  const nextSeq = () => stepSeq++
  const started = new Set<string>()
  const reasoning = new ReasoningTracker(nextSeq)

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

  const makeEmit = (agentId: string, role: AgentRole): GraphEmit => {
    const closeReasoning = () => {
      const burst = reasoning.close(agentId)
      if (burst) {
        const r = trajectory.get(agentId)
        if (r) r.reasoningBursts.push(burst)
      }
    }
    return {
      token: (delta) => {
        if (!delta) return
        const r = trajectory.get(agentId)
        if (r) r.output += delta
        send({ type: 'token:stream', sessionId: deps.id, turnId, agentId, delta })
      },
      reasoning: (delta) => {
        if (!delta) return
        send({ type: 'reasoning:delta', sessionId: deps.id, turnId, agentId, role, stepSeq: reasoning.push(agentId, delta), delta })
      },
      toolStarted: (name, callId, input) => {
        closeReasoning()
        const seq = nextSeq()
        const r = trajectory.get(agentId)
        if (r) r.toolCalls.set(callId, { callId, agentId, name, input: stringify(input), status: 'running', seq })
        send({ type: 'tool:started', sessionId: deps.id, turnId, agentId, role, callId, name, input: stringify(input), seq })
      },
      toolFinished: (callId, status, output, error) => {
        const r = trajectory.get(agentId)
        const tc = r?.toolCalls.get(callId)
        if (tc) {
          tc.status = status
          if (output !== undefined) tc.output = output
          if (error !== undefined) tc.error = error
        }
        send({ type: 'tool:finished', sessionId: deps.id, turnId, agentId, callId, status, ...(output !== undefined ? { output } : {}), ...(error ? { error } : {}) })
      },
      usage: () => {},
      planDelta: () => {},
      compaction: () => {},
      activity: () => { watchdog.kick() },
    }
  }

  const logNonCritical = (event: string, err: unknown) => {
    console.warn(`[workflow hooks] ${event}:`, err instanceof Error ? err.message : String(err))
  }

  // ── Turn lifecycle: UserPromptSubmit (optional) + TurnStart ──────────────
  if (!opts?.skipUserPromptSubmit) {
    const userText = opts?.runInputs?.text?.trim()
    if (userText) {
      const promptResult = await deps.hooks
        .fire('UserPromptSubmit', { sessionId: deps.id, turnId, runId: turnId })
        .catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
      if (promptResult.kind !== 'allow') {
        send({
          type: 'error',
          sessionId: deps.id,
          code: 'HOOK_DENIED',
          message: `User prompt rejected: ${promptResult.reason ?? 'blocked by hook'}`,
        })
        watchdog.stop()
        return ''
      }
    }
  }

  const turnStartResult = await deps.hooks
    .fire('TurnStart', { sessionId: deps.id, turnId, runId: turnId })
    .catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
  if (turnStartResult.kind !== 'allow') {
    send({
      type: 'error',
      sessionId: deps.id,
      code: 'HOOK_DENIED',
      message: `Turn start rejected: ${turnStartResult.reason ?? 'blocked by hook'}`,
    })
    watchdog.stop()
    return ''
  }

  let runner: AgentRunner
  if (deps.orchestratorRunner) {
    runner = deps.orchestratorRunner
  } else {
    const cwd = deps.config.cwd ?? process.cwd()
    runner = createSessionAgentRunner(
      cwd,
      deps.invokerFactory,
      async (input: string, signal: AbortSignal, nodeId?: string): Promise<string> => {
        const agentId = nodeId ?? 'worker'
        return runSubagent({
          runner: deps.modelRunner(),
          root: deps.config.cwd ?? process.cwd(),
          summarizer: deps.summarizer(),
          emit: makeEmit(agentId, 'worker'),
          signal,
          description: input,
          childMaxSteps: CHILD_MAX_STEPS,
          // Inherit session permission mode (never force full — HITL/edit must apply).
          permissionMode: deps.config.permissionMode ?? 'edit',
          // Policy A: no HITL transport in workflow workers.
          requestApproval: undefined,
          networkPolicy: deps.networkPolicy,
          toolOutputStore: deps.toolOutputStore,
          guardianReviewer: deps.guardianReviewer,
          hooks: deps.hooks,
          sessionId: deps.id,
          turnId,
          runId: turnId,
          nodeId: agentId !== 'worker' ? agentId : undefined,
          agentId,
          parentAgentId: 'supervisor',
        })
      },
      {
        emit: (nodeId) => makeEmit(nodeId, 'subagent'),
        pluginHooks: deps.hooks,
        sessionId: deps.id,
        runId: turnId,
        permissionMode: deps.config.permissionMode ?? 'edit',
      },
    )
    deps.orchestratorRunner = runner
  }

  const eventSink: OrchestratorEventSink = {
    emit(e: OrchestratorEvent) {
      send({ type: 'workflow:event', sessionId: deps.id, runId: turnId, event: e })
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

  const workflowStore = deps.store ? new SqliteWorkflowStore(deps.store.getDb()) : undefined

  try {
    // Prefer DurableExecutor when SQLite is available so each reduce() checkpoints
    // RunState and a crash can resume the same runId. Without a store, fall back to
    // the in-memory runWorkflow path (tests / ephemeral sidecar).
    send({ type: 'workflow:started', sessionId: deps.id, runId: turnId, def })
    // Live Agents panel: supervisor owns the DAG turn for the duration of the run.
    ensureStarted('supervisor', 'supervisor')
    const cwd = deps.config.cwd ?? process.cwd()
    const runState = workflowStore
      ? await new DurableExecutor(workflowStore).runWorkflow(
          def,
          { agentRunner: runner, eventSink },
          { runId: turnId, signal: abortController.signal, cwd, sessionId: deps.id, runInputs: opts?.runInputs },
        )
      : await runWorkflow(
          def,
          { agentRunner: runner, eventSink },
          { runId: turnId, signal: abortController.signal, cwd, sessionId: deps.id, runInputs: opts?.runInputs },
        )
    // finishRemaining closes supervisor + any in-flight node agents.
    finishRemaining()
    send({ type: 'workflow:snapshot', sessionId: deps.id, runId: turnId, def, state: runState })

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
          emit: makeEmit('aggregator', 'supervisor'),
          signal: abortController.signal,
          description: `You are an aggregator. Merge these subagent results into one coherent summary:\n\n${rawTexts.join('\n\n---\n\n')}`,
          childMaxSteps: CHILD_MAX_STEPS,
          permissionMode: 'chat',
          requestApproval: undefined,
          networkPolicy: deps.networkPolicy,
          toolOutputStore: deps.toolOutputStore,
          guardianReviewer: deps.guardianReviewer,
          hooks: deps.hooks,
          sessionId: deps.id,
          turnId,
          runId: turnId,
          agentId: 'aggregator',
          parentAgentId: 'supervisor',
        }) || fallback
      } catch {
        finalText = fallback
      }
    }

    // Stop: fire but ignore `continue` (do not inject a second DAG run).
    await deps.hooks
      .fire('Stop', { sessionId: deps.id, turnId, runId: turnId })
      .catch((err) => logNonCritical('Stop', err))
    void deps.hooks
      .fire('TurnComplete', { sessionId: deps.id, turnId, runId: turnId })
      .catch((err) => logNonCritical('TurnComplete', err))

    return finalize(send, turnId, finalText, trajectory, false)
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    finishRemaining()
    // Always project trajectory so cancel/timeout leaves a partial assistant message.
    const partialText = collectTrajectoryText(trajectory)
    void deps.hooks
      .fire('TurnComplete', { sessionId: deps.id, turnId, runId: turnId })
      .catch((e) => logNonCritical('TurnComplete', e))
    if (isAbort) {
      send({
        type: 'error',
        sessionId: deps.id,
        code: timedOut ? 'TIMEOUT' : 'CANCELLED',
        message: timedOut ? idleTimeoutMessage(deps.idleTimeoutMs) : 'User cancelled the request',
      })
      const stoppedNote = timedOut
        ? '(timed out)'
        : '(cancelled)'
      const text = partialText.trim()
        ? `${partialText.trim()}\n\n${stoppedNote}`
        : stoppedNote
      return finalize(send, turnId, text, trajectory, true)
    }
    send({
      type: 'error',
      sessionId: deps.id,
      code: timedOut ? 'TIMEOUT' : 'AGENT_ERROR',
      message: timedOut ? idleTimeoutMessage(deps.idleTimeoutMs) : safeErrorMessage(err),
    })
    const text = partialText.trim()
      ? `${partialText.trim()}\n\n(error)`
      : `(error: ${safeErrorMessage(err)})`
    return finalize(send, turnId, text, trajectory, true)
  } finally {
    watchdog.stop()
    if (deps.pendingPermissions.size) {
      for (const resolve of deps.pendingPermissions.values()) resolve({ cancelled: true })
      deps.pendingPermissions.clear()
    }
  }
}
