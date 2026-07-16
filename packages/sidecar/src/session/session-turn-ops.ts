/** Resume / regenerate / plan / subagent continuation (Phase 3b). */
import type { AgentConfig, ContentPart, Attachment, PermissionMode } from '@hip/protocol'
import { HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { GraphEmit } from './graph.js'
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
import {
  type SessionTurnHost,
  type SendFn,
  runTurn,
  runManagedAgentTurn,
} from './session-turn-runner.js'

export async function resume(host: SessionTurnHost, content: string, send: SendFn, attachments?: AttachmentPayload[]): Promise<void> {
  if (!host.awaitingResume || !host.paused || host.running) return
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

  const base = {
    messages: [...host.paused.messages, humanMessage],
    steps: host.paused.steps,
    planningMode: host.paused.planningMode,
    planStatus: host.paused.planStatus,
    plan: host.paused.plan,
  }
  host.awaitingResume = false; host.paused = null
  const ts = Date.now()
  if (host.store) {
    host.emit({ type: 'user_message', sessionId: host.id, content: resumeContent, messageId: `u-${ts}`, timestamp: ts, ...(staged?.length ? { attachments: staged } : {}), ...(isRichContentParts(resumeParts) ? { contentParts: resumeParts } : {}) })
  }
  host.messages.push(humanMessage)
  await runTurn(host, send, base)
}

export async function regenerate(host: SessionTurnHost, send: SendFn): Promise<void> {
  if (host.running) {
    send({ type: 'error', sessionId: host.id, code: 'BUSY', message: 'A turn is already running' })
    return
  }
  if (host.awaitingResume) {
    host.awaitingResume = false
    host.paused = null
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
  if (!host.awaitingResume || !host.paused) return
  switch (action) {
    case 'approve': {
      host.planMode.exit()
      // Persist the approved plan to .hip/plans/<sessionId>.json atomically
      try {
        const cwd = host._config.cwd ?? process.cwd()
        const safeId = host.id.replace(/[^a-zA-Z0-9_-]/g, '_')
        const filePath = join(cwd, '.hip', 'plans', `${safeId}.json`)
        const dir = dirname(filePath)
        await mkdir(dir, { recursive: true })
        const tmpFile = `${filePath}.tmp-${Date.now()}`
        const planPayload = {
          sessionId: host.id,
          plan: host.paused?.plan ?? [],
          approvedAt: Date.now(),
        }
        await writeFile(tmpFile, JSON.stringify(planPayload, null, 2), 'utf8')
        await rename(tmpFile, filePath)
      } catch (err) {
        console.error('Failed to persist approved plan:', err instanceof Error ? err.message : String(err))
        send({ type: 'agent:notification', sessionId: host.id, taskId: 'plan-persist', description: 'Plan was approved but could not be saved to disk.', status: 'failed' })
      }
      const base = {
        messages: host.paused.messages,
        steps: host.paused.steps,
        planningMode: 'plan' as const,
        planStatus: 'approved' as const,
        plan: host.paused.plan,
      }
      host.awaitingResume = false; host.paused = null
      await runTurn(host, send, base)
      break
    }
    case 'reject': {
      host.planMode.cancel()
      host.awaitingResume = false; host.paused = null
      send({ type: 'error', sessionId: host.id, code: 'PLAN_REJECTED', message: 'Plan was rejected by the user.' })
      break
    }
    case 'amend': {
      const content = amendContent ?? 'Please revise the plan.'
      const base = {
        messages: [...host.paused.messages, new HumanMessage(content)],
        steps: host.paused.steps,
        planningMode: 'plan' as const,
        planStatus: 'generating' as const,
        plan: host.paused.plan,
      }
      host.awaitingResume = false; host.paused = null
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
    result = await runSubagent({
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
    toolStarted: (name, callId, input) => { const inClip = clip(stringify(input)); send({ type: 'tool:started', sessionId: host.id, turnId, agentId: taskId, role, callId, name, input: inClip.text, seq: 0, ...(inClip.truncated ? { truncated: true } : {}) }) },
    toolFinished: (callId, status, resOutput, error) => { const outClip = resOutput !== undefined ? clip(stringify(resOutput)) : undefined; send({ type: 'tool:finished', sessionId: host.id, turnId, agentId: taskId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) }) },
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }

  try {
    const text = await runSubagent({
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
