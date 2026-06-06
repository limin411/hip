import { WebSocket } from 'ws'

const PORT = parseInt(process.argv[2])

const ws = new WebSocket(`ws://localhost:${PORT}`)

ws.on('open', () => {
  console.log('Connected')

  ws.send(JSON.stringify({
    type: 'session:create',
    id: 'e2e-test-1',
    config: {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
      systemPrompt: '你是一个简短的助手。用一句中文回答。',
    },
  }))
})

let tokens = ''

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())

  switch (msg.type) {
    case 'session:created':
      console.log('[session:created]', msg.sessionId)
      ws.send(JSON.stringify({
        type: 'message:send',
        sessionId: msg.sessionId,
        content: '1+1等于几？',
        role: 'user',
      }))
      break
    case 'agent:started':
      console.log('[agent:started]')
      break
    case 'token:stream':
      tokens += msg.delta
      process.stdout.write(msg.delta)
      break
    case 'agent:finished':
      console.log('\n[agent:finished]')
      break
    case 'message:complete':
      console.log('[message:complete] tokens:', tokens.length)
      console.log('SUCCESS: E2E protocol works!')
      ws.close()
      process.exit(0)
      break
    case 'error':
      console.error('[error]', msg.code, msg.message)
      ws.close()
      process.exit(1)
      break
  }
})

ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1) })
setTimeout(() => { console.error('timeout'); process.exit(1) }, 30000)
