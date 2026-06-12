import { describe, it, expect, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { providerKeyEnv } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { setActiveModel, getActiveModel, DEEPSEEK_DEFAULT } from '../config/providers.js'

/** config:setActiveModel must (a) move the process-global active model and (b) echo config:activeModel
 *  carrying the NEW active provider's key status, so the chat header's "no key" banner updates on a live
 *  switch instead of going stale until the next WS reconnect (model-config follow-up #3). */
describe('SessionManager config:setActiveModel', () => {
  const OPENAI_KEY = providerKeyEnv('openai') // HIP_MODEL_OPENAI_API_KEY
  afterEach(() => { setActiveModel(DEEPSEEK_DEFAULT); delete process.env[OPENAI_KEY] })

  function activeModelEcho(sent: ServerMessage[]) {
    return sent.find((m) => m.type === 'config:activeModel') as Extract<ServerMessage, { type: 'config:activeModel' }> | undefined
  }

  it('moves the global active model and echoes config:activeModel', () => {
    const mgr = new SessionManager()
    const sent: ServerMessage[] = []
    mgr.handle({ type: 'config:setActiveModel', providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' }, (m) => sent.push(m))
    expect(getActiveModel()).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
    expect(activeModelEcho(sent)).toMatchObject({ providerID: 'openai', modelID: 'gpt-4o' })
  })

  it('echoes hasApiKey=false when the new active provider has no key', () => {
    delete process.env[OPENAI_KEY]
    const mgr = new SessionManager()
    const sent: ServerMessage[] = []
    mgr.handle({ type: 'config:setActiveModel', providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' }, (m) => sent.push(m))
    expect(activeModelEcho(sent)?.hasApiKey).toBe(false)
  })

  it('echoes hasApiKey=true when the new active provider has a key', () => {
    process.env[OPENAI_KEY] = 'sk-test'
    const mgr = new SessionManager()
    const sent: ServerMessage[] = []
    mgr.handle({ type: 'config:setActiveModel', providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' }, (m) => sent.push(m))
    expect(activeModelEcho(sent)?.hasApiKey).toBe(true)
  })
})
