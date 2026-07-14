import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function authPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIP_AUTH_PATH?.trim() || join(homedir(), '.hip', 'config', 'auth.json')
}

/** List provider keys present in auth.json without printing secret values. */
export function printAuthStatus(env: NodeJS.ProcessEnv = process.env): number {
  const path = authPath(env)
  process.stdout.write(`auth path: ${path}\n`)
  if (!existsSync(path)) {
    process.stdout.write('status: missing file\n')
    process.stdout.write('keys: (none)\n')
    return 1
  }
  try {
    const st = statSync(path)
    const mode = (st.mode & 0o777).toString(8).padStart(3, '0')
    process.stdout.write(`mode: ${mode}${mode === '600' || mode === '0600' ? ' (ok)' : ' (warn: prefer 0600)'}\n`)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const keys = Object.entries(raw)
      .filter(([k, v]) => k.startsWith('HIP_MODEL_') && typeof v === 'string' && v.trim().length > 0)
      .map(([k]) => k)
    if (keys.length === 0) {
      process.stdout.write('status: empty (no HIP_MODEL_* keys)\n')
      return 1
    }
    process.stdout.write(`status: ok (${keys.length} key(s))\n`)
    for (const k of keys) {
      const provider = k
        .replace(/^HIP_MODEL_/, '')
        .replace(/_API_KEY$/, '')
        .toLowerCase()
      process.stdout.write(`  - ${provider} (${k}=***)\n`)
    }
    // env overrides
    const envKeys = Object.keys(env).filter(
      (k) => k.startsWith('HIP_MODEL_') && k.endsWith('_API_KEY') && env[k]?.trim(),
    )
    if (envKeys.length) {
      process.stdout.write(`env overrides: ${envKeys.length}\n`)
      for (const k of envKeys) process.stdout.write(`  - ${k}=***\n`)
    }
    return 0
  } catch (err) {
    process.stderr.write(`status: unreadable (${err instanceof Error ? err.message : String(err)})\n`)
    return 1
  }
}
