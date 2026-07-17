import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadProjection } from '../persistence/message-projector.js'
import * as catalogModule from '../config/catalog.js'
import type { AgentInvoker } from './agents/invoker.js'
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { EventStore, SnapshotStore, saveSessionSnapshot } from '../persistence/event-store.js'
import { projectEvent } from '../persistence/message-projector.js'
import type { SessionConfig, ServerMessage } from '@hip/protocol'
import { splitAttachments, type AttachmentPayload } from './attachments.js'

function makeStore() {
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

const baseCfg: SessionConfig = { llmProvider: 'openai', model: 'gpt-4', tools: [], useEventSource: true, disablePlan: true }

function capturingRunner(captured: BaseMessage[][]): ModelRunner {
  return {
    async run(messages: BaseMessage[], o: ModelRunOptions) {
      captured.push([...messages])
      o.onText('ok')
      return new AIMessage('ok')
    },
  }
}

describe('Session image attachments', () => {
  let scratch: string
  beforeEach(async () => { scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-attach-')) })
  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('preserves image_url content parts through event-sourced runTurn rebuild', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))

    const { store } = makeStore()
    store.insertSession({ id: 's-attach', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })
    const captured: BaseMessage[][] = []
    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], disablePlan: true }
    const session = new Session('s-attach', cfg, undefined, store, undefined, 10_000, capturingRunner(captured), undefined, undefined, scratch)

    await session.sendMessage('describe this', () => {}, undefined, [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }])

    const userMessages = captured.flatMap((batch) => batch.filter((m) => m instanceof HumanMessage))
    expect(userMessages.length).toBeGreaterThan(0)
    const lastUser = userMessages[userMessages.length - 1]
    expect(Array.isArray(lastUser.content)).toBe(true)
    const parts = lastUser.content as Array<{ type: string }>
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'text', text: 'describe this' })
    expect(parts[1].type).toBe('image_url')
    expect(((parts[1] as unknown) as { image_url: { url: string } }).image_url.url).toMatch(/^data:image\/png;base64,/)
  })

  it('regenerate after restart preserves attachment content parts from events', async () => {
    const { db, store, eventStore, snapshotStore } = makeStore()
    store.insertSession({ id: 's-regen', title: 't', config: JSON.stringify(baseCfg), createdAt: 1, updatedAt: 1 })

    // Force a multimodal main model so runTurn does not strip image parts.
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue({
      openai: { id: 'openai', name: 'OpenAI', models: { 'gpt-4': { id: 'gpt-4', name: 'GPT-4', attachment: true } } },
    })
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(true)

    // Complete a first turn so a snapshot is saved.
    const session1 = new Session('s-regen', { ...baseCfg, cwd: scratch }, undefined, store, undefined, 10_000, capturingRunner([]))
    await session1.sendMessage('first message', () => {}, 'u1')
    const latestSeq = eventStore.latestSeq('s-regen')
    expect(latestSeq).toBeGreaterThan(0)

    // Simulate an interrupted second turn: the user_message event with attachments/contentParts
    // was persisted, but the assistant never completed (no snapshot was saved for this turn).
    const imgPath = path.join(scratch, 'regen.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    publishEvent(db, eventStore, 's-regen', 'user_message', {
      messageId: 'u2',
      content: 'describe this',
      timestamp: Date.now(),
      attachments: [{ id: 'a2', name: 'regen.png', mimeType: 'image/png' }],
      contentParts: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,regen-payload' } },
      ],
    })

    // Save an explicit stale snapshot representing the state after the first completed turn.
    saveSessionSnapshot(snapshotStore, 's-regen', latestSeq, {
      messages: [new HumanMessage('first message'), new AIMessage('first reply')],
      config: { ...baseCfg, cwd: scratch },
    })

    // Restart: a fresh Session instance loads the stale snapshot.
    const captured: BaseMessage[][] = []
    const session2 = new Session('s-regen', { ...baseCfg, cwd: scratch }, undefined, store, undefined, 10_000, capturingRunner(captured))
    await session2.hydrate()

    // Regenerate the interrupted turn.
    const events: { type: string; code?: string }[] = []
    await session2.regenerate((m) => events.push(m as { type: string; code?: string }))
    expect(events.some((e) => e.type === 'error')).toBe(false)

    // The runner must see the attachment-bearing user message, not just the stale snapshot.
    expect(captured.length).toBeGreaterThan(0)
    const lastBatch = captured[captured.length - 1]
    const userMessages = lastBatch.filter((m) => m instanceof HumanMessage)
    expect(userMessages.length).toBeGreaterThanOrEqual(2)
    const lastUser = userMessages[userMessages.length - 1]
    expect(Array.isArray(lastUser.content)).toBe(true)
    const parts = lastUser.content as Array<{ type: string }>
    expect(parts.some((p) => p.type === 'image_url')).toBe(true)

    vi.restoreAllMocks()
  })

  it('persists contentParts for image-agent turns', async () => {
    const { store, db } = makeStore()
    store.insertSession({ id: 's-img-persist', title: 't', config: JSON.stringify({ ...baseCfg, cwd: scratch }), createdAt: 1, updatedAt: 1 })

    // Create a minimal image agent config.
    const cwd = scratch
    await fs.mkdir(path.join(cwd, '.hip'), { recursive: true })
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )

    const imgPath = path.join(scratch, 'persist.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))

    // Force text-only main model and image agent available.
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue({
      openai: { id: 'openai', name: 'OpenAI', models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true } } },
    })
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const invoker: AgentInvoker = {
      async invoke(_agentId, _task, emit) {
        emit.token('vision result')
        return 'vision result'
      },
    }

    // Dummy runner keeps usesEnvModel=false so requireApiKey is skipped without auth.json.
    const dummyRunner: ModelRunner = {
      async run() {
        return new AIMessage('unused')
      },
    }
    const session = new Session(
      's-img-persist',
      { ...baseCfg, cwd },
      undefined,
      store,
      undefined,
      10_000,
      dummyRunner,
      undefined,
      () => invoker,
      scratch,
    )
    await session.sendMessage('describe this', () => {}, undefined, [{ id: 'a1', name: 'persist.png', mimeType: 'image/png', path: imgPath }])

    const rows = loadProjection(db, 's-img-persist')
    const userRow = rows.find((r) => r.type === 'user')
    expect(userRow).toBeDefined()
    const data = userRow!.data as { contentParts?: Array<{ type: string }> }
    expect(data.contentParts?.some((p) => p.type === 'image_url')).toBe(true)
  })
})

