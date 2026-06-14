#!/usr/bin/env node
// hip ⇄ OpenCode bridge.
//
// hip's "Custom CLI agent" speaks a long-lived *turn-loop* over stdin/stdout.
// This bridge adapts OpenCode to it. There are TWO modes — pick the one that
// matches the agent's 协议/protocol in hip:
//
//   THIN (协议 = 精简 / Thin) — default. hip sends `<prompt>\x1e`; the bridge
//     runs the one-shot `opencode run` and streams the final text back,
//     terminated by \x1e. Simple, but you only get the final answer.
//
//   RICH (协议 = 丰富 / Rich) — add `--rich` to the args. This is the mode that
//     surfaces the FULL stream — thinking, tool calls, sub-agent scheduling —
//     not just the final answer.
//
//     IMPORTANT (why this is NOT `opencode run --format json`): the one-shot
//     `opencode run --format json` does NOT serialize reasoning/thinking
//     (opencode issue #7202), only reports tools once they *complete*, and
//     buffers its whole output to the end. So rich mode instead drives a
//     long-lived `opencode serve` over its HTTP API + Server-Sent-Events bus
//     — the very interface OpenCode's own TUI uses — which streams everything:
//        opencode SSE event / part           -> hip rich event
//        message.part.updated  part=reasoning -> {type:"reasoning", delta}
//        message.part.delta    field=text (on a reasoning part)
//        message.part.updated  part=text      -> {type:"text", delta}
//        message.part.delta    field=text (on a text/assistant part)
//        message.part.updated  part=tool      -> {type:"tool_start"|"tool_end"}
//          (incl. the "task" tool = sub-agent execution)
//        message.part.updated  part=subtask   -> a "subagent:<name>" card
//        session.idle                         -> {type:"done"}  (turn complete)
//     One opencode session is created per bridge process and reused across
//     turns, so the conversation has real, *isolated* continuity (unlike the
//     thin mode's global `--continue`).
//
// Register in Settings → 智能体管理 → 添加智能体 → 自定义命令行智能体:
//   命令:  node
//   参数:  /ABS/PATH/scripts/opencode-bridge.mjs --pure --rich   (full stream)
//          /ABS/PATH/scripts/opencode-bridge.mjs --pure          (final text only)
//   协议:  丰富/Rich for --rich, otherwise 精简/Thin
//   推送模型: off recommended (let OpenCode use its own model). NOTE: reasoning
//            only appears if the model is a reasoning model (e.g.
//            deepseek-reasoner, kimi-k2-thinking) — a plain chat model has no
//            thinking to stream.
//
// Bridge-interpreted flags: `--rich` (mode), `--pure` (passed to opencode),
// `--agent <name>` (rich: per-message agent), `--continue` (thin only; see
// caveat below). Equivalent env: OPENCODE_BIN, OPENCODE_BRIDGE_CONTINUE=1,
// OPENCODE_RUN_ARGS (thin), OPENCODE_SERVE_ARGS / OPENCODE_SERVE_PORT (rich),
// OPENCODE_AGENT (rich).
import { spawn } from 'node:child_process'

const RS = '\x1e' // hip thin end-of-turn sentinel
const OPENCODE = process.env.OPENCODE_BIN || 'opencode'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cli = process.argv.slice(2)
const RICH = cli.includes('--rich')
const PURE = cli.includes('--pure')
const CONTINUE = process.env.OPENCODE_BRIDGE_CONTINUE === '1' || cli.includes('--continue')
const AGENT = flagValue('--agent') || process.env.OPENCODE_AGENT || ''
// thin-mode passthrough to `opencode run`
const EXTRA = [
  ...(process.env.OPENCODE_RUN_ARGS ? process.env.OPENCODE_RUN_ARGS.trim().split(/\s+/) : []),
  ...cli.filter((a) => a !== '--continue' && a !== '--rich'), // bridge-only flags
].filter(Boolean)

function flagValue(name) {
  const i = cli.indexOf(name)
  return i >= 0 && cli[i + 1] && !cli[i + 1].startsWith('-') ? cli[i + 1] : ''
}

