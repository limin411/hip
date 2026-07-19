# Knowledge Base Upgrade — Implementation Plan

> Status: **active**  
> Spec: [`docs/knowledge-upgrade-spec.md`](./knowledge-upgrade-spec.md)  
> Decisions: all Open Questions resolved 2026-07-19 (see spec §14)  
> **Out of scope:** AI / Agent / Memory

---

## 1. North-star constraints

| Constraint | Choice |
|------------|--------|
| SoT | Markdown files under space |
| Link/meta index | **SQLite** per space: `<space>/.hip/index.sqlite` |
| Parse layer | TypeScript domain (shared with preview/search) |
| Persist/query | Tauri + `rusqlite` (bundled) |
| Rename links | Default keep aliases; optional “update backlinks” later (tool) |
| Zip export | Exclude `.hip/index.sqlite*` |
| Git | Ignore DB; track `schema.json` / `views.json` when they exist |

---

## 2. Delivery slices

| Slice | PRs | Outcome | Status |
|-------|-----|---------|--------|
| **MVP-Link** | 01–03 | SQLite index, backlinks/outbound UI, `[[Title#H]]` | **Done** |
| **MVP-Network** | 04–05 | `![[embed]]`, graph (lazy xyflow) | **Done** |
| **MVP-Structure** | 06–10 | schema, properties, table, board (any select) | **Done** |
| **MVP-Polish** | 11–14 | math/mermaid/callout, nested assets, HTML export, version diff, rename links | **Done** |
| **Boundary** | 14+ | mount hip space dir, sync docs, encrypt/publish ADR | Optional |

---

## 3. MVP-Link detailed plan

### PR-01 — Link index core

**TS**

- `linkExtract.ts`: outbound wiki / embed / md (skip fences/inline code)
- `wikiLink.ts`: parse `Title#frag`, `[[#frag]]`, embed `![[…]]`
- `linkIndexClient.ts` helpers: build `DocIndexPayload` from body + tree

**Rust**

- `knowledge_link_index.rs`: open/create DB, schema v1, upsert/remove/replace_all, backlinks/outbound/broken
- Hook: optional best-effort upsert after `knowledge_write_doc` is **not** required if TS always calls upsert (preferred: TS owns parse)

**IPC**

- `knowledge_link_index_upsert`
- `knowledge_link_index_remove_doc`
- `knowledge_link_index_replace_all`
- `knowledge_link_index_backlinks`
- `knowledge_link_index_outbound`
- `knowledge_link_index_broken`

**Store**

- After successful `write_doc` / create / delete / rename title: maintain index
- `openSpace`: if index missing/empty → `replace_all` rebuild (background + progress optional)

### PR-02 — Backlinks + outbound UI

- `KnowledgeOutlinePanel`: tabs or stacked sections Outline | Backlinks | Outbound
- Click backlink → `openDoc` + reveal line if available
- Broken outbound → reuse WikiCreate flow

### PR-03 — Heading anchors

- Preview rewrite includes `#fragment` (slug)
- Click resolved wiki with fragment → open doc + `requestOutlineJump`
- Same-doc `[[#H]]` scrolls only

### Tests

- Unit: parse/extract/resolve fragment
- Unit/store: upsert → backlinks
- e2e (follow-up if time): backlink smoke

---

## 4. Later slices (schema freeze now)

Do **not** invent interim formats that block these:

- Board groups any `select` property (default `status`)
- `.hip/schema.json` + `.hip/views.json` tracked in git
- Embed depth 1 + cycle guard
- Graph lazy-loaded third-party chunk

---

## 5. File touch map (MVP-Link)

```
docs/knowledge-upgrade-spec.md
docs/knowledge-upgrade-plan.md
src-tauri/Cargo.toml                    # rusqlite
src-tauri/src/knowledge_link_index.rs
src-tauri/src/knowledge.rs              # .hip path helpers if needed
src-tauri/src/lib.rs                    # register commands
src/ipc/knowledge.ts
src/domain/knowledge/wikiLink.ts
src/domain/knowledge/linkExtract.ts
src/domain/knowledge/linkIndex.ts       # payload builders + types
src/store/knowledgeStore.ts
src/components/knowledge/KnowledgeOutlinePanel.tsx
src/components/knowledge/DocReader.tsx
src/components/knowledge/KnowledgeWorkspace.tsx  # if navigate+jump wiring
src/i18n/en.ts, zh-CN.ts, zh-TW.ts
tests: *.test.ts
```

---

## 6. Definition of done (MVP-Link)

- [x] Save doc with `[[Other]]` → Other’s backlinks lists source (index + panel wired)
- [x] Delete source → backlink gone (remove_doc on delete)
- [x] Broken outbound marked in panel
- [x] Empty index on openSpace → rebuild
- [x] `[[Doc#Heading]]` / `[[#H]]` navigate (DocReader + workspace)
- [x] Existing `[[Title]]` behavior unchanged (tests green)
- [x] Unit tests: linkExtract, wikiLink, DocReader, OutlinePanel, knowledgeStore
- [ ] e2e smoke (optional follow-up)

## 7. Implementation log (2026-07-19)

Shipped **MVP-Link** core in-tree:

| Area | Files |
|------|--------|
| Spec/Plan | `docs/knowledge-upgrade-spec.md`, `docs/knowledge-upgrade-plan.md` |
| SQLite | `src-tauri/src/knowledge_link_index.rs`, `rusqlite` dep |
| Domain | `linkExtract.ts`, `linkIndex.ts`, wiki fragment support |
| Store/IPC | `knowledgeStore` hooks, `ipc/knowledge.ts` |
| UI | Outline panel backlinks/outbound; DocReader heading anchors |

## 8. MVP-Network log (2026-07-19)

| Area | Delivered |
|------|-----------|
| Embed domain | `embedSplit.ts` — split, section extract, 64KB cap, depth 1 |
| Embed UI | `KnowledgeEmbedCard` + DocReader interleave (Preview) |
| Slash | `/embed` → `![[]]` |
| Graph IPC | `knowledge_link_index_graph` |
| Graph UI | lazy `KnowledgeGraphCanvas` (@xyflow), modal, neighborhood/full |
| Layout | pure BFS rings (`graphLayout.ts`) |

## 9. MVP-Structure log (2026-07-19)

| Area | Delivered |
|------|-----------|
| Schema | `schema.ts` + `.hip/schema.json` IPC; defaults status/tags/aliases/date/priority |
| FM | Extended meta (`date`, `priority`, `props`) + `applyMetaToDocument` |
| Views | `views.ts` filter/sort/board; `.hip/views.json` defaults All table + Board |
| UI | Editable `DocPropertiesRow`; view tabs; Table + Board DnD by any select key |
| Store | `loadSpaceConfig`, `patchDocField`, `getDocMetaMap`, `activeViewId` |

## 10. MVP-Polish log (2026-07-19)

| Area | Delivered |
|------|-----------|
| Math | remark-math + rehype-katex in `KnowledgeMarkdownBody` |
| Mermaid | lazy `mermaid` for ` ```mermaid ` fences |
| Callout | `> [!note]` etc. via blockquote component |
| Nested assets | Rust `asset_path` + TS `normalizeAssetRelPath` + zip walk |
| HTML export | pick `.html` → offline HTML; Print→PDF |
| Version diff | line LCS diff modal in history |
| Rename links | optional checkbox → rewrite `[[old]]` / embeds |

**Remaining optional:** P7 boundary (mount external, encrypt, publish ADR).
