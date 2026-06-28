import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { AttachmentPayload } from './attachments.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { ServerMessage, SessionConfig, PlanItem } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { loadProjection, projectEvent } from '../persistence/message-projector.js'
import { isAssistantStep } from '../persistence/message-updater.js'
import type { AssistantStepData, SessionMessageData } from '../persistence/message-types.js'
import { EventStore, SnapshotStore, saveSessionSnapshot } from '../persistence/event-store.js'
import { scratchDirFor } from './scratch.js'
import * as catalogModule from '../config/catalog.js'

type UserMessageData = Extract<SessionMessageData, { role: 'user' }>

function makeStore() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

function makeStoreWithEventAndSnapshot() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return { db, store: new SessionStore(db, ftsEnabled), eventStore: new EventStore(db), snapshotStore: new SnapshotStore(db) }
}

function publishEvent(
  db: ReturnType<typeof openDatabase>['db'],
  eventStore: EventStore,
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  db.exec('BEGIN')
  const event = eventStore.append(sessionId, type, data)
  projectEvent(db, event)
  db.exec('COMMIT')
}

const textCatalog = {
  openai: { id: 'openai', name: 'OpenAI', models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true } } },
  deepseek: { id: 'deepseek', name: 'DeepSeek', models: { 'deepseek-chat': { id: 'deepseek-chat', name: 'DeepSeek Chat', attachment: false } } },
}

