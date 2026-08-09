# hip memory (Level 3)

Cross-session memory is **disabled by default** (privacy / cost).

## Enable

1. Open **Settings → Memory**.
2. Enable **use** and/or **generate**.
3. Enabling both from a cold install may apply a dogfood preset (shorter idle / extract interval) when gates are still defaults.
4. Ensure a provider API key is configured (Settings → Providers). Extraction needs an API key.

## What is stored

Structured items in SQLite (`memory_items`): preferences, conventions, lessons, workflows, profiles — scoped **global**, **project**, or **session**.

**Source of truth is SQLite.** Markdown under `~/.hip/memories/` is an export mirror. Project `MEMORY.md` / `.hip/MEMORY.md` is separate project-notes injection, not auto-imported into SQLite.

## Runtime behavior

| Path | Behavior |
|------|----------|
| **Use** | Core snapshot + per-turn prefetch + `memory_*` tools |
| **Generate** | After idle → Phase1 extract → Phase2 consolidate |
| **Incognito** | Session flag: no inject and no extract |
| **Learn now** | Settings control to force extract/consolidate when dogfooding |

Managed sub-agents may get read-only core injection; external ACP agents default off.

## Privacy notes

- Cold defaults: use/generate off
- Threat-scan + secret redact on write
- Soft-delete trash + retention

