import { bootstrapIsolation } from '../sidecar/env-bootstrap.js'
import { resolveSidecarEntry } from '../sidecar/resolve-entry.js'
import { spawnSidecar, stopSpawned } from '../sidecar/spawn.js'
import { HipWsClient } from '../client/ws-client.js'
import { waitReady } from '../client/turn-runner.js'
import { CLI_VERSION, resolveSidecarPackageVersion } from '../version.js'

export async function runDoctor(): Promise<number> {
  process.stdout.write(`hip doctor ${CLI_VERSION}\n`)
  const scVer = resolveSidecarPackageVersion()
  if (scVer) process.stdout.write(`sidecar package: ${scVer}\n`)

  try {
    const entry = resolveSidecarEntry()
    process.stdout.write(`sidecar entry: ${entry.kind} → ${entry.command} ${entry.args.join(' ')}\n`)
  } catch (err) {
    process.stderr.write(`sidecar entry: FAIL ${(err as Error).message}\n`)
    return 3
  }

  const iso = bootstrapIsolation({ setHome: true, dbMemory: true })
  process.stdout.write(`isolation root: ${iso.root}\n`)
  process.stdout.write(`HIP_DB_PATH: ${iso.env.HIP_DB_PATH}\n`)
  process.stdout.write(`HIP_AUTH_PATH: ${iso.env.HIP_AUTH_PATH}\n`)

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
    await client.connect(spawned.port, spawned.token)
    const ready = await readyP
    process.stdout.write(`ready: hasApiKey=${ready.hasApiKey}\n`)
    if (!ready.hasApiKey) {
      process.stdout.write('note: no API key — live runs will fail with NO_API_KEY_AT_READY\n')
    }
    process.stdout.write('doctor: OK\n')
    return 0
  } catch (err) {
    process.stderr.write(`doctor: FAIL ${(err as Error).message}\n`)
    return 3
  } finally {
    client.close()
    if (spawned) await stopSpawned(spawned)
  }
}
