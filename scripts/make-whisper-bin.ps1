# Stage a self-contained whisper-cli.exe tree for Windows release bundles.
#
# Layout (production — package-windows.ps1 when HIP_BUNDLE_WHISPER=1):
#   src-tauri/resources/whisper/<triple>/
#     whisper-cli.exe
#     *.dll   (same directory — Windows PE loads adjacent DLLs)
#
# Also installs a copy under %USERPROFILE%\.hip\bin for local dev discovery.
#
# Env:
#   HIP_WHISPER_TRIPLE    override host triple
#   HIP_WHISPER_REBUILD=1 force cmake rebuild
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path "$PSScriptRoot\..").Path }
$VersionFile = Join-Path $Root "scripts\whisper-version.txt"
$Ref = (Get-Content $VersionFile | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() } | Select-Object -First 1).Trim()
if (-not $Ref) { $Ref = "v1.7.5" }

$rustcOut = rustc -vV 2>&1 | Out-String
$Triple = if ($env:HIP_WHISPER_TRIPLE) {
    $env:HIP_WHISPER_TRIPLE
} elseif ($rustcOut -match 'host:\s+(\S+)') {
    $Matches[1]
} else {
    "x86_64-pc-windows-msvc"
}

$OutDir = Join-Path $Root "src-tauri\resources\whisper\$Triple"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Stage = Join-Path $OutDir "whisper-cli.exe"
$UserBin = Join-Path $env:USERPROFILE ".hip\bin"

Write-Host "[make-whisper-bin] ref=$Ref triple=$Triple out=$OutDir"

function Copy-WhisperDlls {
    param(
        [Parameter(Mandatory = $true)][string]$FromDir,
        [Parameter(Mandatory = $true)][string]$ToDir
    )
    if (-not (Test-Path $FromDir)) { return }
    Get-ChildItem -Path $FromDir -Recurse -Include `
        'whisper*.dll', 'ggml*.dll', 'libwhisper*.dll', 'libggml*.dll' `
        -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $ToDir $_.Name) -Force
    }
}

$needBuild = $true
if ((Test-Path $Stage) -and $env:HIP_WHISPER_REBUILD -ne '1') {
    Write-Host "[make-whisper-bin] already staged $Stage (HIP_WHISPER_REBUILD=1 to rebuild)"
    $needBuild = $false
}

if ($needBuild) {
    $cmakeExe = $null
    $cmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmd) { $cmakeExe = $cmd.Path }
    if (-not $cmakeExe) {
        # Get-Command can miss cmake on some shells (PATH not reloaded,
        # or a stale shim ahead of the real exe). Fall back to where.exe.
        $where = & where.exe cmake 2>$null | Select-Object -First 1
        if ($where -and (Test-Path $where)) { $cmakeExe = $where }
    }
    if (-not $cmakeExe) {
        # Last resort: probe well-known install locations.
        $candidates = @(
            "$env:ProgramFiles\CMake\bin\cmake.exe",
            "${env:ProgramFiles(x86)}\CMake\bin\cmake.exe",
            'D:\cmake\bin\cmake.exe',
            'C:\cmake\bin\cmake.exe'
        )
        foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $cmakeExe = $c; break } }
    }
    if (-not $cmakeExe) {
        $pathHead = (@($env:Path -split ';') | Select-Object -First 5) -join "`n    "
        Write-Error @"
cmake is required to build whisper-cli.exe for Windows production packages.

We searched:
  - Get-Command cmake             -> not found on this shell's PATH
  - where.exe cmake               -> not found on PATH
  - known install locations       -> not found

PATH (first 5 entries):
    $pathHead

Install CMake (https://cmake.org/download/) and ensure cmake.exe is on PATH,
then re-open this terminal so PATH is reloaded.
"@
        exit 1
    }
    Write-Host "[make-whisper-bin] using cmake: $cmakeExe"

    $Work = Join-Path $env:TEMP "hip-whisper-build-$PID"
    if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
    New-Item -ItemType Directory -Force -Path $Work | Out-Null
    try {
        git clone --depth 1 --branch $Ref https://github.com/ggml-org/whisper.cpp.git "$Work\src"
        if ($LASTEXITCODE -ne 0) {
            git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$Work\src"
        }
        & $cmakeExe -S "$Work\src" -B "$Work\build" -DWHISPER_BUILD_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release
        if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }
        & $cmakeExe --build "$Work\build" --config Release -j
        if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }
        $Bin = Get-ChildItem -Path "$Work\build" -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $Bin) { throw "whisper-cli.exe not found after build" }
        Copy-Item $Bin.FullName $Stage -Force
        # Co-locate DLLs next to the exe (Windows production load path).
        Copy-WhisperDlls -FromDir $Bin.DirectoryName -ToDir $OutDir
        Copy-WhisperDlls -FromDir (Join-Path $Work 'build') -ToDir $OutDir
    } finally {
        if (Test-Path $Work) { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
    }
}

if (-not (Test-Path $Stage)) {
    throw "whisper-cli.exe not staged at $Stage"
}

# Dev install: full self-contained copy under %USERPROFILE%\.hip\bin
New-Item -ItemType Directory -Force -Path $UserBin | Out-Null
Copy-Item $Stage (Join-Path $UserBin "whisper-cli.exe") -Force
Get-ChildItem -Path $OutDir -Filter '*.dll' -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $UserBin $_.Name) -Force
}

Write-Host "[make-whisper-bin] staged self-contained tree:"
Get-ChildItem $OutDir | ForEach-Object { Write-Host ("  " + $_.Name) }
Write-Host "[make-whisper-bin] installed $UserBin\whisper-cli.exe"