describe('Session image agent dispatch', () => {
  let scratch: string
  let cwd: string
  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-dispatch-'))
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-dispatch-cwd-'))
    await fs.mkdir(path.join(cwd, '.hip'), { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
    await fs.rm(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('dispatches an image turn to an internal multimodal agent when the main model is text-only', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "you are a vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    // isMultimodalModel calls readCatalog() internally, so spying on readCatalog alone does not intercept it.
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const st = makeStore()
    st.insertSession({ id: 's-dispatch', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const seen: { task?: string; attachments?: AttachmentPayload[] } = {}
    const invoker: AgentInvoker = {
      async invoke(_agentId, task, emit, _signal, _hooks, _extras, attachments) {
        seen.task = task
        seen.attachments = attachments
        emit.token('V')
        return 'vision result'
      },
    }

    const runner: ModelRunner = {
      async run(_m, o) {
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-dispatch', cfg, undefined, st, undefined, 10_000, runner, undefined, () => invoker, scratch)

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session.sendMessage('describe this', send, undefined, [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }])

    expect(seen.task).toBe('describe this')
    expect(seen.attachments).toHaveLength(1)
    expect(messages.some((m) => m.type === 'agent:started' && m.agentId === 'vis')).toBe(true)
    expect(messages.some((m) => m.type === 'agent:finished' && m.agentId === 'vis')).toBe(true)
    const complete = messages.find((m) => m.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(complete!.message.content).toBe('vision result')
    expect(complete!.message.agentId).toBe('vis')
    const history = (session as unknown as { messages: BaseMessage[] }).messages
    expect(history[history.length - 1]).toBeInstanceOf(AIMessage)
    expect((history[history.length - 1] as AIMessage).content).toBe('vision result')

    const projection = loadProjection(st.getDb(), 's-dispatch')
    expect(projection.length).toBe(2)
    const userRow = projection.find((r) => r.data.role === 'user')?.data as UserMessageData | undefined
    expect(userRow).toBeDefined()
    expect(userRow!.content).toBe('describe this')
    const assistantRow = projection.find((r) => isAssistantStep(r.data))?.data as AssistantStepData | undefined
    expect(assistantRow).toBeDefined()
    expect(assistantRow!.content).toBe('vision result')
    expect(assistantRow!.agentId).toBe('vis')
  })

  it('returns a clear error when no image-capable agent is available', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    // No agents configured → selectImageAgent returns null.
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const st = makeStore()
    st.insertSession({ id: 's-fallback', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const invoker = vi.fn<AgentInvoker['invoke']>().mockRejectedValue(new Error('should not be called'))
    const invokerFactory = () => ({ invoke: invoker })

    const runner: ModelRunner = {
      async run(_m, o) {
        o.onText('supervisor reply')
        return new AIMessage('supervisor reply')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-fallback', cfg, undefined, st, undefined, 10_000, runner, undefined, invokerFactory, scratch)

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session.sendMessage('describe this', send, undefined, [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }])

    expect(invoker).not.toHaveBeenCalled()
    const errorMsg = messages.find((m) => m.type === 'error')
    expect(errorMsg).toBeDefined()
    expect(errorMsg!.code).toBe('NO_IMAGE_AGENT')

    const projection = loadProjection(st.getDb(), 's-fallback')
    expect(projection.some((r) => isAssistantStep(r.data))).toBe(false)
  })

  it('does not dispatch non-image attachments to the multimodal agent', async () => {
    const pdfPath = path.join(scratch, 'test.pdf')
    await fs.writeFile(pdfPath, Buffer.from('fake-pdf-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "you are a vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const st = makeStore()
    st.insertSession({ id: 's-pdf', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const invoker = vi.fn<AgentInvoker['invoke']>().mockRejectedValue(new Error('should not be called'))
    const invokerFactory = () => ({ invoke: invoker })

    const runner: ModelRunner = {
      async run(_m, o) {
        o.onText('pdf reply')
        return new AIMessage('pdf reply')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-pdf', cfg, undefined, st, undefined, 10_000, runner, undefined, invokerFactory, scratch)

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session.sendMessage('read this', send, undefined, [{ id: 'a1', name: 'test.pdf', mimeType: 'application/pdf', path: pdfPath }])

    expect(invoker).not.toHaveBeenCalled()
    const complete = messages.find((m) => m.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(complete!.message.content).toBe('pdf reply')
  })

  it('keeps image_url parts out of the main session history after dispatch', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "you are a vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const st = makeStore()
    st.insertSession({ id: 's-history', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const invoker: AgentInvoker = {
      async invoke(_agentId, _task, _emit, _signal) {
        return 'vision result'
      },
    }

    const seenRunnerMessages: BaseMessage[][] = []
    const runner: ModelRunner = {
      async run(messages, o) {
        seenRunnerMessages.push(messages)
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-history', cfg, undefined, st, undefined, 10_000, runner, undefined, () => invoker, scratch)

    const send = () => {}
    await session.sendMessage('describe this', send, undefined, [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }])
    await session.sendMessage('follow up', send)

    const followUpMessages = seenRunnerMessages[seenRunnerMessages.length - 1]
    expect(followUpMessages).toBeDefined()
    const hasImagePart = followUpMessages.some((m) => {
      if (m.getType() !== 'human') return false
      const content = (m as HumanMessage).content
      if (typeof content === 'string') return false
      return Array.isArray(content) && content.some((p) => typeof p === 'object' && p !== null && 'type' in p && (p as { type: string }).type === 'image_url')
    })
    expect(hasImagePart).toBe(false)
  })

  it('accumulates managed-agent reasoning deltas under a single stepSeq', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "you are a vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const st = makeStore()
    st.insertSession({ id: 's-reasoning', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const invoker: AgentInvoker = {
      async invoke(_agentId, _task, emit, _signal) {
        emit.reasoning('Let me ')
        emit.reasoning('look at the image. ')
        emit.token('V')
        emit.reasoning('Now I understand.')
        return 'vision result'
      },
    }

    const runner: ModelRunner = {
      async run(_m, o) {
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-reasoning', cfg, undefined, st, undefined, 10_000, runner, undefined, () => invoker, scratch)

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session.sendMessage('describe this', send, undefined, [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }])

    const reasoningDeltas = messages.filter((m): m is Extract<ServerMessage, { type: 'reasoning:delta' }> => m.type === 'reasoning:delta')
    expect(reasoningDeltas.length).toBeGreaterThanOrEqual(3)
    // All reasoning deltas for the same burst must share one stepSeq so the frontend concatenates
    // them into a single reasoning block instead of spawning a new disclosure per delta.
    const stepSeqs = reasoningDeltas.map((m) => m.stepSeq)
    expect(new Set(stepSeqs).size).toBe(1)
    expect(reasoningDeltas.map((m) => m.delta).join('')).toBe('Let me look at the image. Now I understand.')
  })

  it('regenerate after restart re-invokes the image agent and preserves image context', async () => {
    const imgPath = path.join(scratch, 'regen.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const { db, store, eventStore, snapshotStore } = makeStoreWithEventAndSnapshot()
    store.insertSession({ id: 's-regen-img', title: 't', config: JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, disablePlan: true }), createdAt: 1, updatedAt: 1 })

    // First completed turn with a snapshot.
    const invoker1: AgentInvoker = {
      async invoke(_agentId, _task, emit) {
        emit.token('first')
        return 'first'
      },
    }
    const runner1: ModelRunner = {
      async run(_m, o) {
        o.onText('first-main')
        return new AIMessage('first-main')
      },
    }
    const session1 = new Session('s-regen-img', { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }, undefined, store, undefined, 10_000, runner1, undefined, () => invoker1, scratch)
    await session1.sendMessage('first', () => {}, 'u1')

    // Simulate interrupted image-agent turn: user_message persisted, but assistant step never completed.
    const stagedPath = path.join(scratchDirFor('s-regen-img', scratch), 'attachments', 'a2', 'regen.png')
    await fs.mkdir(path.dirname(stagedPath), { recursive: true })
    await fs.copyFile(imgPath, stagedPath)
    publishEvent(db, eventStore, 's-regen-img', 'user_message', {
      messageId: 'u2',
      content: 'describe this',
      timestamp: Date.now(),
      attachments: [{ id: 'a2', name: 'regen.png', mimeType: 'image/png', size: 16 }],
      contentParts: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,regen-payload' } },
      ],
    })

    // Stale snapshot from after first turn.
    saveSessionSnapshot(snapshotStore, 's-regen-img', eventStore.latestSeq('s-regen-img') - 1, {
      messages: [new HumanMessage('first'), new AIMessage('first-main')],
      config: { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, disablePlan: true },
    })

    // Restart and regenerate.
    let seenImagePart = false
    const invoker2: AgentInvoker = {
      async invoke(_agentId, _task, _emit, _signal, _hooks, extras) {
        seenImagePart = (extras?.attachmentParts ?? []).some((p) => p.type === 'image_url')
        return 'regenerated vision result'
      },
    }
    const runner2: ModelRunner = {
      async run() {
        throw new Error('main model should not be invoked for image-agent regenerate')
      },
    }
    const session2 = new Session('s-regen-img', { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }, undefined, store, undefined, 10_000, runner2, undefined, () => invoker2, scratch)
    await session2.hydrate()
    await session2.regenerate(() => {})

    expect(seenImagePart).toBe(true)
  })

  it('reuses the existing incomplete assistant stepId when regenerating an interrupted image-agent turn', async () => {
    const imgPath = path.join(scratch, 'reuse.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const { db, store, eventStore, snapshotStore } = makeStoreWithEventAndSnapshot()
    store.insertSession({ id: 's-reuse', title: 't', config: JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, disablePlan: true }), createdAt: 1, updatedAt: 1 })

    // First completed turn with a snapshot.
    const invoker1: AgentInvoker = {
      async invoke(_agentId, _task, emit) {
        emit.token('first')
        return 'first'
      },
    }
    const runner1: ModelRunner = {
      async run(_m, o) {
        o.onText('first-main')
        return new AIMessage('first-main')
      },
    }
    const session1 = new Session('s-reuse', { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }, undefined, store, undefined, 10_000, runner1, undefined, () => invoker1, scratch)
    await session1.sendMessage('first', () => {}, 'u1')

    // Simulate interrupted image-agent turn: user_message persisted and step_started emitted.
    const stagedPath = path.join(scratchDirFor('s-reuse', scratch), 'attachments', 'a2', 'reuse.png')
    await fs.mkdir(path.dirname(stagedPath), { recursive: true })
    await fs.copyFile(imgPath, stagedPath)
    publishEvent(db, eventStore, 's-reuse', 'user_message', {
      messageId: 'u2',
      content: 'describe this',
      timestamp: Date.now(),
      attachments: [{ id: 'a2', name: 'reuse.png', mimeType: 'image/png', size: 16 }],
      contentParts: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,reuse-payload' } },
      ],
    })

    const interruptedTurnId = 'vis-turn-interrupted'
    publishEvent(db, eventStore, 's-reuse', 'step_started', {
      stepId: interruptedTurnId,
      agentId: 'vis',
      startedAt: Date.now(),
    })

    // Stale snapshot from after first turn.
    saveSessionSnapshot(snapshotStore, 's-reuse', eventStore.latestSeq('s-reuse') - 2, {
      messages: [new HumanMessage('first'), new AIMessage('first-main')],
      config: { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, disablePlan: true },
    })

    // Restart and regenerate.
    const invoker2: AgentInvoker = {
      async invoke(_agentId, _task, _emit, _signal, _hooks, _extras) {
        return 'regenerated vision result'
      },
    }
    const runner2: ModelRunner = {
      async run() {
        throw new Error('main model should not be invoked for image-agent regenerate')
      },
    }
    const session2 = new Session('s-reuse', { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }, undefined, store, undefined, 10_000, runner2, undefined, () => invoker2, scratch)
    await session2.hydrate()

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session2.regenerate(send)

    const started = messages.find((m) => m.type === 'agent:started' && m.agentId === 'vis')
    expect(started).toBeDefined()
    expect(started!.turnId).toBe(interruptedTurnId)

    const projection = loadProjection(store.getDb(), 's-reuse')
    const assistantRows = projection.filter((r) => isAssistantStep(r.data))
    expect(assistantRows.length).toBe(2) // first turn + reused image-agent turn
    const reusedRow = assistantRows.find((r) => r.data.stepId === interruptedTurnId)
    expect(reusedRow).toBeDefined()
    expect(reusedRow!.data.content).toBe('regenerated vision result')
    expect(reusedRow!.data.finishedAt).not.toBeNull()
  })

  it('falls through to the text-only main model when no image agent is available during regenerate', async () => {
    const imgPath = path.join(scratch, 'fallthrough.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    // No agents configured → selectImageAgent returns null.
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const { db, store, eventStore, snapshotStore } = makeStoreWithEventAndSnapshot()
    store.insertSession({ id: 's-fallthrough', title: 't', config: JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, disablePlan: true }), createdAt: 1, updatedAt: 1 })

    // First completed turn with a snapshot.
    const runner1: ModelRunner = {
      async run(_m, o) {
        o.onText('first-main')
        return new AIMessage('first-main')
      },
    }
    const invoker1 = vi.fn<AgentInvoker['invoke']>().mockRejectedValue(new Error('should not be called'))
    const session1 = new Session('s-fallthrough', { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }, undefined, store, undefined, 10_000, runner1, undefined, () => ({ invoke: invoker1 }), scratch)
    await session1.sendMessage('first', () => {}, 'u1')

    // Simulate interrupted image turn with no available image agent.
    const stagedPath = path.join(scratchDirFor('s-fallthrough', scratch), 'attachments', 'a2', 'fallthrough.png')
    await fs.mkdir(path.dirname(stagedPath), { recursive: true })
    await fs.copyFile(imgPath, stagedPath)
    publishEvent(db, eventStore, 's-fallthrough', 'user_message', {
      messageId: 'u2',
      content: 'describe this',
      timestamp: Date.now(),
      attachments: [{ id: 'a2', name: 'fallthrough.png', mimeType: 'image/png', size: 16 }],
      contentParts: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,fallthrough-payload' } },
      ],
    })

    saveSessionSnapshot(snapshotStore, 's-fallthrough', eventStore.latestSeq('s-fallthrough') - 1, {
      messages: [new HumanMessage('first'), new AIMessage('first-main')],
      config: { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, disablePlan: true },
    })

    // Restart and regenerate.
    const invoker2 = vi.fn<AgentInvoker['invoke']>().mockRejectedValue(new Error('should not be called'))
    const seenRunnerMessages: BaseMessage[][] = []
    const runner2: ModelRunner = {
      async run(messages, o) {
        seenRunnerMessages.push(messages)
        o.onText('text-only reply')
        return new AIMessage('text-only reply')
      },
    }
    const session2 = new Session('s-fallthrough', { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }, undefined, store, undefined, 10_000, runner2, undefined, () => ({ invoke: invoker2 }), scratch)
    await session2.hydrate()

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session2.regenerate(send)

    expect(invoker2).not.toHaveBeenCalled()
    const errorMsg = messages.find((m) => m.type === 'error')
    expect(errorMsg).toBeUndefined()

    const complete = messages.find((m) => m.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(complete!.message.content).toBe('text-only reply')

    expect(seenRunnerMessages.length).toBeGreaterThan(0)
    const lastRunMessages = seenRunnerMessages[seenRunnerMessages.length - 1]
    const hasImagePart = lastRunMessages.some((m) => {
      if (m.getType() !== 'human') return false
      const content = (m as HumanMessage).content
      if (typeof content === 'string') return false
      return Array.isArray(content) && content.some((p) => typeof p === 'object' && p !== null && 'type' in p && (p as { type: string }).type === 'image_url')
    })
    expect(hasImagePart).toBe(false)
  })

  it('dispatches image agent when resuming an interrupted turn with an image and a text-only model', async () => {
    const imgPath = path.join(scratch, 'resume.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "you are a vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const st = makeStore()
    st.insertSession({ id: 's-resume-img', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    let imageAgentInvoked = false
    const invoker: AgentInvoker = {
      async invoke(_agentId, _task, _emit, _signal, _hooks, extras) {
        imageAgentInvoked = (extras?.attachmentParts ?? []).some((p) => p.type === 'image_url')
        return 'image description'
      },
    }

    const runner: ModelRunner = {
      async run(_m, o) {
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-resume-img', cfg, undefined, st, undefined, 10_000, runner, undefined, () => invoker, scratch)

    // Simulate an interrupted supervisor turn awaiting user input.
    const s = session as unknown as {
      awaitingResume: boolean
      paused: { messages: BaseMessage[]; steps: number; planningMode?: 'fast' | 'plan'; planStatus?: 'none' | 'generating' | 'ready' | 'approved' | 'rejected'; plan?: PlanItem[] }
      running: boolean
    }
    s.awaitingResume = true
    s.paused = { messages: [new HumanMessage('previous question'), new AIMessage('assistant interrupt')], steps: 1 }
    s.running = false

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session.resume('see screenshot', send, [{ id: 'a1', name: 'resume.png', mimeType: 'image/png', path: imgPath }])

    expect(imageAgentInvoked).toBe(true)
    expect(messages.some((m) => m.type === 'agent:started' && m.agentId === 'vis')).toBe(true)
    expect(messages.some((m) => m.type === 'agent:finished' && m.agentId === 'vis')).toBe(true)
  })
})
