# hip - Windows NSIS installer package
#
# Must run on Windows. Steps:
#   1. yarn sidecar:prod-bin  (node.exe + index.js + real launcher.exe)
#   2. Guard against empty hip-sidecar / dev launcher
#   3. yarn tauri build --bundles nsis
#   4. Print output paths + post-install checks
#
# Prerequisites:
#   - Node.js >= 22.5, Yarn, Rust (MSVC)
#   - Optional signing: see https://v2.tauri.app/distribute/sign/windows/
#
# Usage (repo root):
#   yarn package:windows
#   # or:
#   powershell -ExecutionPolicy Bypass -File scripts/package-windows.ps1
#
# CI (GitHub Actions build.yml): same command; set HIP_BUNDLE_WHISPER=0 for faster
# branch builds (whisper cmake is opt-in on tags / workflow_dispatch).
#
# Voice engine (whisper-cli):
#   Release packages bundle the engine by default (models still download on demand).
#   Skip: $env:HIP_BUNDLE_WHISPER='0'; yarn package:windows
#   Force rebuild engine: $env:HIP_WHISPER_REBUILD='1'
#
# PowerShell 5.1 safe: ASCII-only, no double-quoted [tag] literals.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location $RootDir

Write-Host '==> hip package:windows'

if ($env:OS -ne 'Windows_NT') {
    Write-Error 'error: package-windows.ps1 must run on Windows'
    exit 1
}

# Release default: bundle whisper-cli. Models stay opt-in (Settings download).
$bundleWhisper = if ($null -ne $env:HIP_BUNDLE_WHISPER -and $env:HIP_BUNDLE_WHISPER -ne '') {
    $env:HIP_BUNDLE_WHISPER
} else {
    '1'
}
if ($bundleWhisper -eq '1') {
    Write-Host '==> bundling whisper-cli (release default; HIP_BUNDLE_WHISPER=0 to skip)'
    & powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'make-whisper-bin.ps1')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $rustcOut = rustc -vV 2>&1 | Out-String
    $Triple = if ($env:HIP_WHISPER_TRIPLE) {
        $env:HIP_WHISPER_TRIPLE
    } else {
        if ($rustcOut -match 'host:\s+(\S+)') { $Matches[1] } else { 'x86_64-pc-windows-msvc' }
    }
    $WhisperBin = Join-Path $RootDir ("src-tauri\resources\whisper\$Triple\whisper-cli.exe")
    if (-not (Test-Path $WhisperBin)) {
        Write-Error ("error: expected whisper-cli at $WhisperBin after make-whisper-bin.ps1")
        exit 1
    }
    $WhisperSize = (Get-Item $WhisperBin).Length
    Write-Host ("    staged: $WhisperBin ($WhisperSize bytes)")
} else {
    Write-Host '==> HIP_BUNDLE_WHISPER=0 - skipping whisper-cli'
}

# ── 1. Production sidecar ───────────────────────────────────────────────────
Write-Host '==> production sidecar (make-sidecar-prod-bin.ps1)'
& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'make-sidecar-prod-bin.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$RuntimeDir = Join-Path $RootDir 'src-tauri\resources\hip-sidecar'
$Node = Join-Path $RuntimeDir 'node.exe'
$Index = Join-Path $RuntimeDir 'index.js'
if (-not (Test-Path $Node) -or -not (Test-Path $Index)) {
    Write-Error ('error: hip-sidecar incomplete (need node.exe + index.js under ' + $RuntimeDir + ')')
    exit 1
}

$NodeSize = (Get-Item $Node).Length
$IndexSize = (Get-Item $Index).Length
if ($NodeSize -lt 1000000 -or $IndexSize -lt 10000) {
    Write-Error ('error: hip-sidecar looks truncated (node.exe=' + $NodeSize + 'B index.js=' + $IndexSize + 'B)')
    exit 1
}

$entries = @(Get-ChildItem $RuntimeDir | Select-Object -ExpandProperty Name)
Write-Host ('    hip-sidecar: ' + ($entries -join ', '))
Write-Host ('    node.exe=' + $NodeSize + ' bytes, index.js=' + $IndexSize + ' bytes')

$rustcOutput = rustc -vV 2>&1
$Triple = ($rustcOutput | Select-String -Pattern '^host:\s+(.+)' | ForEach-Object { $_.Matches.Groups[1].Value }).Trim()
if (-not $Triple) {
    Write-Error 'error: could not determine rustc host triple'
    exit 1
}
$SidecarBin = Join-Path $RootDir ('src-tauri\binaries\sidecar-' + $Triple + '.exe')
if (-not (Test-Path $SidecarBin)) {
    Write-Error ('error: missing launcher ' + $SidecarBin + ' - prod-bin failed')
    exit 1
}
$LauncherSize = (Get-Item $SidecarBin).Length
Write-Host ('    launcher: ' + $SidecarBin + ' (' + $LauncherSize + ' bytes)')

# ── 2. Build NSIS ───────────────────────────────────────────────────────────
Write-Host '==> yarn tauri build --bundles nsis'
yarn tauri build --bundles nsis
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Bundle = Join-Path $RootDir 'src-tauri\target\release\bundle'
$NsisDir = Join-Path $Bundle 'nsis'
$Setup = $null
if (Test-Path $NsisDir) {
    $Setup = Get-ChildItem $NsisDir -Filter '*.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

Write-Host ''
Write-Host ('OK - Windows package under: ' + $Bundle)
if ($Setup) {
    Write-Host ('  setup: ' + $Setup.FullName)
}
Write-Host ''
Write-Host 'After installing on a clean PC, verify:'
Write-Host '  dir <install>\hip-sidecar'
Write-Host '  # must list node.exe and index.js (not only README.txt)'
Write-Host '  <install>\hip-sidecar\node.exe -v'
Write-Host '  <install>\hip-sidecar\node.exe <install>\hip-sidecar\index.js'
Write-Host '  # should print {"port":...,"token":...}'
Write-Host '  type %USERPROFILE%\.hip\logs\sidecar-boot.log'
Write-Host '  type <install>\sidecar-launcher.log'
