# Product screenshots

README locales link these WebP files (captured from the live desktop UI):

| File | Surface |
|------|---------|
| `chat-surface.webp` | Chat — new conversation |
| `code-surface.webp` | Code — new conversation (pick folder) |
| `code-session.webp` | Code session with supervisor tools + files rail |
| `settings-models.webp` | Settings → Model Configuration |
| `knowledge-home.webp` | Documents (knowledge) home |

Do not commit API keys or personal project paths. The capture run uses an isolated `HIP_DATA_DIR`; keys appear only as the empty `sk-...` placeholder.

## Recapture

Requires the debug Tauri binary (`src-tauri/target/debug/hip`) and `cwebp`:

```bash
HIP_DOCS_SHOTS=1 E2E_GREP=@docs-shots yarn test:e2e --spec e2e/specs/docs-screenshots.spec.ts
```

The spec is skipped unless `HIP_DOCS_SHOTS=1`, so it never overwrites these files in CI or `yarn test:e2e:full`.

