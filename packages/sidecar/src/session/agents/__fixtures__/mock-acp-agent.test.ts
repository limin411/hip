import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, 'mock-acp-agent.mjs')

describe('mock-acp-agent fixture', () => {
  it('initializes, creates a session, and streams an answer', async () => {
    const child = spawn('node', [AGENT], { stdio: ['pipe', 'pipe', 'inherit'] })
    const updates: any[] = []
    const conn = new ClientSideConnection(
      () => ({ async sessionUpdate(p) { updates.push(p) }, async requestPermission() { return { outcome: { outcome: 'cancelled' } } } }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    )
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const s = await conn.newSession({ cwd: process.cwd(), mcpServers: [] })
    const res = await conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text: 'hi' }] })
    child.kill('SIGTERM')
    expect(res.stopReason).toBe('end_turn')
    const text = updates.filter((u) => u.update?.sessionUpdate === 'agent_message_chunk').map((u) => u.update.content.text).join('')
    expect(text).toContain('hello world')
  })
})
