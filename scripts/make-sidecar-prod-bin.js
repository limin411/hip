// Cross-platform dispatcher for production sidecar packaging.
// On Windows: PowerShell. On macOS/Linux: bash.
//
// Stages:
//   1. esbuild-bundle packages/sidecar → resources/hip-sidecar/index.js
//   2. copy Node runtime → resources/hip-sidecar/node[.exe]
//   3. compile scripts/sidecar-launcher → binaries/sidecar-<triple>[.exe]
//
// Refuse to leave a tree that only has README.txt (that is what ships an
// empty Windows installer and "连接错误" on first launch).

import { execSync } from 'node:child_process'
import { platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (platform() === 'win32') {
  const psScript = join(__dirname, 'make-sidecar-prod-bin.ps1')
  execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}"`, {
    stdio: 'inherit',
  })
} else {
  const shScript = join(__dirname, 'make-sidecar-prod-bin.sh')
  execSync(`bash "${shScript}"`, { stdio: 'inherit' })
}