let firstTurn = true

// A `opencode serve` child shared by rich mode; killed when the bridge exits so
// we never orphan a server.
let serveProc = null
function killServe() {
  try { if (serveProc) { serveProc.kill('SIGKILL'); serveProc = null } } catch { /* ignore */ }
}
process.on('exit', killServe)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { killServe(); process.exit(0) })

if (RICH) runRichMode()
else runThinMode()

// ===========================================================================
// THIN mode: <prompt>\x1e  ->  opencode run  ->  <streamed text>\x1e
// ===========================================================================
/** Build the one-shot `opencode run …` argv (thin mode only). */
function opencodeArgs(prompt) {
  const args = ['run']
  if (EXTRA.length) args.push(...EXTRA)
  if (CONTINUE && !firstTurn) args.push('--continue')
  if (process.env.HIP_PROVIDER && process.env.HIP_MODEL) {
    args.push('-m', `${process.env.HIP_PROVIDER}/${process.env.HIP_MODEL}`)
  }
  args.push(prompt)
  return args
}

function runThinMode() {
  let buf = ''
  let busy = false
  let ended = false

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { buf += d; pump() })
  process.stdin.on('end', () => { ended = true; if (!busy) process.exit(0) })

  function pump() {
    if (busy) return
    const i = buf.indexOf(RS)
    if (i < 0) { if (ended) process.exit(0); return }
    const prompt = buf.slice(0, i).replace(/^\n+|\n+$/g, '')
    buf = buf.slice(i + 1)
    if (!prompt) { pump(); return }
    busy = true
    const child = spawn(OPENCODE, opencodeArgs(prompt), { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    let sawOutput = false
    let errTail = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => { sawOutput = true; process.stdout.write(c.replace(ANSI, '')) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c) => { errTail = (errTail + c).slice(-2000) })
    child.on('error', (e) => { process.stdout.write(`[opencode launch failed: ${e.message}]`); finish() })
    child.on('exit', (code) => {
      if (code !== 0) {
        const tail = errTail.replace(ANSI, '').trim().slice(-400)
        process.stdout.write(`${sawOutput ? '\n' : ''}[opencode exited ${code}${tail ? `: ${tail}` : ''}]`)
      }
      finish()
    })
    function finish() {
      process.stdout.write(RS)
      firstTurn = false
      busy = false
      if (ended && buf.indexOf(RS) < 0) { process.exit(0); return }
      pump()
    }
  }
}

