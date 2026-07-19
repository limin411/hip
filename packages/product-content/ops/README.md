# Operational coding skill (source of truth)

Part of `packages/product-content/`. Markdown here is the SoT for the built-in `hip-coding` skill (deep coding / delegation / git policy).

The always-on system prompt keeps a **compact** core of these rules; the model loads this skill via `use_skill({ name: "hip-coding" })` for full detail.

| Path | Use |
|------|-----|
| `meta.json` | skill id/name/version/description |
| `hip-coding/SKILL.md` | Skill body (Level 2) |

## Edit workflow

```bash
# edit packages/product-content/ops/** then:
yarn product:content   # regenerates product + ops embeds
yarn product:content:check
```

Generated: `packages/sidecar/src/session/ops/content.ts` (do not hand-edit).

See also: parent [product-content](../) for product help progressive disclosure.
