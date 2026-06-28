import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
import type { SessionConfig } from '@hip/protocol'

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
  afterEach(async () => { await fs.rm(scratch, { recursive: true, force: true }) })

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
  })
})
