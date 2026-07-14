# PR-09a Spike — Milkdown / Crepe GFM round-trip evaluation

| Field | Value |
|-------|-------|
| **Date** | 2026-07-14 |
| **Branch** | `execute-plan/e0d7cb25-pr-09a-milkdown-spike-time-boxed` |
| **Pinned version** | `@milkdown/kit@7.21.3` |
| **Verdict** | **GO for PR-09 with kit** (not Crepe). Live stays flag-off until PR-17. |
| **Fallback** | Option A (CM decorations + slash on CM) remains available if PR-09 integration slips. |

## Package choice

| Candidate | Result | Why |
|-----------|--------|-----|
| **`@milkdown/crepe@7.21.3`** | **NO-GO** | Feature-rich (slash, block handle, todo UI) but **bundle >> budget**. Vite lib probe: main chunk **~2.28 MB raw / ~607 KB gzip9**; full build with CM language packs **~1.2 MB gzip**. Also pulls **Vue**, KaTeX, second CodeMirror stack, lodash-es. `@milkdown/react@7.21.3` **depends on Crepe** — do not add `@milkdown/react` for a lean host. |
| **`@milkdown/kit@7.21.3`** (+ presets via kit exports) | **GO** | `Editor` + `preset/commonmark` + `preset/gfm` + `plugin/listener` + `utils` (`getMarkdown` / `replaceAll`). Vite lib probe of the live-needed surface: **`probe.js` ~693 KB raw / ~179 KB gzip9** — under soft target **&lt;250 KB gzip**, well under **400 KB** “prefer fallback” line. |
| TipTap (out of scope check) | skipped | Design already ranked Fair–poor MD round-trip. |

**PR-09 integration recommendation**

```ts
// Prefer custom React host (ref + useEffect), NOT @milkdown/react
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { getMarkdown, replaceAll } from '@milkdown/kit/utils'
```

- Lazy-load the Live chunk so Source-only users pay **0** for Milkdown.
- Pin exact `7.21.3` (or re-pin after a second spike if upgrading).
- Styles: import ProseMirror / GFM table CSS from kit exports as needed; do **not** import Crepe themes unless product later accepts the weight.

## Fixture results (`mdRoundTrip.spike.test.ts`)

Method: happy-dom Vitest → `Editor.make().use(commonmark).use(gfm)` → `defaultValueCtx` → `getMarkdown()`. Compare via `normalizeMd` (contract + spike expansions).

| # | Fixture | Raw identity? | After `normalizeMd`? | Notes |
|---|---------|---------------|----------------------|-------|
| 1 | tasks | No (`*` markers, blank lines between items) | **Yes** | GFM task nodes work; serializer uses `* [ ]` / blank separators |
| 2 | tables | No (`\| - \|` vs `\| --- \|`) | **Yes** | Tables parse/serialize; separator dashes shortened |
| 3 | strike | **Yes** | Yes | `~~strike~~` stable |
| 4 | fences | **Yes** | Yes | language tag preserved |
| 5 | blockquote | **Yes** | Yes | |
| 6 | lists (ul + ol) | No (blank lines / `*`) | **Yes** | Ordered list markers stable (`1.`) |
| 7 | autolink | No (`<https://…>`) | **Yes** | Angle-bracket form is GFM-equivalent |
| 8 | CJK | **Yes** | Yes | |
| 9 | empty | **Yes** (`''`) | Yes | |
| 10 | frontmatter | **Corrupted** | N/A — **must not pass through Live** | Leading `---` becomes thematic break (`***`); YAML body leaks as paragraphs; `[` escaped |

### Frontmatter strategy (required for PR-09 / P1.6)

**Choice: strip before Live, re-prefix on serialize** (allowed by contract).

```
disk.md  →  splitYamlFrontmatter(md)
              ├─ fmText (opaque string, may be '')
              └─ body   → Milkdown defaultValue / replaceAll
onChange →  liveEditorToMarkdown() → body'
disk'    →  fmText ? `${fmText}\n${body'}` : body'
```

Never feed raw documents with `---` fences into the editor. Unit-test the split/join helpers in PR-09/P1.6, not Milkdown itself.

### `normalizeMd` (spike)

Implemented in `src/domain/knowledge/mdRoundTrip.spike.test.ts` (export for PR-09 to promote into `domain/knowledge/mdNormalize.ts` if desired):

1. CRLF → LF  
2. `*` / `+` unordered markers → `-`  
3. `[X]` → `[x]`  
4. Collapse blank lines between consecutive list items  
5. Normalize table separator cells to `---` / ` :--- ` / etc.  
6. Unwrap `<https://…>` autolinks  
7. Single trailing `\n`; empty doc stays `''`  

Trailing spaces per line: **not** stripped (contract optional-off).

## Bundle note

| Build | Raw | gzip9 | vs budget |
|-------|-----|-------|-----------|
| kit entry (core + commonmark + gfm + utils + listener) | ~693 KB | **~179 KB** | Soft target &lt;250 KB ✅ |
| crepe entry (default export only; languages code-split) | main ~2.28 MB; total ~4 MB | main **~607 KB**; total **~1.2 MB** | Soft fail; hard “prefer A” (&gt;400 KB) ❌ |

Probe method: Vite 6 lib mode, `minify: esbuild`, external `react`/`react-dom`, measured `probe.js` only (ignore accidental `public/` asset copy). Numbers are **added dependency weight**, not full app delta; app already ships CodeMirror + remark-gfm for Source/Preview — kit does not depend on a second CM for this entry.

Crepe’s weight alone is sufficient to reject it for Phase 1 Live even if UX is nicer (slash/block chrome can be reimplemented thinner in PR-10).

## Go / No-go vs contract exit criteria

| Exit-to-fallback A trigger | Observed |
|----------------------------|----------|
| Misses GFM **tasks** or **tables** | **No** — both round-trip under normalize |
| &gt;2 **flaky** fixture classes after 2 pin attempts | **No** — diffs are **deterministic** serializer style |
| Schedule slip &gt;1 week past PR-09a | N/A (spike completes in window) |
| Bundle gzip &gt;400 KB (strong prefer A) | **Crepe yes / kit no** |

### Verdict: **GO — PR-09 with `@milkdown/kit`, flag default off**

Ship Live behind `localStorage` `hip-knowledge-live` (default **false**). Source remains CodeMirror. Do **not** enable Live as default in this spike or PR-09.

### If PR-09 later fails integration

Use **Fallback A**: CM decorations + slash on CM; leave Milkdown dep unused or remove. Product still has Preview (`DocReader`) + Source.

## Out of spike scope (not evaluated)

- Footnotes, MDX, raw HTML (contract: out of fixture scope)
- Wiki `[[links]]` schema (PR-11)
- Slash menu UX (PR-10)
- Full workspace wiring / `DocLiveEditor.tsx` production component
- Paste-HTML hardening
- Large-doc perf (`KNOWLEDGE_LARGE_DOC_CHARS` → force Source remains policy)

## Files in this spike

| Path | Role |
|------|------|
| `package.json` / `yarn.lock` | pins `@milkdown/kit@7.21.3` only (no crepe/react host) |
| `src/domain/knowledge/mdRoundTrip.spike.test.ts` | fixture suite + `normalizeMd` |
| `src/components/knowledge/DocLiveEditor.spike.md` | this report |

**Not shipped:** Live UI, feature flag wiring, toolbar mapping, i18n.
