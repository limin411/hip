# Product content (source of truth)

Shippable product copy for hip — **not** developer documentation.

Root repo `docs/` is for optional human-only notes and is **not** used by the app or `yarn product:content`.

Markdown here generates embeds via `yarn product:content`:

| Path | Level | Runtime use |
|------|-------|-------------|
| `capability-map.md` | L0 | Always in main system prompt (agent, English) |
| `help-guidance.md` / `help-fallback.md` | L0 | Conditional product help pointer (agent, English) |
| `SKILL.md` | L2 | Agent `use_skill({ name: "hip" })` body (English) |
| `references/*` | L3 | Agent `read_file` (English) |
| `meta.json` | meta | skill id/name/description + content schema version |
| `locales/**` | UI | **Unrendered** — see note below |
| `ops/` | L2 | Built-in `hip-coding` skill SoT |

> **Note:** the UI-side pack (`src/domain/product/productDocs.generated.ts`, 5 locales) was removed
> with Settings → Product help. `yarn product:content` no longer reads `locales/**`, so those
> translations are neither generated, checked, nor user-visible. They are kept only in case the
> Help page returns; re-wire the generator and re-check them before trusting their content.

## Index

| Topic | English | 简体中文 | 繁體中文 |
|-------|---------|----------|----------|
| Overview | [SKILL.md](./SKILL.md) | [locales/zh-CN/SKILL.md](./locales/zh-CN/SKILL.md) | [locales/zh-TW/SKILL.md](./locales/zh-TW/SKILL.md) |
| Capability map | [capability-map.md](./capability-map.md) | [zh-CN](./locales/zh-CN/capability-map.md) | [zh-TW](./locales/zh-TW/capability-map.md) |
| Memory | [references/memory.md](./references/memory.md) | [zh-CN](./locales/zh-CN/references/memory.md) | [zh-TW](./locales/zh-TW/references/memory.md) |
| Config & data | [references/config-and-data.md](./references/config-and-data.md) | [zh-CN](./locales/zh-CN/references/config-and-data.md) | [zh-TW](./locales/zh-TW/references/config-and-data.md) |
| Troubleshooting | [references/troubleshooting.md](./references/troubleshooting.md) | [zh-CN](./locales/zh-CN/references/troubleshooting.md) | [zh-TW](./locales/zh-TW/references/troubleshooting.md) |
| Agents, plugins, TaskRuntime | [references/agents-and-plugins.md](./references/agents-and-plugins.md) | [zh-CN](./locales/zh-CN/references/agents-and-plugins.md) | [zh-TW](./locales/zh-TW/references/agents-and-plugins.md) |
| Coding ops skill (incl. TaskRuntime policy) | [ops/](./ops/) | — | — |

Also: `locales/ja/`, `locales/ko/` for the same topics — currently unrendered (see note above).

## Edit workflow

1. Edit English files under this tree. `locales/**` is out of the pipeline until the Help page returns.
2. For coding/delegation policy, edit `ops/`.
3. Run:

```bash
yarn product:content
yarn product:content:check
```

4. Commit markdown changes **and** regenerated:

- `packages/sidecar/src/session/product/content.ts` (agent, English)
- `packages/sidecar/src/session/ops/content.ts` (ops skill)

## Placeholders

`{{HIP_PRODUCT_VERSION}}` is replaced with the root `package.json` `version` at generate time.
