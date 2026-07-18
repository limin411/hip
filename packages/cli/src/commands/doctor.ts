import { CLI_VERSION, resolveSidecarPackageVersion } from '../version.js'
import { connectSidecar, DiscoveryError } from '../sidecar/connect.js'
import { discoveryPath, readDiscovery } from '../sidecar/discovery.js'
import { resolveHipBaseDir } from '../sidecar/hip-base.js'
import { resolveSidecarEntry } from '../sidecar/resolve-entry.js'
import { bootstrapIsolation } from '../sidecar/env-bootstrap.js'
import { spawnSidecar, stopSpawned } from '../sidecar/spawn.js'
import { HipWsClient } from '../client/ws-client.js'
import { waitReady } from '../client/turn-runner.js'

/**
 * Product doctor: discovery + attach health (requires running Tauri app).
 * Optional: HIP_CLI_DEV_SPAWN=1 hip doctor --sidecar-self-test for isolated spawn check.
 */
export async function runDoctor(flags: { sidecarSelfTest?: boolean } = {}): Promise<number> {
  process.stdout.write(`hip doctor ${CLI_VERSION}\n`)
  const scVer = resolveSidecarPackageVersion()
  if (scVer) process.stdout.write(`sidecar package: ${scVer}\n`)

  const base = resolveHipBaseDir()
  const discPath = discoveryPath()
  process.stdout.write(`hip base: ${base}\n`)
  process.stdout.write(`discovery: ${discPath}\n`)

  if (flags.sidecarSelfTest || process.env.HIP_CLI_DEV_SPAWN === '1') {
    return runSidecarSelfTest()
  }

  try {
    const doc = readDiscovery()
    process.stdout.write(`discovery: ok pid=${doc.pid} port=${doc.port}\n`)
    if (doc.hipDataDir && doc.hipDataDir !== base) {
      process.stdout.write(`warn: hipDataDir mismatch file=${doc.hipDataDir} resolved=${base}\n`)
    }
  } catch (err) {
    if (err instanceof DiscoveryError) {
      process.stderr.write(`discovery: ${err.code} ${err.message}\n`)
      if (err.code === 'APP_NOT_RUNNING') {
        process.stderr.write('Start the hip desktop app, then retry.\n')
      }
      return err.code === 'APP_NOT_RUNNING' ? 3 : 3
    }
    process.stderr.write(`discovery: FAIL ${(err as Error).message}\n`)
    return 3
  }

  try {
    const conn = await connectSidecar({
      sidecar: 'attach',
      allowNoKey: true,
      clientRole: 'cli',
    })
    try {
      process.stdout.write(`ready: hasApiKey=${conn.hasApiKey} guiPresent=${conn.guiPresent}\n`)
      if (!conn.hasApiKey) {
        process.stdout.write('note: no API key — live runs will fail with NO_API_KEY_AT_READY\n')
      }
      process.stdout.write('doctor: OK (attached to running app)\n')
      return 0
    } finally {
      await conn.close()
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    process.stderr.write(`doctor: FAIL ${code ?? ''} ${(err as Error).message}\n`)
    if (code === 'APP_NOT_RUNNING') {
      process.stderr.write('Start the hip desktop app, then retry.\n')
    }
    return 3
  }
}

async function runSidecarSelfTest(): Promise<number> {
  process.stdout.write('mode: --sidecar-self-test (isolated; not product attach)\n')
  try {
    const entry = resolveSidecarEntry()
    process.stdout.write(`sidecar entry: ${entry.kind} → ${entry.command} ${entry.args.join(' ')}\n`)
  } catch (err) {
    process.stderr.write(`sidecar entry: FAIL ${(err as Error).message}\n`)
    return 3
  }

  const iso = bootstrapIsolation({ setHome: true, dbMemory: true })
  process.stdout.write(`isolation root: ${iso.root}\n`)

  let spawned: Awaited<ReturnType<typeof spawnSidecar>> | undefined
  const client = new HipWsClient()
  try {
    spawned = await spawnSidecar({
      env: iso.env,
      parentWatch: true,
      debug: process.env.HIP_CLI_DEBUG === '1',
    })
    process.stdout.write(`handshake: port=${spawned.port} (token redacted)\n`)
    const readyP = waitReady((h) => client.onMessage(h), { allowNoKey: true, timeoutMs: 15_000 })
    await client.connect(spawned.port, spawned.token, { clientRole: 'cli' })
    const ready = await readyP
    process.stdout.write(`ready: hasApiKey=${ready.hasApiKey}\n`)
    process.stdout.write('doctor self-test: OK\n')
    return 0
  } catch (err) {
    process.stderr.write(`doctor self-test: FAIL ${(err as Error).message}\n`)
    return 3
  } finally {
    client.close()
    if (spawned) await stopSpawned(spawned)
  }
}
