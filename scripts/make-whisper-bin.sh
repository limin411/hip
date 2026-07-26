#!/usr/bin/env bash
# Optional: build whisper-cli and stage under src-tauri/resources/whisper/<triple>/.
# Default packaging does NOT require this. Set HIP_BUNDLE_WHISPER=1 in package-macos.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="${ROOT}/scripts/whisper-version.txt"
# First non-comment line
REF="$(grep -v '^#' "${VERSION_FILE}" | head -1 | tr -d '[:space:]')"
REF="${REF:-v1.7.5}"

TRIPLE="${HIP_WHISPER_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT_DIR="${ROOT}/src-tauri/resources/whisper/${TRIPLE}"
WORKDIR="${TMPDIR:-/tmp}/hip-whisper-build-$$"
mkdir -p "${OUT_DIR}" "${WORKDIR}"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

echo "[make-whisper-bin] ref=${REF} triple=${TRIPLE} out=${OUT_DIR}"

if ! command -v cmake >/dev/null 2>&1; then
  echo "cmake is required" >&2
  exit 1
fi

git clone --depth 1 --branch "${REF}" https://github.com/ggml-org/whisper.cpp.git "${WORKDIR}/src" \
  || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "${WORKDIR}/src"

CMAKE_ARGS=(-DWHISPER_BUILD_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release)
case "${TRIPLE}" in
  aarch64-apple-darwin|arm64-apple-darwin)
    CMAKE_ARGS+=(-DGGML_METAL=ON)
    ;;
esac

cmake -S "${WORKDIR}/src" -B "${WORKDIR}/build" "${CMAKE_ARGS[@]}"
cmake --build "${WORKDIR}/build" --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"

BIN=""
for cand in \
  "${WORKDIR}/build/bin/whisper-cli" \
  "${WORKDIR}/build/whisper-cli" \
  "${WORKDIR}/build/examples/cli/whisper-cli"
do
  if [[ -x "${cand}" ]]; then BIN="${cand}"; break; fi
done
if [[ -z "${BIN}" ]]; then
  echo "whisper-cli binary not found after build" >&2
  find "${WORKDIR}/build" -name 'whisper-cli*' 2>/dev/null | head -20 >&2 || true
  exit 1
fi

cp -f "${BIN}" "${OUT_DIR}/whisper-cli"
chmod +x "${OUT_DIR}/whisper-cli"
# Copy adjacent dylibs if any (Metal builds)
if command -v otool >/dev/null 2>&1; then
  while read -r lib; do
    [[ -f "${lib}" ]] || continue
    base="$(basename "${lib}")"
    [[ "${base}" == *whisper* || "${base}" == *ggml* ]] || continue
    cp -f "${lib}" "${OUT_DIR}/" 2>/dev/null || true
  done < <(otool -L "${OUT_DIR}/whisper-cli" | awk '/^\t/ {print $1}' | grep -E '\.dylib$' || true)
fi

echo "[make-whisper-bin] staged ${OUT_DIR}/whisper-cli"
