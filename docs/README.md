# docs/

Optional **developer-only** notes for the hip repository.

This directory is **not** a source of truth for the running app, embeds, or `yarn product:content`.

Shippable product copy (Help UI, builtin skills) lives in:

- [`packages/product-content/`](../packages/product-content/) — product help + locales
- [`packages/product-content/ops/`](../packages/product-content/ops/) — `hip-coding` skill

After editing those trees, run `yarn product:content`.
