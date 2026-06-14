#!/usr/bin/env node
// hip ⇄ OpenCode bridge.
//
// hip's "Custom CLI agent" speaks a long-lived *turn-loop* on stdin/stdout:
// it writes one prompt terminated by the RS byte (\x1e) and reads the reply
// up to the next RS, keeping the same process alive across turns. OpenCode's
// `opencode run`, by contrast, is *one-shot* (prompt as an argument, run once,
// exit). This script bridges the two: it loops on hip's protocol and drives a
// fresh `opencode run` per turn.
//
// Continuity: OFF by default — each hip turn is an independent `opencode run`
// (safe; OpenCode does not carry context between turns). Set
// OPENCODE_BRIDGE_CONTINUE=1 to add `--continue` on turns after the first so
// OpenCode keeps context. CAVEAT: `opencode run --continue` resumes OpenCode's
// *global last session*, so if you also run OpenCode elsewhere those turns can
// cross. Only enable it if this is your sole OpenCode usage.
//
// Register it in Settings → 智能体管理 → 添加智能体 → 自定义命令行智能体:
//   命令 (command):   node
//   参数 (args):      /ABSOLUTE/PATH/TO/scripts/opencode-bridge.mjs
//   协议 (protocol):  精简 / Thin
//   推送模型:         off (recommended — let OpenCode use its own configured
//                     model). If on, hip injects HIP_PROVIDER/HIP_MODEL and this
//                     bridge passes `-m <provider>/<model>`; OpenCode must have
//                     that provider authed (`opencode auth login`).
//
// Configuration. The simplest path (GUI-friendly) is to append flags to the
// agent's 参数/args field after the script path, e.g.
//   node  /abs/opencode-bridge.mjs --pure            (recommended: skip plugins)
//   node  /abs/opencode-bridge.mjs --pure --continue (also keep cross-turn context)
// Any flag here is forwarded to `opencode run` verbatim, EXCEPT `--continue`,
// which enables the bridge's per-session continuity (added on turns after the
// first). Equivalent env overrides also work:
//   OPENCODE_BIN               opencode executable (default: "opencode")
//   OPENCODE_BRIDGE_CONTINUE   "1" to enable --continue (see caveat above)
//   OPENCODE_RUN_ARGS          extra `opencode run` args (space-separated)
import { spawn } from 'node:child_process'

const RS = '\x1e' // hip end-of-turn sentinel
const OPENCODE = process.env.OPENCODE_BIN || 'opencode'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g // strip terminal escape sequences

const cli = process.argv.slice(2) // flags after the script path (the 参数 field)
const CONTINUE = process.env.OPENCODE_BRIDGE_CONTINUE === '1' || cli.includes('--continue')
const EXTRA = [
  ...(process.env.OPENCODE_RUN_ARGS ? process.env.OPENCODE_RUN_ARGS.trim().split(/\s+/) : []),
  ...cli.filter((a) => a !== '--continue'), // --continue is the bridge's flag, not opencode's
].filter(Boolean)

let buf = ''
let firstTurn = true
let busy = false
let ended = false

process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  pump()
})
process.stdin.on('end', () => {
  ended = true
  if (!busy) process.exit(0)
})

function pump() {
  if (busy) return
  const i = buf.indexOf(RS)
  if (i < 0) {
    if (ended) process.exit(0)
    return
  }
  const prompt = buf.slice(0, i).replace(/^\n+|\n+$/g, '')
  buf = buf.slice(i + 1)
  if (!prompt) {
    pump()
    return
  }
  runTurn(prompt)
}

function runTurn(prompt) {
  busy = true
  const args = ['run']
  if (EXTRA.length) args.push(...EXTRA)
  if (CONTINUE && !firstTurn) args.push('--continue') // opt-in; resumes opencode's global last session
  if (process.env.HIP_PROVIDER && process.env.HIP_MODEL) {
    args.push('-m', `${process.env.HIP_PROVIDER}/${process.env.HIP_MODEL}`)
  }
  args.push(prompt)

  const child = spawn(OPENCODE, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  let sawOutput = false
  let errTail = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c) => {
    sawOutput = true
    process.stdout.write(c.replace(ANSI, '')) // stream through so hip shows tokens live
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => {
    errTail = (errTail + c).slice(-2000)
  })
  child.on('error', (e) => {
    process.stdout.write(`[opencode launch failed: ${e.message}]`)
    finish()
  })
  child.on('exit', (code) => {
    if (code !== 0) {
      const tail = errTail.replace(ANSI, '').trim().slice(-400)
      process.stdout.write(`${sawOutput ? '\n' : ''}[opencode exited ${code}${tail ? `: ${tail}` : ''}]`)
    }
    finish()
  })

  function finish() {
    process.stdout.write(RS) // end of this turn
    firstTurn = false
    busy = false
    if (ended && buf.indexOf(RS) < 0) {
      process.exit(0)
      return
    }
    pump()
  }
}
