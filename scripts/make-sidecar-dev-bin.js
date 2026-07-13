// Cross-platform dispatcher for sidecar dev wrapper generation.
// On Windows: runs PowerShell script
// On Linux/macOS: runs bash script

import { execSync } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (platform() === "win32") {
  const psScript = join(__dirname, "make-sidecar-dev-bin.ps1");
  execSync(
    `powershell -ExecutionPolicy Bypass -File "${psScript}"`,
    { stdio: "inherit" }
  );
} else {
  const shScript = join(__dirname, "make-sidecar-dev-bin.sh");
  execSync(`bash "${shScript}"`, {
    stdio: "inherit",
  });
}
