# Product screenshots & media assets

## Static screenshots

README locales link these WebP files (captured from the live desktop UI):

| File | Surface |
|------|---------|
| `chat-surface.webp` | Chat — new conversation |
| `code-surface.webp` | Code — new conversation (pick folder) |
| `code-session.webp` | Code session with supervisor tools + files rail |
| `settings-models.webp` | Settings → Model Configuration |
| `knowledge-home.webp` | Documents (knowledge) home |

Do not commit API keys or personal project paths. The capture run uses an isolated `HIP_DATA_DIR`; keys appear only as the empty `sk-...` placeholder.

## Recapture static screenshots

Requires the debug Tauri binary (`src-tauri/target/debug/hip`) and `cwebp`:

```bash
HIP_DOCS_SHOTS=1 E2E_GREP=@docs-shots yarn test:e2e --spec e2e/specs/docs-screenshots.spec.ts
```

The spec is skipped unless `HIP_DOCS_SHOTS=1`, so it never overwrites these files in CI or `yarn test:e2e:full`.

## Animated assets

### Logo (SVG with SMIL animations)

`../../public/logo-animated.svg` — the mascot logo with eye-blink, arm-wave, and breathing animations.

GitHub renders SMIL animations natively; no JavaScript or CSS required. Supported animations:

- `<animate>` — attribute tween (e.g. eye blink via `ry`)
- `<animateTransform>` — rotation / scale / translate (e.g. arm wave, breathing)

### Demo GIFs (for README)

Recommended workflow to create app demo GIFs:

#### Tools

| OS | Tool | Notes |
|----|------|-------|
| macOS | [GIF Brewery](https://gfycat.com/gifbrewery) / [Kap](https://getkap.co/) | Kap is free & open-source |
| Windows | [ScreenToGif](https://www.screentogif.com/) | Free, frame editor built-in |
| Linux | [Peek](https://github.com/phw/peek) | Simple GTK recorder |
| Cross-platform | [OBS](https://obsproject.com/) + ffmpeg | Record MP4, then convert |

#### Recording tips

1. **Clean desktop** — hide unrelated windows, use a neutral wallpaper or solid color.
2. **Use a demo project** — no real API keys or personal paths visible.
3. **Keep it short** — 10–20 seconds per GIF, max 5–10 MB for fast loading.
4. **Focus on one feature** — each GIF demonstrates one workflow (e.g. "start chat", "send a coding task", "see file changes").
5. **Resize** — 1200–1400px wide is a good balance of clarity vs. file size.

#### Convert MP4 → GIF with ffmpeg

```bash
# 1. Record to .mp4 (e.g. via OBS)

# 2. Generate a palette for better colors
ffmpeg -i demo.mp4 -vf "fps=15,scale=1200:-1:flags=lanczos,palettegen" palette.png

# 3. Convert using the palette
ffmpeg -i demo.mp4 -i palette.png -lavfi "fps=15,scale=1200:-1:flags=lanczos[x];[x][1:v]paletteuse" demo.gif

# 4. Optimize (optional, reduces file size)
gifsicle -O3 --colors 128 demo.gif -o demo-opt.gif
```

#### Recommended demo GIFs to create

| GIF | Filename | Duration | What to show |
|-----|----------|----------|--------------|
| Quick start | `demo-quickstart.gif` | ~15s | Open app → add API key → send first message → see response |
| Coding task | `demo-code-task.gif` | ~20s | Choose project → send "fix bug X" → agent uses tools → file changes appear |
| Multi-agent | `demo-multi-agent.gif` | ~15s | `task_batch` with parallel agents working simultaneously |
| Documents | `demo-documents.gif` | ~10s | Create a note → write content → organize in tables |

