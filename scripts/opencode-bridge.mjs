#!/usr/bin/env node
// hip ⇄ OpenCode bridge.
//
// hip's "Custom CLI agent" speaks a long-lived *turn-loop*; OpenCode's
// `opencode run` is *one-shot* (prompt as an arg, run once, exit). This bridge
// loops on hip's protocol and drives a fresh `opencode run` per turn.
//
// Two modes (pick the one matching the agent's 协议/protocol in hip):
//
//   THIN (协议 = 精简 / Thin) — default. hip sends `<prompt>\x1e`; the bridge
//     runs `opencode run` and streams the final text back, terminated by \x1e.
//
//   RICH (协议 = 丰富 / Rich) — add `--rich` to the args. hip sends
//     {"type":"user","text":...} lines; the bridge runs `opencode run
//     --format json` and translates OpenCode's streamed parts into hip's rich
//     events so you SEE the thinking, tool calls, and sub-agent (task)
//     scheduling — not just the final answer:
//        opencode part            -> hip rich event
//        part.type "reasoning"    -> {type:"reasoning", delta}
//        part.type "text"         -> {type:"text", delta}
//        part.type "tool" (incl.  -> {type:"tool_start"} / {type:"tool_end"}
//          the "task" subagent)
//        (process exit)           -> {type:"done"}
//
// Register in Settings → 智能体管理 → 添加智能体 → 自定义命令行智能体:
//   命令:  node
//   参数:  /ABS/PATH/scripts/opencode-bridge.mjs --pure --rich   (for full stream)
//          /ABS/PATH/scripts/opencode-bridge.mjs --pure          (final text only)
//   协议:  丰富/Rich for --rich, otherwise 精简/Thin
//   推送模型: off recommended (let OpenCode use its own model)
//
// Flags after the script are forwarded to `opencode run` verbatim EXCEPT the
// bridge's own: `--rich` (mode) and `--continue` (per-session continuity; see
// caveat below). Equivalent env: OPENCODE_BIN, OPENCODE_BRIDGE_CONTINUE=1,
// OPENCODE_RUN_ARGS. `--continue` resumes OpenCode's *global last session*, so
// only use it if hip is your sole OpenCode usage.
import { spawn } from 'node:child_process'

const RS = '\x1e' // hip thin end-of-turn sentinel
const OPENCODE = process.env.OPENCODE_BIN || 'opencode'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

const cli = process.argv.slice(2)
const RICH = cli.includes('--rich')
const CONTINUE = process.env.OPENCODE_BRIDGE_CONTINUE === '1' || cli.includes('--continue')
const EXTRA = [
  ...(process.env.OPENCODE_RUN_ARGS ? process.env.OPENCODE_RUN_ARGS.trim().split(/\s+/) : []),
  ...cli.filter((a) => a !== '--continue' && a !== '--rich'), // bridge-only flags
].filter(Boolean)

let firstTurn = true

/** Build the `opencode run …` argv. json=true adds `--format json` (rich mode). */
function opencodeArgs(prompt, json) {
  const args = ['run']
  if (json) args.push('--format', 'json')
  if (EXTRA.length) args.push(...EXTRA)
  if (CONTINUE && !firstTurn) args.push('--continue')
  if (process.env.HIP_PROVIDER && process.env.HIP_MODEL) {
    args.push('-m', `${process.env.HIP_PROVIDER}/${process.env.HIP_MODEL}`)
  }
  args.push(prompt)
  return args
}

if (RICH) runRichMode()
else runThinMode()

// ---------------------------------------------------------------------------
// THIN mode: <prompt>\x1e  ->  opencode run  ->  <streamed text>\x1e
// ---------------------------------------------------------------------------
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
    const child = spawn(OPENCODE, opencodeArgs(prompt, false), { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
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

// ---------------------------------------------------------------------------
// RICH mode: {"type":"user","text":…}  ->  opencode run --format json
//            ->  hip rich events ({text|reasoning|tool_start|tool_end|done})
// ---------------------------------------------------------------------------
function runRichMode() {
  let ib = ''
  const queue = []
  let busy = false
  let ended = false

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
  process.stdin.on('end', () => { ended = true; if (!busy && queue.length === 0) process.exit(0) })

  function emit(ev) { process.stdout.write(JSON.stringify(ev) + '\n') }

  function drain() {
    if (busy) return
    if (queue.length === 0) { if (ended) process.exit(0); return }
    busy = true
    runRichTurn(queue.shift(), () => { busy = false; firstTurn = false; drain() })
  }

  function runRichTurn(text, done) {
    const child = spawn(OPENCODE, opencodeArgs(text, true), { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    const state = { len: Object.create(null), started: new Set(), ended: new Set() }
    let ob = ''
    let errTail = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c) => {
      ob += c
      let nl
      while ((nl = ob.indexOf('\n')) >= 0) {
        const line = ob.slice(0, nl).trim()
        ob = ob.slice(nl + 1)
        if (line) mapPart(line, state, emit)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c) => { errTail = (errTail + c).slice(-2000) })
    child.on('error', (e) => { emit({ type: 'text', delta: `[opencode launch failed: ${e.message}]` }); emit({ type: 'done' }); done() })
    child.on('exit', (code) => {
      const last = ob.trim()
      if (last) mapPart(last, state, emit)
      if (code !== 0) {
        const tail = errTail.replace(ANSI, '').trim().slice(-400)
        emit({ type: 'text', delta: `\n[opencode exited ${code}${tail ? `: ${tail}` : ''}]` })
      }
      emit({ type: 'done' })
      done()
    })
  }
}

/** Translate one `opencode run --format json` line into a hip rich event. */
function mapPart(line, state, emit) {
  let o
  try { o = JSON.parse(line) } catch { return }
  const part = o && o.part
  if (!part || typeof part !== 'object') return
  const ptype = part.type

  if (ptype === 'text' || ptype === 'reasoning') {
    const full = typeof part.text === 'string' ? part.text : ''
    const key = (ptype === 'reasoning' ? 'r:' : 't:') + (part.id || '')
    const prev = state.len[key] || 0
    if (full.length > prev) {
      const delta = full.slice(prev)
      state.len[key] = full.length
      emit(ptype === 'reasoning' ? { type: 'reasoning', delta } : { type: 'text', delta })
    }
    return
  }

  if (ptype === 'tool') {
    const id = part.callID || part.id
    if (!id) return
    const name = part.tool || 'tool'
    const st = part.state || {}
    const status = st.status
    if (status === 'running' || status === 'pending') {
      if (!state.started.has(id)) { state.started.add(id); emit({ type: 'tool_start', id, name, input: st.input }) }
    } else if (status === 'completed' || status === 'error') {
      if (!state.started.has(id)) { state.started.add(id); emit({ type: 'tool_start', id, name, input: st.input }) }
      if (!state.ended.has(id)) {
        state.ended.add(id)
        const out = typeof st.output === 'string' ? st.output : st.output != null ? JSON.stringify(st.output) : undefined
        emit({ type: 'tool_end', id, output: out, ok: status === 'completed' })
      }
    }
    return
  }
  // step-start / step-finish / file / patch / snapshot / unknown → not surfaced
}
