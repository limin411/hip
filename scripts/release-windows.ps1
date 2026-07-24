# Build a Windows NSIS installer with a complete production sidecar.
#
# Required (this is what was missing when hip-sidecar only shipped README.txt):
#   yarn sidecar:prod-bin   -> node.exe + index.js + real sidecar-*.exe launcher
#
# Usage (from repo root, on a Windows machine with Node + Rust + yarn):
#   powershell -ExecutionPolicy Bypass -File scripts/release-windows.ps1
#   # or: yarn release:windows
#
# Optional code signing (if set, passed through to Tauri):
#   $env:TAURI_SIGNING_PRIVATE_KEY = ...
#   See https://v2.tauri.app/distribute/sign/windows/
#
# PowerShell 5.1 safe: ASCII-only messages, no double-quoted [tag] literals.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location $RootDir

Write-Host '==> hip Windows release'

Write-Host '==> production sidecar'
& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'make-sidecar-prod-bin.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Guard: refuse empty hip-sidecar (the bug that caused connection errors on new PCs)
$RuntimeDir = Join-Path $RootDir 'src-tauri\resources\hip-sidecar'
$Node = Join-Path $RuntimeDir 'node.exe'
$Index = Join-Path $RuntimeDir 'index.js'
if (-not (Test-Path $Node) -or -not (Test-Path $Index)) {
    Write-Error ('error: hip-sidecar incomplete after prod-bin (need node.exe + index.js under ' + $RuntimeDir + ')')
    exit 1
}
$entries = @(Get-ChildItem $RuntimeDir | Select-Object -ExpandProperty Name)
Write-Host ('    hip-sidecar contents: ' + ($entries -join ', '))

# Guard: refuse a pure README-only tree
if ($entries.Count -le 1) {
    Write-Error 'error: hip-sidecar looks empty (only README?) - aborting before tauri build'
    exit 1
}

# Guard: launcher must exist
$rustcOutput = rustc -vV 2>&1
$Triple = ($rustcOutput | Select-String -Pattern '^host:\s+(.+)' | ForEach-Object { $_.Matches.Groups[1].Value }).Trim()
$SidecarBin = Join-Path $RootDir ('src-tauri\binaries\sidecar-' + $Triple + '.exe')
if (-not (Test-Path $SidecarBin)) {
    Write-Error ('error: missing ' + $SidecarBin + ' - run yarn sidecar:prod-bin')
    exit 1
}

Write-Host '==> yarn tauri build'
yarn tauri build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Bundle = Join-Path $RootDir 'src-tauri\target\release\bundle'
Write-Host ''
Write-Host ('OK - check installers under: ' + $Bundle)
Write-Host ''
Write-Host 'After installing on a clean PC, verify:'
Write-Host '  dir <install>\hip-sidecar'
Write-Host '  # must list node.exe and index.js (not only README.txt)'
Write-Host '  <install>\sidecar.exe'
Write-Host '  # should print a JSON line {"port":...,"token":...} or stay running'
