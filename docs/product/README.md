# Product docs (source of truth)

Markdown here is the **source of truth** for hip product progressive disclosure injected into the agent:

| Path | Level | Runtime use |
|------|-------|-------------|
| `capability-map.md` | L0 | Always in main system prompt + Settings → Help summary |
| `help-guidance.md` / `help-fallback.md` | L0 | Conditional product help pointer (agent only) |
| `SKILL.md` | L2 | `use_skill({ name: "hip" })` body + Help overview tab |
| `references/*` | L3 | `read_file` after use_skill + Help topic tabs |
| `meta.json` | meta | skill id/name/description + content schema version |

Generated outputs (do not hand-edit):

- `packages/sidecar/src/session/product/content.ts` — agent embeds
- `src/domain/product/productDocs.generated.ts` — UI Settings → Help

## Edit workflow

1. Edit files under `docs/product/` (not `packages/sidecar/src/session/product/content.ts`).
2. Run:

```bash
yarn product:content
```

3. Commit both the markdown changes **and** the regenerated `content.ts`.

## Check (CI / pre-commit)

```bash
yarn product:content:check
```

Fails if `content.ts` is stale relative to this directory + root `package.json` version.

## Placeholders

In markdown bodies, `{{HIP_PRODUCT_VERSION}}` is replaced with the root `package.json` `version` field at generate time.

## Spec

See [product-prompt-progressive-disclosure-spec.md](../product-prompt-progressive-disclosure-spec.md).
