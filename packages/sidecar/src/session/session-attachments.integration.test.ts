import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

function makeStore() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

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

    const st = makeStore()
    st.insertSession({ id: 's-attach', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })
    const captured: BaseMessage[][] = []
    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], disablePlan: true }
    const session = new Session('s-attach', cfg, undefined, st, undefined, 10_000, capturingRunner(captured), undefined, undefined, scratch)

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
})
