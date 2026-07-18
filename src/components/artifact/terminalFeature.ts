/**
 * Feature switch for the code-surface right-panel Terminal tab.
 * Set false to dark-launch rollback.
 *
 * Scope: code surface + committed session only; no OS sandbox.
 * Shell: `[terminal].shell` in hip.toml (General Settings). Defaults:
 * Unix `$SHELL -il`, Windows `cmd.exe`. PowerShell loads the user profile.
 */
export const CODE_TERMINAL = true
