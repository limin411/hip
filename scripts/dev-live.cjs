#!/usr/bin/env node
/**
 * Development launcher for hip.
 *
 * Handles two common pain points:
 * 1. Reads DEEPSEEK_API_KEY from a local .env file or prompt
 * 2. Kills any stale process occupying port 1420 before starting Tauri
 *
 * Usage:
 *   yarn dev:live
 *   DEEPSEEK_API_KEY=sk-xxx yarn dev:live
 */

const { spawn } = require('child_process')
const { existsSync, readFileSync } = require('fs')
const { resolve } = require('path')
const { createServer } = require('net')

const ROOT = resolve(__dirname, '..')
const PORT = 1420

function findEnvFile() {
  const candidates = ['.env', '.env']
  for (const name of candidates) {
    const path = resolve(ROOT, name)
    if (existsSync(path)) return path
  }
  return null
}

function loadEnv() {
  const envPath = findEnvFile()
  if (!envPath) return {}
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  const vars = {}
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return vars
}

function getPortPid(port) {
  return new Promise((resolve) => {
    // Prefer lsof on macOS / Linux
    const lsof = spawn('lsof', ['-i', `:${port}`, '-P', '-n', '-t'])
    let out = ''
    lsof.stdout.on('data', (d) => { out += d.toString() })
    lsof.on('close', (code) => {
      if (code === 0 && out.trim()) {
        resolve(out.trim().split(/\s+/)[0])
      } else {
        resolve(null)
      }
    })
    lsof.on('error', () => resolve(null))
  })
}

async function freePort(port) {
  const pid = await getPortPid(port)
  if (!pid) return false
  console.log(`[dev:live] port ${port} is occupied by pid ${pid}; killing stale process...`)
  process.kill(Number(pid), 'SIGTERM')
  // Give it a moment to release
  await new Promise((r) => setTimeout(r, 800))
  const still = await getPortPid(port)
  if (still) {
    process.kill(Number(still), 'SIGKILL')
    await new Promise((r) => setTimeout(r, 400))
  }
  return true
}

async function waitForPort(port, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const free = await new Promise((resolve) => {
      const s = createServer()
      s.once('error', () => resolve(false))
      s.once('listening', () => { s.close(() => resolve(true)) })
      s.listen(port)
    })
    if (free) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function main() {
  const fileEnv = loadEnv()
  const env = { ...process.env }

  // Merge file env only if not already set in shell
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!(k in env)) env[k] = v
  }

  if (!env.DEEPSEEK_API_KEY) {
    console.error('[dev:live] DEEPSEEK_API_KEY is not set.')
    console.error('Either:')
    console.error('  1. Create .env with DEEPSEEK_API_KEY=sk-...')
    console.error('  2. Or run: DEEPSEEK_API_KEY=sk-... yarn dev:live')
    process.exit(1)
  }

  await freePort(PORT)
  const ready = await waitForPort(PORT, 3000)
  if (!ready) {
    console.error(`[dev:live] port ${PORT} still not free; aborting`)
    process.exit(1)
  }

  console.log('[dev:live] starting tauri dev...')
  const child = spawn('yarn', ['tauri', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  })

  child.on('exit', (code) => process.exit(code ?? 0))

  // Forward common signals so child cleans up properly
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try { child.kill(sig) } catch {}
    })
  }
}

main().catch((err) => {
  console.error('[dev:live] error', err)
  process.exit(1)
})
