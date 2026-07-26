#!/usr/bin/env bash
# Stage a **self-contained** whisper-cli tree for release bundles, and wire a
# safe dev install under ~/.hip/bin.
#
# Layout (production — used by package-macos.sh when HIP_BUNDLE_WHISPER=1):
#   src-tauri/resources/whisper/<triple>/
#     whisper-cli
#     libwhisper*.dylib   (same directory — @loader_path)
#     libggml*.dylib      (when required)
#
# Scenarios:
#   macOS production  — always SOURCE=build (pinned) unless CI sets brew for dogfood
#   macOS development — brew install whisper-cpp; or this script with SOURCE=brew|build
#   Windows           — see make-whisper-bin.ps1
#
# Env:
#   HIP_WHISPER_TRIPLE    override rustc host triple
#   HIP_WHISPER_REBUILD=1 force rebuild even if already staged
#   HIP_WHISPER_SOURCE=build|brew|auto
#     build — cmake from scripts/whisper-version.txt (default, reproducible release)
#     brew  — faster local dogfood from Homebrew (not version-pinned)
#     auto  — existing stage → brew → build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="${ROOT}/scripts/whisper-version.txt"
REF="$(grep -v '^#' "${VERSION_FILE}" | head -1 | tr -d '[:space:]')"
REF="${REF:-v1.7.5}"

TRIPLE="${HIP_WHISPER_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT_DIR="${ROOT}/src-tauri/resources/whisper/${TRIPLE}"
STAGE="${OUT_DIR}/whisper-cli"
SOURCE="${HIP_WHISPER_SOURCE:-build}"
HIP_BIN="${HOME}/.hip/bin"

mkdir -p "${OUT_DIR}"

echo "[make-whisper-bin] ref=${REF} triple=${TRIPLE} source=${SOURCE} out=${OUT_DIR}"

