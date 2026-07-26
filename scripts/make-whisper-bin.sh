#!/usr/bin/env bash
# Stage whisper-cli under src-tauri/resources/whisper/<triple>/ for release bundles,
# and install a copy to ~/.hip/bin for local/dev discovery.
#
# Used by package-macos.sh when HIP_BUNDLE_WHISPER=1 (release default).
#
# Env:
#   HIP_WHISPER_TRIPLE   override rustc host triple
#   HIP_WHISPER_REBUILD=1 force cmake rebuild even if already staged
#   HIP_WHISPER_SOURCE=build|brew|auto
#     build — always build from whisper-version.txt pin (default, reproducible)
#     brew  — copy whisper-cli from Homebrew (faster dogfood; not version-pinned)
#     auto  — use existing stage, else brew if present, else build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="${ROOT}/scripts/whisper-version.txt"
# First non-comment line
REF="$(grep -v '^#' "${VERSION_FILE}" | head -1 | tr -d '[:space:]')"
REF="${REF:-v1.7.5}"

TRIPLE="${HIP_WHISPER_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT_DIR="${ROOT}/src-tauri/resources/whisper/${TRIPLE}"
STAGE="${OUT_DIR}/whisper-cli"
SOURCE="${HIP_WHISPER_SOURCE:-build}"
HIP_BIN="${HOME}/.hip/bin"

mkdir -p "${OUT_DIR}"

echo "[make-whisper-bin] ref=${REF} triple=${TRIPLE} source=${SOURCE} out=${OUT_DIR}"

stage_from_file() {
  local src="$1"
  if [[ ! -f "${src}" ]]; then
    echo "error: source binary missing: ${src}" >&2
    return 1
  fi
  cp -f "${src}" "${STAGE}"
  chmod +x "${STAGE}"
}

install_user_copy() {
  mkdir -p "${HIP_BIN}"
  cp -f "${STAGE}" "${HIP_BIN}/whisper-cli"
  chmod +x "${HIP_BIN}/whisper-cli"
  # Ensure staged files are owner-writable (brew bottles are often 0555; breaks tauri-build).
  chmod u+w "${STAGE}" 2>/dev/null || true
  # Copy adjacent dylibs next to user binary when present (Metal / ggml).
  # Skip system / Homebrew absolute dylibs when SOURCE=brew — they stay linked from prefix.
  if [[ "${SOURCE}" == "brew" ]]; then
    return 0
  fi
  if command -v otool >/dev/null 2>&1; then
    while read -r lib; do
      [[ -f "${lib}" ]] || continue
      base="$(basename "${lib}")"
      [[ "${base}" == *whisper* || "${base}" == *ggml* ]] || continue
      cp -f "${lib}" "${HIP_BIN}/" 2>/dev/null || true
      cp -f "${lib}" "${OUT_DIR}/" 2>/dev/null || true
      chmod u+w "${HIP_BIN}/${base}" "${OUT_DIR}/${base}" 2>/dev/null || true
    done < <(otool -L "${STAGE}" | awk '/^\t/ {print $1}' | grep -E '\.dylib$' || true)
  fi
}

already_staged() {
  [[ -x "${STAGE}" && "${HIP_WHISPER_REBUILD:-0}" != "1" ]]
}

copy_from_brew() {
  local brew_cli=""
  if command -v brew >/dev/null 2>&1; then
    local prefix
    prefix="$(brew --prefix whisper-cpp 2>/dev/null || true)"
    if [[ -n "${prefix}" && -x "${prefix}/bin/whisper-cli" ]]; then
      brew_cli="${prefix}/bin/whisper-cli"
    fi
  fi
  if [[ -z "${brew_cli}" ]]; then
    for cand in \
      /opt/homebrew/bin/whisper-cli \
      /usr/local/bin/whisper-cli \
      /opt/homebrew/opt/whisper-cpp/bin/whisper-cli \
      /usr/local/opt/whisper-cpp/bin/whisper-cli
    do
      if [[ -x "${cand}" ]]; then brew_cli="${cand}"; break; fi
    done
  fi
  if [[ -z "${brew_cli}" ]]; then
    echo "error: Homebrew whisper-cli not found (brew install whisper-cpp)" >&2
    return 1
  fi
  echo "[make-whisper-bin] copying brew binary: ${brew_cli}"
  stage_from_file "${brew_cli}"
}

build_from_source() {
  if ! command -v cmake >/dev/null 2>&1; then
    echo "error: cmake is required to build whisper-cli (or use HIP_WHISPER_SOURCE=brew)" >&2
    exit 1
  fi

  local WORKDIR="${TMPDIR:-/tmp}/hip-whisper-build-$$"
  mkdir -p "${WORKDIR}"
  cleanup() { rm -rf "${WORKDIR}"; }
  trap cleanup EXIT

  git clone --depth 1 --branch "${REF}" https://github.com/ggml-org/whisper.cpp.git "${WORKDIR}/src" \
    || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "${WORKDIR}/src"

  local CMAKE_ARGS=(-DWHISPER_BUILD_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release)
  case "${TRIPLE}" in
    aarch64-apple-darwin|arm64-apple-darwin)
      CMAKE_ARGS+=(-DGGML_METAL=ON)
      ;;
  esac

  cmake -S "${WORKDIR}/src" -B "${WORKDIR}/build" "${CMAKE_ARGS[@]}"
  cmake --build "${WORKDIR}/build" --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"

  local BIN=""
  for cand in \
    "${WORKDIR}/build/bin/whisper-cli" \
    "${WORKDIR}/build/whisper-cli" \
    "${WORKDIR}/build/examples/cli/whisper-cli"
  do
    if [[ -x "${cand}" ]]; then BIN="${cand}"; break; fi
  done
  if [[ -z "${BIN}" ]]; then
    echo "error: whisper-cli binary not found after build" >&2
    find "${WORKDIR}/build" -name 'whisper-cli*' 2>/dev/null | head -20 >&2 || true
    exit 1
  fi

  stage_from_file "${BIN}"
  trap - EXIT
  cleanup
}

if already_staged; then
  echo "[make-whisper-bin] already staged ${STAGE} (HIP_WHISPER_REBUILD=1 to rebuild)"
else
  case "${SOURCE}" in
    brew)
      copy_from_brew
      ;;
    auto)
      if already_staged; then
        :
      elif copy_from_brew 2>/dev/null; then
        :
      else
        build_from_source
      fi
      ;;
    build|*)
      build_from_source
      ;;
  esac
fi

if [[ ! -x "${STAGE}" ]]; then
  echo "error: whisper-cli not staged at ${STAGE}" >&2
  exit 1
fi

install_user_copy

echo "[make-whisper-bin] staged ${STAGE}"
echo "[make-whisper-bin] installed ${HIP_BIN}/whisper-cli"
