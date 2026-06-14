#!/usr/bin/env node
// Test stand-in for `opencode serve`. Implements just enough of OpenCode's real
// HTTP + SSE contract (captured from opencode 1.17.6's OpenAPI) for the rich
// bridge to drive it without a real (paid) LLM:
//
//   GET  /global/health                  -> 200
//   POST /session                        -> { id: "ses_mock" }
//   GET  /event                          -> SSE bus (server.connected, then per-turn events)
//   POST /session/:id/prompt_async       -> 204, then pushes a scripted turn over SSE
//
// The scripted turn mirrors a real reasoning model: it emits the user message
// (which the bridge must NOT echo), an assistant reasoning part (streamed via
// message.part.delta), a `task` sub-agent tool (running -> completed), the
// answer text (streamed), and finally session.idle.
import { createServer } from 'node:http'

const args = process.argv.slice(2)
if (!args.includes('serve')) { process.stdout.write('mock-opencode-server: expected `serve`\n'); process.exit(1) }
const portArg = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : 0 })()

const SID = 'ses_mock'
const clients = new Set()
function broadcast(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`
  for (const res of clients) res.write(line)
}

let turnSeq = 0
function runScriptedTurn(prompt, model) {
  const n = ++turnSeq
  const aMsg = `msg_a${n}`
  const uMsg = `msg_u${n}`
  const rPart = `prt_r${n}`
  const xPart = `prt_x${n}`
  const tPart = `prt_t${n}`
  const part = (extra) => ({ messageID: aMsg, sessionID: SID, ...extra })

  // user message + its text part — the bridge must skip this (role: user)
  broadcast({ type: 'message.updated', properties: { sessionID: SID, info: { id: uMsg, sessionID: SID, role: 'user' } } })
  broadcast({ type: 'message.part.updated', properties: { sessionID: SID, part: { id: `prt_u${n}`, messageID: uMsg, sessionID: SID, type: 'text', text: prompt }, time: 0 } })

  // assistant message
  broadcast({ type: 'message.updated', properties: { sessionID: SID, info: { id: aMsg, sessionID: SID, role: 'assistant' } } })

  // reasoning: created empty, then streamed via delta
  broadcast({ type: 'message.part.updated', properties: { sessionID: SID, part: part({ id: rPart, type: 'reasoning', text: '' }), time: 0 } })
  broadcast({ type: 'message.part.delta', properties: { sessionID: SID, messageID: aMsg, partID: rPart, field: 'text', delta: `thinking about ${prompt}` } })

  // sub-agent scheduling: a `task` tool running -> completed
  broadcast({ type: 'message.part.updated', properties: { sessionID: SID, part: part({ id: tPart, callID: 'call_1', type: 'tool', tool: 'task', state: { status: 'running', input: { description: 'spawn subagent' } } }), time: 0 } })
  broadcast({ type: 'message.part.updated', properties: { sessionID: SID, part: part({ id: tPart, callID: 'call_1', type: 'tool', tool: 'task', state: { status: 'completed', input: { description: 'spawn subagent' }, output: 'subagent done' } }), time: 0 } })

  // answer text: created empty, then streamed via delta (+model marker if pushed)
  const answer = `reply to: ${prompt}${model ? ` [model=${model.providerID}/${model.modelID}]` : ''}`
  broadcast({ type: 'message.part.updated', properties: { sessionID: SID, part: part({ id: xPart, type: 'text', text: '' }), time: 0 } })
  broadcast({ type: 'message.part.delta', properties: { sessionID: SID, messageID: aMsg, partID: xPart, field: 'text', delta: answer } })

  // turn complete
  broadcast({ type: 'session.idle', properties: { sessionID: SID } })
}

const server = createServer((req, res) => {
  const url = req.url || ''
  if (req.method === 'GET' && url.startsWith('/global/health')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return
  }
  if (req.method === 'POST' && url === '/session') {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: SID })); return
  }
  if (req.method === 'GET' && url.startsWith('/event')) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify({ type: 'server.connected', properties: {} })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'POST' && /^\/session\/[^/]+\/prompt_async/.test(url)) {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let parsed = {}
      try { parsed = JSON.parse(body || '{}') } catch { /* ignore */ }
      const prompt = (parsed.parts || []).map((p) => p.text).filter(Boolean).join(' ')
      res.writeHead(204); res.end()
      // push the turn after responding, on a later tick (mirrors async streaming)
      setTimeout(() => runScriptedTurn(prompt, parsed.model), 5)
    })
    return
  }
  res.writeHead(404); res.end()
})

server.listen(portArg, '127.0.0.1', () => {
  const port = server.address().port
  // The bridge scans stdout+stderr for this line to learn the base URL.
  process.stderr.write(`opencode server listening on http://127.0.0.1:${port}\n`)
})