describe('Session multimodal attachment splitting', () => {
  let scratch: string
  let cwd: string
  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-split-'))
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-split-cwd-'))
    await fs.mkdir(path.join(cwd, '.hip'), { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
    await fs.rm(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('splits image+text attachments — image to image agent, text to main model', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    const txtPath = path.join(scratch, 'notes.txt')
    await fs.writeFile(txtPath, 'hello from file')

    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    const textCatalog = {
      openai: { id: 'openai', name: 'OpenAI', models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true } } },
      deepseek: { id: 'deepseek', name: 'DeepSeek', models: { 'deepseek-chat': { id: 'deepseek-chat', name: 'DeepSeek Chat', attachment: false } } },
    }
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const { store } = makeStore()
    store.insertSession({ id: 's-mixed', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const invokerSeen: { task?: string; attachments?: AttachmentPayload[]; parts?: Array<{ type: string }> } = {}
    const invoker: AgentInvoker = {
      async invoke(_agentId, task, emit, _signal, _hooks, extras, attachments) {
        invokerSeen.task = task
        invokerSeen.attachments = attachments
        invokerSeen.parts = extras?.attachmentParts
        emit.token('image description')
        return 'image description'
      },
    }

    const captured: BaseMessage[][] = []
    const runner: ModelRunner = {
      async run(messages: BaseMessage[], o: ModelRunOptions) {
        captured.push([...messages])
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-mixed', cfg, undefined, store, undefined, 10_000, runner, undefined, () => invoker, scratch)

    const attachments: AttachmentPayload[] = [
      { id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath },
      { id: 'a2', name: 'notes.txt', mimeType: 'text/plain', path: txtPath },
    ]
    await session.sendMessage('describe these', () => {}, undefined, attachments)

    // Image agent was dispatched and received only image_url parts (no text parts)
    expect(invokerSeen.task).toBe('describe these')
    expect(invokerSeen.attachments).toHaveLength(1)
    expect(invokerSeen.attachments![0].mimeType).toBe('image/png')
    expect(invokerSeen.parts).toHaveLength(1)
    expect((invokerSeen.parts![0] as unknown as { type: string }).type).toBe('image_url')

    // Main model received the text attachment content plus the merged vision result
    expect(captured.length).toBeGreaterThan(0)
    const lastBatch = captured[captured.length - 1]
    const userMessages = lastBatch.filter((m) => m instanceof HumanMessage)
    expect(userMessages.length).toBeGreaterThanOrEqual(1)
    const lastUser = userMessages[userMessages.length - 1]
    expect(Array.isArray(lastUser.content)).toBe(true)
    const parts = lastUser.content as Array<{ type: string; text?: string }>
    expect(parts[0].type).toBe('text')
    expect(parts[0].text).toContain('image description')
    expect(parts[0].text).toContain('describe these')
    const hasTextAttachment = parts.some((p) => p.type === 'text' && p.text?.includes('notes.txt'))
    expect(hasTextAttachment).toBe(true)
    const hasImageUrl = parts.some((p) => p.type === 'image_url')
    expect(hasImageUrl).toBe(false)
  })

  it('routes PDF+text with non-multimodal model — PDF text to main model', async () => {
    // A minimal valid PDF that pdf-parse can process
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000360 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
431
%%EOF`
    const pdfPath = path.join(scratch, 'doc.pdf')
    await fs.writeFile(pdfPath, pdfContent)
    const txtPath = path.join(scratch, 'notes.txt')
    await fs.writeFile(txtPath, 'hello from file')

    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    const textCatalog = {
      openai: { id: 'openai', name: 'OpenAI', models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true } } },
      deepseek: { id: 'deepseek', name: 'DeepSeek', models: { 'deepseek-chat': { id: 'deepseek-chat', name: 'DeepSeek Chat', attachment: false } } },
    }
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)
    vi.spyOn(catalogModule, 'isMultimodalModel').mockReturnValue(false)

    const { store } = makeStore()
    store.insertSession({ id: 's-pdf', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const invokerCalled = { count: 0 }
    const invoker: AgentInvoker = {
      async invoke(_agentId, _task, emit, _signal, _hooks, _extras, _attachments) {
        invokerCalled.count++
        emit.token('should not be called')
        return ''
      },
    }

    const captured: BaseMessage[][] = []
    const runner: ModelRunner = {
      async run(messages: BaseMessage[], o: ModelRunOptions) {
        captured.push([...messages])
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-pdf', cfg, undefined, store, undefined, 10_000, runner, undefined, () => invoker, scratch)

    const attachments: AttachmentPayload[] = [
      { id: 'a1', name: 'doc.pdf', mimeType: 'application/pdf', path: pdfPath },
      { id: 'a2', name: 'notes.txt', mimeType: 'text/plain', path: txtPath },
    ]
    await session.sendMessage('describe these', () => {}, undefined, attachments)

    // PDF has no image_url parts, so the image agent should NOT be dispatched
    expect(invokerCalled.count).toBe(0)

    // Main model received both the PDF text and the text/plain content
    expect(captured.length).toBeGreaterThan(0)
    const lastBatch = captured[captured.length - 1]
    const userMessages = lastBatch.filter((m) => m instanceof HumanMessage)
    expect(userMessages.length).toBeGreaterThanOrEqual(1)
    const lastUser = userMessages[userMessages.length - 1]
    expect(Array.isArray(lastUser.content)).toBe(true)
    const parts = lastUser.content as Array<{ type: string; text?: string }>
    const pdfPart = parts.find((p) => p.type === 'text' && p.text?.includes('doc.pdf'))
    expect(pdfPart).toBeDefined()
    const txtPart = parts.find((p) => p.type === 'text' && p.text?.includes('notes.txt'))
    expect(txtPart).toBeDefined()
  })

  it('splitAttachments correctly classifies attachments', () => {
    const attachments: AttachmentPayload[] = [
      { id: 'a1', name: 'img.png', mimeType: 'image/png', path: '/tmp/img.png' },
      { id: 'a2', name: 'doc.pdf', mimeType: 'application/pdf', path: '/tmp/doc.pdf' },
      { id: 'a3', name: 'vid.mp4', mimeType: 'video/mp4', path: '/tmp/vid.mp4' },
      { id: 'a4', name: 'notes.txt', mimeType: 'text/plain', path: '/tmp/notes.txt' },
      { id: 'a5', name: 'code.ts', mimeType: 'text/typescript', path: '/tmp/code.ts' },
    ]
    const { multimodal, text } = splitAttachments(attachments)
    expect(multimodal).toHaveLength(3)
    expect(multimodal.map((a) => a.mimeType)).toEqual(['image/png', 'application/pdf', 'video/mp4'])
    expect(text).toHaveLength(2)
    expect(text.map((a) => a.mimeType)).toEqual(['text/plain', 'text/typescript'])
  })

  it('splitAttachments handles empty/null input', () => {
    expect(splitAttachments([] as AttachmentPayload[])).toEqual({ multimodal: [], text: [] })
    expect(splitAttachments(null as unknown as AttachmentPayload[])).toEqual({ multimodal: [], text: [] })
  })
})
