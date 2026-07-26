# Optional Windows build of whisper-cli into src-tauri/resources/whisper/<triple>/
# Default packaging does NOT require this.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path "$PSScriptRoot\..").Path }
$VersionFile = Join-Path $Root "scripts\whisper-version.txt"
$Ref = (Get-Content $VersionFile | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() } | Select-Object -First 1).Trim()
if (-not $Ref) { $Ref = "v1.7.5" }

$Triple = if ($env:HIP_WHISPER_TRIPLE) { $env:HIP_WHISPER_TRIPLE } else { "x86_64-pc-windows-msvc" }
$OutDir = Join-Path $Root "src-tauri\resources\whisper\$Triple"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Work = Join-Path $env:TEMP "hip-whisper-build-$PID"
New-Item -ItemType Directory -Force -Path $Work | Out-Null

Write-Host "[make-whisper-bin] ref=$Ref triple=$Triple out=$OutDir"
git clone --depth 1 --branch $Ref https://github.com/ggml-org/whisper.cpp.git "$Work\src"
cmake -S "$Work\src" -B "$Work\build" -DWHISPER_BUILD_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release
cmake --build "$Work\build" --config Release -j
$Bin = Get-ChildItem -Path "$Work\build" -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
if (-not $Bin) { throw "whisper-cli.exe not found" }
Copy-Item $Bin.FullName (Join-Path $OutDir "whisper-cli.exe") -Force
Write-Host "[make-whisper-bin] staged $OutDir\whisper-cli.exe"
