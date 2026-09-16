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

// happy-dom reports `document.compatMode` as undefined (no doctype), which KaTeX reads
// as quirks mode and answers with a console.warn at module load. Vitest 2.x `list` mode
// crashes on any console output during collection (reporter bug); the warning is also
// pure noise. Simulate a standards-mode document for DOM environments.
if (typeof document !== 'undefined') {
  Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat', configurable: true })
}

// Git on Windows ships core.autocrlf=true, so `git checkout` rewrites LF → CRLF and
// every byte-exact assertion on a checked-out file fails for a reason that has nothing
// to do with the code under test. Force LF for every git subprocess this test process
// spawns (GIT_CONFIG_* is git's env form of `-c`, and it is inherited by child
// processes). Product behaviour is unchanged: CRLF remains git's normal working-tree
// behaviour for a user's own repo; here we only want a deterministic fixture.
if (!process.env.GIT_CONFIG_COUNT) {
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf'
  process.env.GIT_CONFIG_VALUE_0 = 'false'
}
