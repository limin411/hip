# Build a distributable production sidecar for Windows (yarn tauri build / NSIS).
#
# Stages under src-tauri/:
#   1. esbuild-bundle packages/sidecar -> resources/hip-sidecar/index.js
#   2. copy Node runtime -> resources/hip-sidecar/node.exe
#   3. compile scripts/sidecar-launcher -> binaries/sidecar-<triple>.exe
#
# Usage (from repo root):
#   yarn sidecar:prod-bin
#   # or: powershell -File scripts/make-sidecar-prod-bin.ps1
#
# Then: yarn tauri build  (or scripts/release-windows.ps1)
#
# Written for Windows PowerShell 5.1:
# - no em-dash / fancy unicode in parse-sensitive strings
# - single-quoted here-strings for Cargo.toml ([[bin]] must not be parsed)
# - avoid double-quoted "[tag]" which PS treats as type/array syntax

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Write-Prod {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host ('[sidecar:prod] ' + $Message)
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$BinDir = Join-Path $RootDir 'src-tauri\binaries'
$RuntimeDir = Join-Path $RootDir 'src-tauri\resources\hip-sidecar'
$LauncherSrc = Join-Path $ScriptDir 'sidecar-launcher\main.rs'
$Esbuild = Join-Path $RootDir 'node_modules\.bin\esbuild.cmd'
if (-not (Test-Path $Esbuild)) {
    $Esbuild = Join-Path $RootDir 'node_modules\.bin\esbuild'
}

# Target triple (e.g. x86_64-pc-windows-msvc)
$rustcOutput = rustc -vV 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error 'error: could not run rustc -vV (is rustc installed?)'
    exit 1
}
$TargetTriple = ($rustcOutput | Select-String -Pattern '^host:\s+(.+)' | ForEach-Object { $_.Matches.Groups[1].Value }).Trim()
if (-not $TargetTriple) {
    Write-Error 'error: could not determine host target triple'
    exit 1
}

$NodeBin = node -e 'process.stdout.write(process.execPath)' 2>$null
if (-not $NodeBin -or -not (Test-Path $NodeBin)) {
    Write-Error 'error: could not resolve a real node executable'
    exit 1
}

# node:sqlite (hip persistence) needs Node >= 22.5
$NodeVer = node -p 'process.versions.node' 2>$null
$NodeParts = @($NodeVer -split '\.')
$NodeMajor = [int]($NodeParts[0])
$NodeMinor = [int]($NodeParts[1])
if ($NodeMajor -lt 22 -or ($NodeMajor -eq 22 -and $NodeMinor -lt 5)) {
    Write-Error ("error: Node $NodeVer is too old (need >= 22.5 for node:sqlite). Install a newer Node and re-run.")
    exit 1
}

Write-Prod ('target:  ' + $TargetTriple)
Write-Prod ('node:    ' + $NodeBin + ' (v' + $NodeVer + ')')
Write-Prod 'bundling sidecar with esbuild...'

if (-not (Test-Path $Esbuild)) {
    Write-Error 'error: esbuild not found (run yarn install)'
    exit 1
}

$SidecarPkg = Join-Path $RootDir 'packages\sidecar'
$DistDir = Join-Path $SidecarPkg 'dist'
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$BundleJs = Join-Path $DistDir 'index.cjs'

# Banner must be single-quoted: PowerShell parses () inside double-quoted --banner:js="...".
$BannerJs = 'const __import_meta_url = require(''url'').pathToFileURL(__filename).href;'
$EsbuildArgs = @(
    'src\main.ts'
    '--bundle'
    '--platform=node'
    '--format=cjs'
    '--target=node20'
    ('--outfile=' + $BundleJs)
    '--external:sqlite-vec'
    ('--banner:js=' + $BannerJs)
    '--define:import.meta.url=__import_meta_url'
)

Push-Location $SidecarPkg
try {
    & $Esbuild @EsbuildArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'error: esbuild failed'
        exit 1
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $BundleJs)) {
    Write-Error ('error: ' + $BundleJs + ' missing after esbuild')
    exit 1
}

Write-Prod ('staging runtime -> ' + $RuntimeDir)
# Keep README.txt (tracked); wipe everything else so we never ship a stale foreign node.
Get-ChildItem -Force $RuntimeDir -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'README.txt' } |
    Remove-Item -Recurse -Force
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

Copy-Item -Force $BundleJs (Join-Path $RuntimeDir 'index.js')
Write-Utf8NoBom -Path (Join-Path $RuntimeDir 'package.json') -Content '{}'
# Windows: always stage as node.exe (launcher prefers this name).
Copy-Item -Force $NodeBin (Join-Path $RuntimeDir 'node.exe')

Write-Prod ('compiling launcher for ' + $TargetTriple + '...')
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$OutExe = Join-Path $BinDir ('sidecar-' + $TargetTriple + '.exe')
$TempDir = Join-Path $BinDir '.launcher-prod-build'
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
$TempSrc = Join-Path $TempDir 'src'
New-Item -ItemType Directory -Force -Path $TempSrc | Out-Null
Copy-Item -Force $LauncherSrc (Join-Path $TempSrc 'main.rs')

# Single-quoted here-string: [[bin]] must not be parsed by PowerShell.
$CargoToml = @'
[package]
name = "sidecar-launcher"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "sidecar-launcher"
path = "src/main.rs"
'@
Write-Utf8NoBom -Path (Join-Path $TempDir 'Cargo.toml') -Content $CargoToml

$prevErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$cargoOutput = & cargo build --manifest-path (Join-Path $TempDir 'Cargo.toml') --release 2>&1
$cargoExit = $LASTEXITCODE
$ErrorActionPreference = $prevErrorAction
if ($cargoOutput) {
    $cargoOutput | ForEach-Object { Write-Host $_ }
}
if ($cargoExit -ne 0) {
    Write-Error ('error: cargo build failed (exit code: ' + $cargoExit + ')')
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    exit 1
}

$Built = Join-Path $TempDir 'target\release\sidecar-launcher.exe'
Copy-Item -Force $Built $OutExe
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue

# Guard: refuse empty / incomplete runtime (the bug that shipped empty NSIS)
$NodeStaged = Join-Path $RuntimeDir 'node.exe'
$IndexStaged = Join-Path $RuntimeDir 'index.js'
if (-not (Test-Path $NodeStaged)) {
    Write-Error ('error: staged node.exe missing at ' + $NodeStaged)
    exit 1
}
if (-not (Test-Path $IndexStaged)) {
    Write-Error ('error: staged index.js missing at ' + $IndexStaged)
    exit 1
}
$IndexSize = (Get-Item $IndexStaged).Length
if ($IndexSize -lt 10000) {
    Write-Error ('error: index.js too small (' + $IndexSize + ' bytes) - bundle likely failed')
    exit 1
}
$NodeSize = (Get-Item $NodeStaged).Length
if ($NodeSize -lt 1000000) {
    Write-Error ('error: node.exe too small (' + $NodeSize + ' bytes) - not a real Node runtime')
    exit 1
}
if (-not (Test-Path $OutExe)) {
    Write-Error ('error: launcher missing at ' + $OutExe)
    exit 1
}

Write-Prod ('wrote launcher: ' + $OutExe)
Write-Prod ('runtime:        ' + $RuntimeDir + ' (node.exe + index.js)')
Write-Prod 'next:           yarn tauri build'
Write-Prod 'IMPORTANT:      always run this before Windows release builds'
