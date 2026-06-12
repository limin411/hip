// Seed real-LLM API keys from the single source of truth (~/.hip/config/auth.json —
// the same file the desktop app writes) into process.env, so the live test suites read
// the key the same way the running sidecar does. Missing file (e.g. CI) → no-op → those
// suites skipIf-skip. An env var that's already set always wins (never overwritten).
import { readFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

try {
  const authPath = path.join(os.homedir(), '.hip', 'config', 'auth.json')
  const map = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'string' && !process.env[k]) process.env[k] = v
  }
} catch {
  // No auth.json → live suites skip.
}

// Keys now live in process.env (above). Neutralize the auth.json file fallback for the
// rest of the run so tests that delete a key env var to simulate "no key" stay hermetic
// and don't re-read the real ~/.hip/config/auth.json. (HIP_AUTH_PATH → a path that never
// exists.) auth-file.test.ts passes explicit paths, so it is unaffected.
process.env.HIP_AUTH_PATH = path.join(os.tmpdir(), '__hip_no_auth__', 'auth.json')