# Rewrite macOS load commands so dylibs load from @loader_path (same folder as CLI).
# Required for production bundles: no Homebrew on customer machines; Hardened Runtime
# may strip DYLD_* env vars.
fix_mac_loader_paths() {
  local bin="$1"
  local dir
  dir="$(cd "$(dirname "${bin}")" && pwd)"
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  command -v otool >/dev/null 2>&1 || return 0
  command -v install_name_tool >/dev/null 2>&1 || return 0

  # Ensure @loader_path is searched.
  install_name_tool -add_rpath @loader_path "${bin}" 2>/dev/null || true

  while read -r dep; do
    [[ -n "${dep}" ]] || continue
    local base
    base="$(basename "${dep}")"
    # Skip system frameworks
    case "${dep}" in
      /usr/lib/*| /System/*) continue ;;
    esac
    if [[ -f "${dir}/${base}" ]]; then
      install_name_tool -change "${dep}" "@loader_path/${base}" "${bin}" 2>/dev/null || true
      # Also fix the dylib's own id when present
      if [[ "${base}" == *.dylib ]]; then
        install_name_tool -id "@loader_path/${base}" "${dir}/${base}" 2>/dev/null || true
      fi
    fi
  done < <(otool -L "${bin}" | awk 'NR>1 {print $1}')

  # Fix inter-dylib references among staged libs.
  local d
  for d in "${dir}"/*.dylib; do
    [[ -f "${d}" ]] || continue
    install_name_tool -add_rpath @loader_path "${d}" 2>/dev/null || true
    while read -r dep; do
      [[ -n "${dep}" ]] || continue
      local base
      base="$(basename "${dep}")"
      case "${dep}" in
        /usr/lib/*| /System/*) continue ;;
      esac
      if [[ -f "${dir}/${base}" ]]; then
        install_name_tool -change "${dep}" "@loader_path/${base}" "${d}" 2>/dev/null || true
      fi
    done < <(otool -L "${d}" | awk 'NR>1 {print $1}')
  done

  chmod u+w "${dir}"/* 2>/dev/null || true
  echo "[make-whisper-bin] fixed @loader_path rpaths under ${dir}"
}

# Copy linked non-system dylibs next to the CLI (production self-containment).
bundle_adjacent_dylibs() {
  local bin="$1"
  local dir
  dir="$(cd "$(dirname "${bin}")" && pwd)"
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  command -v otool >/dev/null 2>&1 || return 0

  local dep base src
  while read -r dep; do
    [[ -n "${dep}" ]] || continue
    case "${dep}" in
      /usr/lib/*| /System/*| @loader_path/*) continue ;;
    esac
    base="$(basename "${dep}")"
    [[ "${base}" == *whisper* || "${base}" == *ggml* ]] || continue
    if [[ -f "${dep}" ]]; then
      src="${dep}"
    elif [[ -f "/opt/homebrew/opt/whisper-cpp/lib/${base}" ]]; then
      src="/opt/homebrew/opt/whisper-cpp/lib/${base}"
    elif [[ -f "/opt/homebrew/opt/ggml/lib/${base}" ]]; then
      src="/opt/homebrew/opt/ggml/lib/${base}"
    elif [[ -f "/usr/local/opt/whisper-cpp/lib/${base}" ]]; then
      src="/usr/local/opt/whisper-cpp/lib/${base}"
    else
      continue
    fi
    cp -f "${src}" "${dir}/${base}"
    chmod u+w "${dir}/${base}" 2>/dev/null || true
  done < <(otool -L "${bin}" | awk 'NR>1 {print $1}')

  # Brew bottles often need libwhisper even when listed only as @rpath.
  for base in libwhisper.1.dylib libwhisper.dylib; do
    if [[ ! -f "${dir}/${base}" ]]; then
      for src in \
        /opt/homebrew/opt/whisper-cpp/lib/${base} \
        /usr/local/opt/whisper-cpp/lib/${base}
      do
        if [[ -f "${src}" ]]; then
          cp -f "${src}" "${dir}/${base}"
          chmod u+w "${dir}/${base}" 2>/dev/null || true
          break
        fi
      done
    fi
  done
}

stage_from_file() {
  local src="$1"
  if [[ ! -f "${src}" ]]; then
    echo "error: source binary missing: ${src}" >&2
    return 1
  fi
  cp -f "${src}" "${STAGE}"
  chmod +x "${STAGE}"
  chmod u+w "${STAGE}" 2>/dev/null || true
  bundle_adjacent_dylibs "${STAGE}"
  fix_mac_loader_paths "${STAGE}"
}

# Dev convenience: never leave a broken brew *copy* in ~/.hip/bin.
install_user_copy() {
  mkdir -p "${HIP_BIN}"
  if [[ "${SOURCE}" == "brew" ]]; then
    local real=""
    if [[ -x /opt/homebrew/opt/whisper-cpp/bin/whisper-cli ]]; then
      real="/opt/homebrew/opt/whisper-cpp/bin/whisper-cli"
    elif [[ -x /usr/local/opt/whisper-cpp/bin/whisper-cli ]]; then
      real="/usr/local/opt/whisper-cpp/bin/whisper-cli"
    fi
    if [[ -n "${real}" ]]; then
      ln -sfn "${real}" "${HIP_BIN}/whisper-cli"
      echo "[make-whisper-bin] dev link ${HIP_BIN}/whisper-cli -> ${real}"
      return 0
    fi
  fi

  # Self-built / staged: copy CLI + adjacent dylibs so @loader_path works offline.
  cp -f "${STAGE}" "${HIP_BIN}/whisper-cli"
  chmod +x "${HIP_BIN}/whisper-cli"
  local f
  for f in "${OUT_DIR}"/*.dylib; do
    [[ -f "${f}" ]] || continue
    cp -f "${f}" "${HIP_BIN}/"
    chmod u+w "${HIP_BIN}/$(basename "${f}")" 2>/dev/null || true
  done
  if [[ -x "${HIP_BIN}/whisper-cli" ]]; then
    fix_mac_loader_paths "${HIP_BIN}/whisper-cli"
  fi
  echo "[make-whisper-bin] installed self-contained ${HIP_BIN}/whisper-cli"
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
      /opt/homebrew/opt/whisper-cpp/bin/whisper-cli \
      /usr/local/opt/whisper-cpp/bin/whisper-cli \
      /opt/homebrew/bin/whisper-cli \
      /usr/local/bin/whisper-cli
    do
      if [[ -x "${cand}" ]]; then brew_cli="${cand}"; break; fi
    done
  fi
  if [[ -z "${brew_cli}" ]]; then
    echo "error: Homebrew whisper-cli not found (brew install whisper-cpp)" >&2
    return 1
  fi
  if command -v realpath >/dev/null 2>&1; then
    brew_cli="$(realpath "${brew_cli}")"
  fi
  echo "[make-whisper-bin] dogfood from brew: ${brew_cli}"
  stage_from_file "${brew_cli}"
}

build_from_source() {
  if ! command -v cmake >/dev/null 2>&1; then
    echo "error: cmake is required to build whisper-cli (or HIP_WHISPER_SOURCE=brew on macOS)" >&2
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

  # Pull any extra dylibs from the build tree next to the staged CLI.
  local built_lib
  while read -r built_lib; do
    [[ -f "${built_lib}" ]] || continue
    local base
    base="$(basename "${built_lib}")"
    [[ "${base}" == *whisper* || "${base}" == *ggml* ]] || continue
    cp -f "${built_lib}" "${OUT_DIR}/${base}"
    chmod u+w "${OUT_DIR}/${base}" 2>/dev/null || true
  done < <(find "${WORKDIR}/build" -type f \( -name 'libwhisper*' -o -name 'libggml*' \) 2>/dev/null || true)
  fix_mac_loader_paths "${STAGE}"

  trap - EXIT
  cleanup
}

if already_staged; then
  echo "[make-whisper-bin] already staged ${STAGE} (HIP_WHISPER_REBUILD=1 to rebuild)"
  # Still re-apply rpath fix in case an older orphan stage exists.
  fix_mac_loader_paths "${STAGE}" || true
else
  case "${SOURCE}" in
    brew)
      copy_from_brew
      ;;
    auto)
      if copy_from_brew 2>/dev/null; then
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

echo "[make-whisper-bin] staged self-contained tree:"
ls -la "${OUT_DIR}" | head -20
echo "[make-whisper-bin] done"
