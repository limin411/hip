/** Resume / regenerate / plan / subagent continuation (Phase 3b). */
import { join } from 'node:path'
import type { AgentConfig, AgentRole, ContentPart, Attachment, PermissionMode } from '@hip/protocol'
import { HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { GraphEmit } from './graph.js'
import { persistApprovedPlan } from './plan-persistence.js'
import { selectImageAgent } from './agents/registry.js'
import { runSubagent } from './subagent.js'
import { childMaxStepsForAgent } from './loop-control.js'
import { GuardianReviewer } from './guardian.js'
import { validateAttachments, stageAttachments, buildAttachmentContentParts, type AttachmentPayload } from './attachments.js'
import { scratchDirFor } from './scratch.js'
import { isRichContentParts } from './session-message-codec.js'
import { isImageAttachment, logNonCritical } from './session-helpers.js'
import { safeErrorMessage } from './error.js'
import { loadSubagentMessages } from './session-background.js'
import { clipForTool, stringify } from './tool-trace.js'
import { logInfo } from '../debug-logger.js'
import { clearForcePlanFlag } from './force-plan.js'
import {
  type SessionTurnHost,
  type SendFn,
  runTurn,
  runManagedAgentTurn,
} from './session-turn-runner.js'

export async function resume(host: SessionTurnHost, content: string, send: SendFn, attachments?: AttachmentPayload[]): Promise<void> {
  if (!host.awaitingResume || !host.paused || host.running) {
    logInfo('session', 'resume:skip', {
      sessionId: host.id,
      awaitingResume: host.awaitingResume,
      hasPaused: Boolean(host.paused),
      running: host.running,
      planStatus: host.paused?.planStatus,
      contentLen: content.length,
    })
    return
  }
  const parts: ContentPart[] = []
  if (content) parts.push({ type: 'text', text: content })
  let staged: Attachment[] | undefined

  if (attachments?.length) {
    await validateAttachments(attachments)
    const result = await stageAttachments(host.id, attachments, host.scratchRoot)
    staged = result.staged
    const attachmentParts = await buildAttachmentContentParts(attachments, result.stagedPaths)
    parts.push(...attachmentParts)
  }

  const hasImageAttachment = attachments?.some((a) => a.mimeType.startsWith('image/')) ?? false
  let resumeContent = content
  let resumeParts = parts

  // If the user is answering an interrupt with an image but the main model is text-only,
  // preprocess the image with an internal multimodal agent so the resumed turn can see a
  // textual description instead of silently dropping the image.
  if (hasImageAttachment && !host.currentModelSupportsImages()) {
    let imageAgent: AgentConfig | null = null
    try {
      imageAgent = selectImageAgent(host._config.cwd ?? process.cwd(), content)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('Failed to select image agent for resume:', message)
    }
    if (imageAgent) {
      const visionResult = await runManagedAgentTurn(host, 
        { type: 'message', content, messageId: `u-${Date.now()}`, attachments: attachments ?? [] },
        imageAgent,
        parts,
        send,
        false,
      )
      resumeContent = content ? `${content}\n\n[Image: ${visionResult}]` : `[Image: ${visionResult}]`
      resumeParts = [{ type: 'text', text: resumeContent }]
    } else {
      host.awaitingResume = false; host.paused = null
      host.clearPlanApprovalPause?.()
      send({
        type: 'error',
        sessionId: host.id,
        code: 'NO_IMAGE_AGENT',
        message: 'No image-capable agent is available for this resume. Please enable a multimodal agent or switch to a multimodal model.',
      })
      return
    }
  }

  const humanMessage = resumeParts.length === 1 && resumeParts[0].type === 'text'
    ? new HumanMessage(resumeContent)
    : new HumanMessage({ content: resumeParts })

  const paused = host.paused
  const interruptTurnId = `turn-${host.turnSeq}`
  const emitInterruptResolved = () => {
    send({
      type: 'agent:interrupt:resolved',
      sessionId: host.id,
      turnId: interruptTurnId,
    })
  }

  // KD-PA-1: plan:respond approve is the only approve path.
  // message:resume while planStatus===ready never soft-approves:
  //   non-empty text → amend (resume_as_amend); empty → structured soft error, pause intact.
  if (paused.planStatus === 'ready') {
    const amendText = resumeContent.trim()
    if (!amendText) {
      logInfo('session', 'plan:respond', {
        sessionId: host.id,
        action: 'resume_empty_rejected',
        planStatus: 'ready',
        planItemCount: paused.plan?.length ?? 0,
        planModeActive: host.planMode.isActive,
      })
      // Soft error: FE must not clear planApprovalPending (sessionStore treats this like BUSY).
      send({
        type: 'error',
        sessionId: host.id,
        code: 'PLAN_AWAITING_RESPONSE',
        message: 'Plan is awaiting approval. Use plan:respond (approve / amend / reject); empty resume is not allowed.',
      })
      return
    }
    logInfo('session', 'plan:respond', {
      sessionId: host.id,
      action: 'resume_as_amend',
      planItemCount: paused.plan?.length ?? 0,
      amendLen: amendText.length,
      forcePlan: Boolean(host._config.forcePlan),
      planModeActive: host.planMode.isActive,
    })
    const base = {
      messages: [...paused.messages, humanMessage],
      steps: paused.steps,
      planningMode: 'plan' as const,
      planStatus: 'generating' as const,
      plan: paused.plan,
    }
    host.awaitingResume = false
    host.paused = null
    host.clearPlanApprovalPause?.()
    emitInterruptResolved()
    const ts = Date.now()
    if (host.store) {
      host.emit({
        type: 'user_message',
        sessionId: host.id,
        content: resumeContent,
        messageId: `u-${ts}`,
        timestamp: ts,
        ...(staged?.length ? { attachments: staged } : {}),
        ...(isRichContentParts(resumeParts) ? { contentParts: resumeParts } : {}),
      })
    }
    host.messages.push(humanMessage)
    await runTurn(host, send, base)
    return
  }

  logInfo('session', 'resume:continue', {
    sessionId: host.id,
    planningMode: paused.planningMode,
    planStatus: paused.planStatus,
    planItemCount: paused.plan?.length ?? 0,
    contentLen: resumeContent.length,
    forcePlan: Boolean(host._config.forcePlan),
    planModeActive: host.planMode.isActive,
  })
  const base = {
    messages: [...paused.messages, humanMessage],
    steps: paused.steps,
    planningMode: paused.planningMode,
    planStatus: paused.planStatus,
    plan: paused.plan,
  }
  host.awaitingResume = false
  host.paused = null
  host.clearPlanApprovalPause?.()
  emitInterruptResolved()
  const ts = Date.now()
  if (host.store) {
    host.emit({ type: 'user_message', sessionId: host.id, content: resumeContent, messageId: `u-${ts}`, timestamp: ts, ...(staged?.length ? { attachments: staged } : {}), ...(isRichContentParts(resumeParts) ? { contentParts: resumeParts } : {}) })
  }
  host.messages.push(humanMessage)
  await runTurn(host, send, base)
}

export async function regenerate(host: SessionTurnHost, send: SendFn): Promise<void> {
  if (host.running || host.switchingAgent) {
    send({ type: 'error', sessionId: host.id, code: 'BUSY', message: 'A turn is already running' })
    return
  }
  if (host.awaitingResume) {
    host.awaitingResume = false
    host.paused = null
    host.clearPlanApprovalPause?.()
  }
  if (!host.requireCompatibleModel(send)) return
  if (!host.requireApiKey(send)) return

  while (host.messages[host.messages.length - 1] instanceof AIMessage) {
    host.messages.pop()
    host.store?.deleteLastAssistantMessage(host.id)
  }

  const tail = host.messages[host.messages.length - 1]
  if (!(tail instanceof HumanMessage || tail instanceof ToolMessage)) {
    send({ type: 'error', sessionId: host.id, code: 'CANNOT_REGENERATE', message: 'No user turn to regenerate from' })
    return
  }

  const lastUser = host.lastUserMessageRow()
  const hasImageAttachment = lastUser?.attachments?.some(isImageAttachment) ?? false
  const needsImageAgent = tail instanceof HumanMessage && hasImageAttachment && !host.currentModelSupportsImages()

  if (needsImageAgent && lastUser) {
    let imageAgent: AgentConfig | null = null
    try {
      imageAgent = selectImageAgent(host._config.cwd ?? process.cwd(), lastUser.content)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('Failed to select image agent:', message)
    }
    if (imageAgent) {
      // Remove the text-only user message placeholder; runManagedAgentTurn will push its own.
      if (tail instanceof HumanMessage) host.messages.pop()
      const reuseTurnId = host.incompleteAssistantStepAfter(lastUser.messageId)?.stepId
      await runManagedAgentTurn(host, 
        { type: 'message', content: lastUser.content, messageId: lastUser.messageId, attachments: (lastUser.attachments ?? []).map((a) => ({ ...a, path: join(scratchDirFor(host.id, host.scratchRoot), 'attachments', a.id, a.name) })) },
        imageAgent,
        await host.rebuildPartsForImageAgent(lastUser),
        send,
        false,
        reuseTurnId,
      )
      return
    }
  }

  await runTurn(host, send)
}

export async function handlePlanResponse(host: SessionTurnHost, action: 'approve' | 'reject' | 'amend', send: SendFn, amendContent?: string): Promise<void> {
  const emitRespondResult = (ok: boolean, reason?: string) => {
    send({
      type: 'plan:respond:result',
      sessionId: host.id,
      ok,
      action,
      ...(reason ? { reason } : {}),
    })
  }

  if (!host.awaitingResume || !host.paused) {
    logInfo('session', 'plan:respond:skip', {
      sessionId: host.id,
      action,
      awaitingResume: host.awaitingResume,
      hasPaused: Boolean(host.paused),
      planStatus: host.paused?.planStatus,
      planModeActive: host.planMode.isActive,
      forcePlan: Boolean(host._config.forcePlan),
    })
    // KD-16: every plan:respond path must emit a result (silent skip forbidden).
    emitRespondResult(false, 'not_awaiting')
    return
  }
  // Capture turn id for multi-client UI clear (message:complete alone does not clear interrupt).
  const interruptTurnId = `turn-${host.turnSeq}`
  const emitInterruptResolved = () => {
    send({
      type: 'agent:interrupt:resolved',
      sessionId: host.id,
      turnId: interruptTurnId,
    })
  }
  switch (action) {
    case 'approve': {
      host.planMode.exit()
      // Persist under ~/.hip/plans/ (not project cwd — avoids worktree pollution)
      try {
        await persistApprovedPlan(host.id, host.paused?.plan ?? [])
      } catch (err) {
        console.error('Failed to persist approved plan:', err instanceof Error ? err.message : String(err))
        send({ type: 'agent:notification', sessionId: host.id, taskId: 'plan-persist', description: 'Plan was approved but could not be saved to disk.', status: 'failed' })
      }
      const planItems = host.paused?.plan ?? []
      // Leave plan drafting mode: execution uses normal routing so historical
      // planning-phase tool errors and plan_approval interrupt context do not re-fire.
      const base = {
        messages: host.paused.messages,
        // Fresh execute budget: planning steps must not starve the fix turn.
        steps: 0,
        planningMode: 'fast' as const,
        planStatus: 'approved' as const,
        plan: host.paused.plan,
      }
      logInfo('session', 'plan:respond', {
        sessionId: host.id,
        action: 'approve',
        planningMode: 'fast',
        planStatus: 'approved',
        planItemCount: planItems.length,
        planCompleted: planItems.filter((p) => p.status === 'completed').length,
        forcePlanBefore: Boolean(host._config.forcePlan),
      })
      host.awaitingResume = false; host.paused = null
      host.clearPlanApprovalPause?.()
      emitRespondResult(true)
      emitInterruptResolved()
      // Drop forcePlan before execution so the execute turn is not re-gated into PlanMode.
      clearForcePlanFlag(host, send, 'approve')
      await runTurn(host, send, base)
      break
    }
    case 'reject': {
      host.planMode.cancel()
      logInfo('session', 'plan:respond', {
        sessionId: host.id,
        action: 'reject',
        planItemCount: host.paused?.plan?.length ?? 0,
        forcePlanBefore: Boolean(host._config.forcePlan),
      })
      host.awaitingResume = false; host.paused = null
      host.clearPlanApprovalPause?.()
      emitRespondResult(true)
      emitInterruptResolved()
      clearForcePlanFlag(host, send, 'reject')
      send({ type: 'error', sessionId: host.id, code: 'PLAN_REJECTED', message: 'Plan was rejected by the user.' })
      break
    }
    case 'amend': {
      const content = amendContent ?? 'Please revise the plan.'
      logInfo('session', 'plan:respond', {
        sessionId: host.id,
        action: 'amend',
        planItemCount: host.paused?.plan?.length ?? 0,
        amendLen: content.length,
        forcePlan: Boolean(host._config.forcePlan),
        planModeActive: host.planMode.isActive,
      })
      const base = {
        messages: [...host.paused.messages, new HumanMessage(content)],
        steps: host.paused.steps,
        planningMode: 'plan' as const,
        planStatus: 'generating' as const,
        plan: host.paused.plan,
      }
      host.awaitingResume = false; host.paused = null
      host.clearPlanApprovalPause?.()
      emitRespondResult(true)
      emitInterruptResolved()
      const ts = Date.now()
      if (host.store) {
        host.emit({ type: 'user_message', sessionId: host.id, content, messageId: `u-${ts}`, timestamp: ts })
      }
      host.messages.push(new HumanMessage(content))
      await runTurn(host, send, base)
      break
    }
  }
}

export async function retrySubagent(host: SessionTurnHost, agentId: string, send: SendFn, emit?: GraphEmit): Promise<string> {
  const instance = host.subagentInstances.get(agentId)
  if (!instance) return `Error: subagent ${agentId} not found`
  if (!host.spawnedSubagentIds.has(agentId)) return `Error: ${agentId} is not a known subagent`

  const allMessages = loadSubagentMessages(host, agentId)

  let retryDescription = instance.description
  let lastUserIdx = -1
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i].getType() === 'human') { lastUserIdx = i; break }
  }
  if (lastUserIdx >= 0) {
    const content = allMessages[lastUserIdx].content
    if (typeof content === 'string') retryDescription = content
  }

  const priorContext = lastUserIdx > 0 ? allMessages.slice(0, lastUserIdx) : []

  const cwd = host._config.cwd ?? process.cwd()
  const runner = host.modelRunner()
  const summarizer = host.summarizer()
  const rawMode = host._config.permissionMode
  const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
  const requestApproval = host.permissions.buildRequestApproval(send, host.id, '', () => 0, mode, host.hooks)

  const turnId = `retry-${agentId}-${Date.now()}`
  const standalone = emit == null
  const effectiveEmit = emit ?? { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} }
  if (standalone) {
    send({ type: 'agent:started', sessionId: host.id, turnId, agentId, role: 'worker', taskId: agentId, taskInput: retryDescription })
  }

  let result = ''
  try {
    const run = await runSubagent({
      runner,
      root: cwd,
      summarizer,
      emit: effectiveEmit,
      signal: new AbortController().signal,
      description: retryDescription,
      childMaxSteps: childMaxStepsForAgent('worker', cwd),
      permissionMode: mode,
      requestApproval,
      sessionId: host.id,
      networkPolicy: host.networkPolicy,
      toolOutputStore: host.toolOutputStore,
      guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
      hooks: host.hooks,
      turnId,
      agentId,
      parentAgentId: 'supervisor',
      ...(priorContext.length > 0 ? { existingMessages: priorContext } : {}),
    })
    result = run.text
  } catch (err) {
    const msg = safeErrorMessage(err)
    result = `Error: ${msg}`
  }

  if (standalone) {
    send({ type: 'agent:finished', sessionId: host.id, turnId, agentId })
  }
  return result
}

