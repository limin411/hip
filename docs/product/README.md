# Product docs (source of truth)

Markdown here is the **source of truth** for hip product progressive disclosure.

| Path | Level | Runtime use |
|------|-------|-------------|
| `capability-map.md` | L0 | Always in main system prompt + Settings → Help summary |
| `help-guidance.md` / `help-fallback.md` | L0 | Conditional product help pointer (agent, English) |
| `SKILL.md` | L2 | Agent `use_skill({ name: "hip" })` body (English) + Help overview (locale) |
| `references/*` | L3 | Agent `read_file` + Help topic tabs |
| `meta.json` | meta | skill id/name/description + content schema version |
| `locales/zh-CN/`, `locales/zh-TW/` | UI | Settings Help localized bodies (agent stays English) |

## Docs site (local)

This directory is the in-repo **product documentation site** (Hermes-style: paths, not a separate hosted SPA):

1. **Humans** — read the markdown here or open **Settings → Help** in the app.
2. **Agent** — English embeds via generated `content.ts`; load with `use_skill("hip")`.
3. **UI** — generated `productDocs.generated.ts` selects locale pack from app language.

### Index

| Topic | English | 简体中文 | 繁體中文 |
|-------|---------|----------|----------|
| Overview | [SKILL.md](./SKILL.md) | [locales/zh-CN/SKILL.md](./locales/zh-CN/SKILL.md) | [locales/zh-TW/SKILL.md](./locales/zh-TW/SKILL.md) |
| Capability map | [capability-map.md](./capability-map.md) | [zh-CN](./locales/zh-CN/capability-map.md) | [zh-TW](./locales/zh-TW/capability-map.md) |
| Memory | [references/memory.md](./references/memory.md) | [zh-CN](./locales/zh-CN/references/memory.md) | [zh-TW](./locales/zh-TW/references/memory.md) |
| Config & data | [references/config-and-data.md](./references/config-and-data.md) | [zh-CN](./locales/zh-CN/references/config-and-data.md) | [zh-TW](./locales/zh-TW/references/config-and-data.md) |
| Troubleshooting | [references/troubleshooting.md](./references/troubleshooting.md) | [zh-CN](./locales/zh-CN/references/troubleshooting.md) | [zh-TW](./locales/zh-TW/references/troubleshooting.md) |
| Agents & plugins | [references/agents-and-plugins.md](./references/agents-and-plugins.md) | [zh-CN](./locales/zh-CN/references/agents-and-plugins.md) | [zh-TW](./locales/zh-TW/references/agents-and-plugins.md) |

Related: operational coding policy lives in [`docs/ops/`](../ops/).

## Edit workflow

1. Edit English files under `docs/product/` **and** matching files under `locales/zh-CN` / `locales/zh-TW` when UI copy changes.
2. Run:

```bash
yarn product:content
yarn product:content:check
```

3. Commit markdown changes **and** regenerated:

- `packages/sidecar/src/session/product/content.ts` (agent, English)
- `src/domain/product/productDocs.generated.ts` (UI, all locales)

## Placeholders

`{{HIP_PRODUCT_VERSION}}` is replaced with the root `package.json` `version` at generate time.

## Regenerating

After editing markdown under this tree or `docs/ops/`:

```bash
yarn product:content
```
