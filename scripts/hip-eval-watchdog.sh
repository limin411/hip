#!/usr/bin/env bash
# Phase E3: watch a live eval log; kill hung wdio/yarn if no progress past deadline.
# Usage:
#   scripts/hip-eval-watchdog.sh /path/to/run.log 1800
# Default deadline: 30 minutes of no Spec Files / eval score line.
set -euo pipefail
LOG="${1:?log path}"
# seconds without terminal pattern before kill
STALE_SEC="${2:-1800}"
PATTERN='\[eval|Spec Files:|passed|FAILED'

echo "[watchdog] watching ${LOG} stale=${STALE_SEC}s"
last_progress="$(date +%s)"
last_size=0

while true; do
  if [ ! -f "${LOG}" ]; then
    sleep 5
    continue
  fi
  size="$(wc -c <"${LOG}" | tr -d ' ')"
  if grep -E 'Spec Files:|\[eval' "${LOG}" >/dev/null 2>&1; then
    if grep -E 'Spec Files:.*total' "${LOG}" >/dev/null 2>&1; then
      echo "[watchdog] run finished"
      exit 0
    fi
  fi
  if [ "${size}" != "${last_size}" ]; then
    last_size="${size}"
    last_progress="$(date +%s)"
  fi
  now="$(date +%s)"
  idle=$((now - last_progress))
  if [ "${idle}" -ge "${STALE_SEC}" ]; then
    echo "[watchdog] stale ${idle}s — killing eval workers"
    # Kill by PIDs matching known eval specs (avoid self-kill via -f on whole cmdline carefully)
    for pat in \
      'eval-orch' \
      'eval-hard' \
      'eval-adv' \
      'eval-mini' \
      'eval-bytebase' \
      'wdio run wdio.conf.ts'
    do
      pgrep -f "${pat}" 2>/dev/null | while read -r pid; do
        # skip this watchdog shell
        if [ "${pid}" = "$$" ]; then continue; fi
        kill "${pid}" 2>/dev/null || true
      done
    done
    echo "[watchdog] killed; archive partial reports with scripts/hip-eval-cluster.sh"
    bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hip-eval-cluster.sh" || true
    exit 2
  fi
  sleep 30
done