export async function resumeSubagent(host: SessionTurnHost, taskId: string, content: string, send: SendFn): Promise<void> {
  if (host.running || host.awaitingResume) return
  if (host.backgroundTasks.has(taskId)) return
  if (!host.spawnedSubagentIds.has(taskId)) return
  host.running = true

  const existingMessages = loadSubagentMessages(host, taskId)

  const cwd = host._config.cwd ?? process.cwd()
  const runner = host.modelRunner()
  const summarizer = host.summarizer()
  const rawMode = host._config.permissionMode
  const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
  const requestApproval = host.permissions.buildRequestApproval(send, host.id, '', () => 0, mode, host.hooks)

  const turnId = `asst-${taskId}-${Date.now()}-${host.turnSeq++}`
  const ac = new AbortController()
  host.resumeAbortController = ac
  const role: AgentRole = 'worker'
  send({ type: 'agent:started', sessionId: host.id, turnId, agentId: taskId, role, taskId, taskInput: content })

  let output = ''
  const emit: GraphEmit = {
    token: (delta) => { if (delta) { output += delta; send({ type: 'token:stream', sessionId: host.id, turnId, agentId: taskId, delta }) } },
    reasoning: () => {},
    toolStarted: (name, callId, input) => { const inClip = clipForTool(name, stringify(input)); send({ type: 'tool:started', sessionId: host.id, turnId, agentId: taskId, role, callId, name, input: inClip.text, seq: 0, ...(inClip.truncated ? { truncated: true } : {}) }) },
    toolFinished: (callId, status, resOutput, error) => {
      // resume path has no trajectory map; default to standard cap unless name was tracked
      const outClip = resOutput !== undefined ? clipForTool('', stringify(resOutput)) : undefined
      send({ type: 'tool:finished', sessionId: host.id, turnId, agentId: taskId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) })
    },
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }

  try {
    const { text } = await runSubagent({
      runner, root: cwd, summarizer, emit, signal: ac.signal,
      description: content, childMaxSteps: childMaxStepsForAgent('worker', cwd),
      permissionMode: mode, requestApproval,
      existingMessages: [...existingMessages, new HumanMessage(content)],
      sessionId: host.id,
      networkPolicy: host.networkPolicy,
      toolOutputStore: host.toolOutputStore,
      guardianReviewer: host.usesEnvModel ? new GuardianReviewer({ modelRunner: runner }) : undefined,
      hooks: host.hooks,
      turnId,
      agentId: taskId,
      parentAgentId: 'supervisor',
    })
    send({ type: 'agent:finished', sessionId: host.id, turnId, agentId: taskId })
    const ts = Date.now()
    send({ type: 'message:complete', sessionId: host.id, message: { id: turnId, role: 'assistant', content: text, agentId: taskId, timestamp: ts } })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      send({ type: 'agent:finished', sessionId: host.id, turnId, agentId: taskId })
    } else {
      const msg = safeErrorMessage(err)
      send({ type: 'agent:finished', sessionId: host.id, turnId, agentId: taskId })
      send({ type: 'error', sessionId: host.id, code: 'AGENT_ERROR', message: msg })
    }
  } finally {
    host.running = false
    host.resumeAbortController = null
  }
}
