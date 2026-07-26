# Stage whisper-cli.exe under src-tauri/resources/whisper/<triple>/ for release bundles.
# Used by package-windows.ps1 when HIP_BUNDLE_WHISPER=1 (release default).
#
# Env:
#   HIP_WHISPER_TRIPLE   override host triple (default rustc host or x86_64-pc-windows-msvc)
#   HIP_WHISPER_REBUILD=1 force cmake rebuild even if already staged
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

$needBuild = $true
if ((Test-Path $Stage) -and $env:HIP_WHISPER_REBUILD -ne '1') {
    Write-Host "[make-whisper-bin] already staged $Stage (HIP_WHISPER_REBUILD=1 to rebuild)"
    $needBuild = $false
}

if ($needBuild) {
    if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
        throw "cmake is required to build whisper-cli.exe"
    }
    $Work = Join-Path $env:TEMP "hip-whisper-build-$PID"
    if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
    New-Item -ItemType Directory -Force -Path $Work | Out-Null
    try {
        git clone --depth 1 --branch $Ref https://github.com/ggml-org/whisper.cpp.git "$Work\src"
        if ($LASTEXITCODE -ne 0) {
            git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$Work\src"
        }
        cmake -S "$Work\src" -B "$Work\build" -DWHISPER_BUILD_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release
        if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }
        cmake --build "$Work\build" --config Release -j
        if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }
        $Bin = Get-ChildItem -Path "$Work\build" -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $Bin) { throw "whisper-cli.exe not found after build" }
        Copy-Item $Bin.FullName $Stage -Force
    } finally {
        if (Test-Path $Work) { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
    }
}

if (-not (Test-Path $Stage)) {
    throw "whisper-cli.exe not staged at $Stage"
}

New-Item -ItemType Directory -Force -Path $UserBin | Out-Null
Copy-Item $Stage (Join-Path $UserBin "whisper-cli.exe") -Force

Write-Host "[make-whisper-bin] staged $Stage"
Write-Host "[make-whisper-bin] installed $UserBin\whisper-cli.exe"
