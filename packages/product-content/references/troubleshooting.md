# hip troubleshooting (Level 3)

## No API / model calls work

1. Open **Settings → Providers** and confirm a key is saved.
2. Keys live in `~/.hip/config/auth.json` (never print secrets to the user).
3. Restart the app after changing auth outside the UI.
4. Check sidecar logs under `~/.hip/logs/`.

## CLI: `APP_NOT_RUNNING`

The product CLI attaches to a **running** hip desktop app. Start the app first (`yarn tauri dev` or installed app), then `yarn cli:dev doctor`.

## Memory list empty after enabling

1. Confirm **Settings → Memory** has **use** and **generate** as intended.
2. Need enough chat turns + API key for extract; try **Learn now**.
3. Status may show `no_llm`, `rate_limited`, or empty extract — fix key / quota / wait.
4. SQLite is source of truth; stale mirrors under `~/.hip/memories/` are not the DB.

## Agent cannot write files

- Permission mode **chat** is read-only.
- Default **edit** is sandboxed to the project root — paths outside fail.
- Use **full** only when the user explicitly granted whole-machine FS access.

## Skill not listed / use_skill fails

- Skill may be disabled in `hip.toml` or plugin disabled.
- Project skill `paths` globs may exclude the cwd.
- Built-in product skill id is `hip` under `~/.hip/builtin-skills/hip/`.

## Sidecar / connection issues

- Desktop shell spawns the sidecar and exposes its WS port.
- If the UI cannot connect, restart the app; check `~/.hip/logs/`.
- Dev: regenerate sidecar binary wrapper with `yarn sidecar:dev-bin` after toolchain changes.

## Stale DMG / build (macOS)

Stale `rw.*.dmg` mounts can break `yarn tauri build`; remove them and detach `/Volumes/hip` if needed.