// ===========================================================================
// RICH mode: {"type":"user","text":…}  ->  opencode serve (HTTP + SSE)
//            ->  hip rich events ({text|reasoning|tool_start|tool_end|done})
// ===========================================================================
function runRichMode() {
  const PORT = flagValue('--port') || process.env.OPENCODE_SERVE_PORT || '0'
  const SERVE_EXTRA = process.env.OPENCODE_SERVE_ARGS ? process.env.OPENCODE_SERVE_ARGS.trim().split(/\s+/) : []

  let ib = ''
  const queue = []
  let busy = false
  let ended = false

  let baseURL = null
  let sessionID = null
  let sseStarted = false
  let turn = null // per-turn streaming state

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => {
    ib += d
    let nl
    while ((nl = ib.indexOf('\n')) >= 0) {
      const line = ib.slice(0, nl).trim()
      ib = ib.slice(nl + 1)
      if (!line) continue
      let o
      try { o = JSON.parse(line) } catch { continue }
      if (o && o.type === 'user' && typeof o.text === 'string') { queue.push(o.text); drain() }
    }
  })
  process.stdin.on('end', () => { ended = true; if (!busy && queue.length === 0) { killServe(); process.exit(0) } })

  function emit(ev) { process.stdout.write(JSON.stringify(ev) + '\n') }

  function drain() {
    if (busy) return
    if (queue.length === 0) { if (ended) { killServe(); process.exit(0) } return }
    busy = true
    runRichTurn(queue.shift()).finally(() => { busy = false; firstTurn = false; drain() })
  }

  async function runRichTurn(text) {
    try {
      await ensureServer()
    } catch (e) {
      emit({ type: 'text', delta: `[opencode bridge: failed to start server: ${e.message}]` })
      emit({ type: 'done' })
      return
    }
    // Fresh per-turn streaming state. partType/len/roles correlate streamed
    // deltas (which only say "the .text field grew") back to whether the part
    // is the assistant's thinking, the answer, or a user-message echo to skip.
    const t = {
      partType: Object.create(null),
      len: Object.create(null),
      roles: Object.create(null),
      syn: new Set(),
      tStarted: new Set(),
      tEnded: new Set(),
      done: false,
      resolve: null,
      awaiting: true, // honor session.idle as soon as the turn exists
    }
    turn = t
    const finished = new Promise((res) => { t.resolve = () => { if (!t.done) { t.done = true; res() } } })

    const body = { parts: [{ type: 'text', text }] }
    if (process.env.HIP_PROVIDER && process.env.HIP_MODEL) {
      body.model = { providerID: process.env.HIP_PROVIDER, modelID: process.env.HIP_MODEL }
    }
    if (AGENT) body.agent = AGENT

    try {
      const res = await fetch(`${baseURL}/session/${sessionID}/prompt_async`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (res.status < 200 || res.status >= 300) {
        const tx = await res.text().catch(() => '')
        emit({ type: 'text', delta: `[opencode ${res.status}: ${tx.slice(0, 300)}]` })
        t.resolve()
      }
    } catch (e) {
      emit({ type: 'text', delta: `[opencode prompt failed: ${e.message}]` })
      t.resolve()
    }

    await finished
    emit({ type: 'done' })
  }

  async function ensureServer() {
    if (!serveProc) {
      const args = ['serve', '--port', String(PORT), '--print-logs']
      if (PURE) args.push('--pure')
      args.push(...SERVE_EXTRA)
      serveProc = spawn(OPENCODE, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
      serveProc.on('exit', (code) => {
        serveProc = null
        if (turn && !turn.done) { emit({ type: 'text', delta: `\n[opencode serve exited ${code}]` }); turn.resolve() }
      })
      baseURL = await waitForListening(serveProc)
      await waitForHealth(baseURL)
    }
    if (!sessionID) {
      const r = await fetch(`${baseURL}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const s = await r.json().catch(() => null)
      sessionID = s && s.id
      if (!sessionID) throw new Error(`POST /session returned no id (status ${r.status})`)
    }
    if (!sseStarted) {
      sseStarted = true
      subscribeEvents().catch((e) => {
        if (turn && !turn.done) { emit({ type: 'text', delta: `\n[opencode event stream error: ${e.message}]` }); turn.resolve() }
      })
    }
  }

  function waitForListening(proc) {
    return new Promise((resolve, reject) => {
      let out = ''
      const onData = (c) => {
        out += c.toString()
        const m = out.match(/listening on\s+(https?:\/\/[^\s]+)/i)
        if (m) { cleanup(); resolve(m[1].replace(/\/+$/, '')) }
      }
      const onExit = (code) => { cleanup(); reject(new Error(`opencode serve exited ${code} before it began listening`)) }
      const timer = setTimeout(() => { cleanup(); reject(new Error('timed out waiting for opencode serve to listen')) }, 60000)
      function cleanup() {
        clearTimeout(timer)
        proc.stdout.off('data', onData)
        proc.stderr.off('data', onData)
        proc.off('exit', onExit)
      }
      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)
      proc.on('exit', onExit)
    })
  }

  async function waitForHealth(base) {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`${base}/global/health`); if (r.ok) return } catch { /* not up yet */ }
      await sleep(250)
    }
    // Non-fatal: POST /session below will surface any real failure.
  }

  async function subscribeEvents() {
    const res = await fetch(`${baseURL}/event`)
    if (!res.ok || !res.body) throw new Error(`/event responded ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
        if (data) handleEvent(data)
      }
    }
  }

  function handleEvent(data) {
    let ev
    try { ev = JSON.parse(data) } catch { return }
    if (!ev || typeof ev.type !== 'string') return
    const p = ev.properties || {}
    if (p.sessionID && sessionID && p.sessionID !== sessionID) return
    const t = turn
    if (!t) return
    switch (ev.type) {
      case 'message.updated': {
        const info = p.info
        if (info && info.id) t.roles[info.id] = info.role
        return
      }
      case 'message.part.updated': return onPartUpdated(p.part, t)
      case 'message.part.delta': return onPartDelta(p, t)
      case 'session.error': {
        emit({ type: 'text', delta: `\n[opencode error: ${safeErr(p.error)}]` })
        t.resolve()
        return
      }
      case 'session.idle': { if (t.awaiting) t.resolve(); return }
    }
  }

  // Full-part updates: record the part's type/role, and gap-fill any text that
  // the deltas didn't already emit (covers parts created before we knew them).
  function onPartUpdated(part, t) {
    if (!part || typeof part !== 'object') return
    const id = part.id
    const ptype = part.type
    if (id) t.partType[id] = ptype

    if (ptype === 'reasoning' || ptype === 'text') {
      if (part.synthetic) { if (id) t.syn.add(id); return }
      if (ptype === 'text' && t.roles[part.messageID] !== 'assistant') return
      const full = typeof part.text === 'string' ? part.text : ''
      const prev = t.len[id] || 0
      if (full.length > prev) {
        emit(ptype === 'reasoning' ? { type: 'reasoning', delta: full.slice(prev) } : { type: 'text', delta: full.slice(prev) })
        t.len[id] = full.length
      }
      return
    }
    if (ptype === 'tool') return mapTool(part, t)
    if (ptype === 'subtask') return mapSubtask(part, t)
  }

  // Incremental deltas — the smooth token-by-token stream. `field:"text"` means
  // the part's .text grew; both reasoning and answer parts use .text, so we look
  // up the part's type (learned from message.part.updated) to route it.
  function onPartDelta(p, t) {
    if (p.field !== 'text') return
    const id = p.partID
    const ptype = t.partType[id]
    if (ptype !== 'reasoning' && ptype !== 'text') return // unknown yet → part.updated gap-fills
    if (t.syn.has(id)) return
    if (ptype === 'text' && t.roles[p.messageID] !== 'assistant') return
    const delta = typeof p.delta === 'string' ? p.delta : ''
    if (!delta) return
    emit(ptype === 'reasoning' ? { type: 'reasoning', delta } : { type: 'text', delta })
    t.len[id] = (t.len[id] || 0) + delta.length
  }

  function mapTool(part, t) {
    const id = part.callID || part.id
    if (!id) return
    const name = part.tool || 'tool'
    const st = part.state || {}
    const status = st.status
    if (status === 'running' || status === 'pending') {
      if (!t.tStarted.has(id)) { t.tStarted.add(id); emit({ type: 'tool_start', id, name, input: st.input }) }
    } else if (status === 'completed' || status === 'error') {
      if (!t.tStarted.has(id)) { t.tStarted.add(id); emit({ type: 'tool_start', id, name, input: st.input }) }
      if (!t.tEnded.has(id)) {
        t.tEnded.add(id)
        const out = typeof st.output === 'string' ? st.output : st.output != null ? JSON.stringify(st.output) : undefined
        emit({ type: 'tool_end', id, output: out, ok: status === 'completed' })
      }
    }
  }

  // A subtask part is OpenCode announcing it scheduled a sub-agent. Surface it
  // as a one-shot card so the scheduling is visible (the sub-agent's actual run
  // also arrives separately as a `task` tool part).
  function mapSubtask(part, t) {
    const id = part.id
    if (!id || t.tStarted.has(id)) return
    t.tStarted.add(id); t.tEnded.add(id)
    const name = `subagent${part.agent ? `:${part.agent}` : ''}`
    emit({ type: 'tool_start', id, name, input: { description: part.description, prompt: part.prompt, model: part.model } })
    emit({ type: 'tool_end', id, output: part.description || undefined, ok: true })
  }

  function safeErr(e) {
    try { return typeof e === 'string' ? e : JSON.stringify(e).slice(0, 300) } catch { return 'unknown' }
  }
}
