/** Background subagent helpers. */
import type { PermissionMode, TurnUsage } from '@hip/protocol'
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import { childMaxStepsForAgent } from './loop-control.js'
import { GuardianReviewer } from './guardian.js'
import { safeErrorMessage } from './error.js'
import type { SessionTurnHost, SendFn } from './session-turn-runner.js'

export async function runBackgroundSubagent(
  host: SessionTurnHost,
  taskId: string,
  description: string,
  signal: AbortSignal,
  send: SendFn,
): Promise<void> {
  const cwd = host._config.cwd ?? process.cwd()
  const runner = host.modelRunner()
  const summarizer = host.summarizer()
  const rawMode = host._config.permissionMode
  const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
  const requestApproval = host.permissions.buildRequestApproval(send, host.id, '', () => 0, mode, host.hooks)

  send({ type: 'agent:started', sessionId: host.id, turnId: `bg-turn-${taskId}`, agentId: taskId, role: 'worker', taskId, taskInput: description })

  const syntheticAgentId = `bg-${taskId}`
  const syntheticTurnId = `bg-turn-${taskId}`
  let result = ''
  let status: 'completed' | 'failed' = 'completed'
  let error: string | undefined
  let usage: TurnUsage | undefined
  let aborted = false

  try {
    // Capture usage via return value (emit.usage is intentionally not the fold path for bg).
    const run = await runSubagent({
      runner,
      root: cwd,
      summarizer,
      emit: { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} },
      signal,
      description,
      childMaxSteps: childMaxStepsForAgent('worker', cwd),
      permissionMode: mode,
      requestApproval,
      mode: 'background',
      sessionId: host.id,
      networkPolicy: host.networkPolicy,
      toolOutputStore: host.toolOutputStore,
      guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
      hooks: host.hooks,
      agentId: taskId,
      parentAgentId: 'supervisor',
    })
    result = run.text
    usage = run.usage
  } catch (err) {
    const msg = safeErrorMessage(err)
    aborted = signal.aborted || (err instanceof Error && err.name === 'AbortError')
    console.error(`Background task ${taskId} failed:`, err instanceof Error ? err.message : String(err))
    result = `Error: ${msg}`
    status = 'failed'
    error = msg
  }

  host.backgroundManager.completeTask(taskId, status, error === undefined ? result : undefined, error)

  // stop() may have already marked the task killed; do not publish completed/failed over a kill
  const finalMeta = host.backgroundManager.meta.get(taskId)
  const killed = finalMeta?.status === 'killed' || aborted

  // KD-12: fold observed usage into session aggregate; incomplete on kill/timeout/missing metadata.
  // Never invent tokens — only fold what was captured.
  if (usage) {
    host.foldSessionUsage(usage, { incomplete: killed, send })
  } else {
    // Missing metadata OR kill/abort without any step usage → incomplete only.
    host.foldSessionUsage(undefined, { incomplete: true, send })
  }

  if (finalMeta?.status === 'killed') {
    const killError = finalMeta.error ?? 'task was killed'
    send({
      type: 'agent:notification',
      sessionId: host.id,
      taskId,
      description,
      status: 'killed',
      error: killError,
    })
    send({ type: 'agent:finished', sessionId: host.id, turnId: syntheticTurnId, agentId: taskId })
    return
  }

  const ts = Date.now()
  host.emit({ type: 'step_started', sessionId: host.id, turnId: syntheticTurnId, agentId: syntheticAgentId, timestamp: ts })
  host.emit({ type: 'text_started', sessionId: host.id, messageId: syntheticTurnId, timestamp: ts })
  host.emit({ type: 'text_ended', sessionId: host.id, messageId: syntheticTurnId, content: result, timestamp: ts })
  host.emit({ type: 'step_ended', sessionId: host.id, turnId: syntheticTurnId, agentId: syntheticAgentId, timestamp: ts })
  host.messages.push(new AIMessage(result))

  send({
    type: 'agent:notification',
    sessionId: host.id,
    taskId,
    description,
    status,
    ...(error === undefined ? { result } : { error }),
  })
  send({ type: 'agent:finished', sessionId: host.id, turnId: syntheticTurnId, agentId: taskId })
}

export function loadSubagentMessages(host: SessionTurnHost, taskId: string): BaseMessage[] {
  if (!host.store) return []
  try {
    return host.store.getMessages(taskId).map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    )
  } catch (err) {
    console.error(`Failed to load prior messages for subagent ${taskId}:`, err instanceof Error ? err.message : String(err))
    return []
  }
}
