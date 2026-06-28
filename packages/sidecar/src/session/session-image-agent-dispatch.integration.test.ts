import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { AttachmentPayload } from './attachments.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { ServerMessage } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import * as catalogModule from '../config/catalog.js'

function makeStore() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

const textCatalog = {
  openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
  deepseek: { id: 'deepseek', name: 'DeepSeek', env: [], models: { 'deepseek-chat': { id: 'deepseek-chat', attachment: false } } },
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
  })
})
