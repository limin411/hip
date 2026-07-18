# Memory

Long-term, cross-session memory for hip. **Disabled by default** (privacy / cost).

## Enable

1. Open **Settings → Memory**.
2. **Enable use + generate** (or use only).
3. Enabling both from a cold install applies a dogfood preset when gates are still defaults: idle **2** minutes, min extract interval **0.25** hours (daily cap unchanged).
4. Ensure a provider API key is configured (Settings → Providers). Extraction uses the optional extract model, or the active provider’s cheap model.

## What is stored

Structured items in SQLite (`memory_items`): preferences, conventions, lessons, workflows, profiles — scoped **global**, **project**, or **session**.

Optional fields:

- **`expiresAt`** — after this time the item is hidden from list / search / core inject (still fetchable by id). Set via `memory_add` `expiresInDays` or API upsert.
- **`agentId`** — when **Settings → Memory → Advanced → Per-agent memory buckets** is on, managed sub-agents read/write shared items (`agentId` empty) plus their own registry id bucket.

**Source of truth is SQLite.** Markdown under `~/.hip/memories/` is an export mirror (rewritten on mutations). Project cwd `MEMORY.md` / `.hip/MEMORY.md` is separate (AGENTS-style notes via `ProjectAgentsMdInjector`), not auto-imported into SQLite.

## How it works

| Path | Behavior |
|------|----------|
| **Use** | Core snapshot (profile + summaries + pinned/active bodies + capacity line) + per-turn prefetch (FTS / optional hybrid) + `memory_*` tools |
| **Generate** | After idle debounce → Phase1 extract → Phase2 consolidate → decay / mirror rewrite |
| **Incognito** | Session flag: no inject and no extract |
| **Search** | FTS (or hybrid) candidates, then **query re-rank** (keyword + tag overlap + recency) so relevant hits surface even when hybrid is off |

Core injection uses a **generation counter**: mid-session extracts invalidate the frozen core so the next turn reloads. Within a turn, the freeze stays stable for prefix-cache friendliness.

Managed sub-agents receive **read-only** core text and optional `memory_search` (config `memoryToolsForSubagents`). External ACP agents default off (`useMemoriesWithExternal`).

## Privacy

- Cold defaults: `useMemories` / `generateMemories` false.
- Hybrid search (optional) sends snippets to embedding/rerank providers; leave hybrid off for FTS-only local search.
- Threat-scan + secret redact on write.
- Soft-delete trash + retention; session-derived hard delete available.

## Learn now (立即学习)

**Settings → Memory → Learn now** runs a dogfood-friendly path:

1. If there is **no pending stage1**, try **Phase1 extract** on recent chat sessions (skips idle/interval gates; still respects daily extract quota and needs API key + Generate on).
2. Then **Phase2 consolidate** into durable `memory_items`.

Feedback appears under the button (`no_llm`, not enough chat, quota, or success with counts).

## Troubleshooting empty memory

| Symptom | Check |
|---------|--------|
| List empty after enable | Chat ≥ min turns, enable Generate, click **Learn now**, or wait idle auto-learn; status strip for `succeeded_no_output` / `no_llm` / `rate_limited` |
| Learn now → nothing | Need API key; recent sessions need enough messages; daily quota; or LLM returned empty extract |
| `no_llm` CTA | Configure API key; optional extract model |
| Mirror files have old content | SQLite is SoT; mirrors rewrite from DB on mutation/startup. Use **Import from mirror** only when DB is empty for that scope |
| Sub-agent forgets | Managed path injects parent core when use is on; external agents need `useMemoriesWithExternal` |

## Design

See `docs/memory-longterm-design.md` for architecture, PR plan history, and key decisions.
