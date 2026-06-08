/**
 * Tie this process's lifetime to the parent (the Tauri app) that spawned it.
 *
 * tauri-plugin-shell spawns the sidecar with a piped stdin and keeps the write
 * end (`CommandChild`). When the Tauri app process dies by ANY means — a graceful
 * Cmd+Q, a crash, or the SIGTERM/SIGKILL the WebdriverIO E2E harness sends at
 * teardown — the kernel closes that write end, so our stdin reaches EOF.
 *
 * Tauri's own `child.kill()` (RunEvent::ExitRequested) only covers the graceful
 * GUI-quit path; a signal-killed app runs no Rust handler at all, and macOS does
 * not reap children when their parent dies. That orphaned the Node sidecar — it
 * kept the SQLite file locked and the WS port bound, which is what flaked
 * real-machine E2E (`pkill -f "tsx packages/sidecar/src/main"` between runs).
 *
 * Watching stdin for EOF makes the sidecar self-terminate in exactly that window,
 * no matter how the parent went away. It is gated by the caller (HIP_PARENT_WATCH)
 * so standalone runs — e.g. `scripts/dev.sh start sidecar`, launched with stdin =
 * /dev/null, which would otherwise see an immediate EOF — are unaffected.
 */
export function watchParentViaStdin(
  onParentExit: () => void = () => process.exit(0),
  stdin: NodeJS.ReadStream = process.stdin,
): void {
  let fired = false
  const exit = () => {
    if (fired) return
    fired = true
    onParentExit()
  }
  stdin.on('end', exit)
  stdin.on('close', exit)
  // A broken read pipe surfaces as an error on some platforms; the parent is gone.
  stdin.on('error', exit)
  // Paused streams never emit 'end'. Flowing mode reads and discards bytes (we
  // have no stdin protocol) and emits 'end' when the parent closes the pipe.
  stdin.resume()
}
