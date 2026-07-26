# Design document summary

## What was produced

A full implementation-ready design/spec for **completing hip’s right-click context menus** across remaining high-UX-value surfaces:

- **Design:** `/var/folders/gn/b7lwc_t501599rqsqgwtfw6c0000gn/T//grok-501/grok-design-doc-f46df18d.md`  
  Status: **Draft (R3 — overflow drop-order locked)** — ready for implementation
- **Review responses:** `/var/folders/gn/b7lwc_t501599rqsqgwtfw6c0000gn/T//grok-501/grok-design-review-f46df18d.md`
- **This summary:** same directory

Style follows `docs/design/work-items-calendar-list.md`.

## R3 fix (1 residual)

**Overflow DROP_ORDER locked:** `cancel → setInProgress → openUrl → openKnowledge → openSession → archive|unarchive` (core-4 never drops). Removed contradictory “drop nav first / Prefer…” prose. Golden unit-test array for todo+3 links: open, complete, copyTitle, delete, archive, openSession, openKnowledge, openUrl.

## R2 review fixes (all 15 issues)
| Area | Locked decision |
|------|-----------------|
| Soft-delete | Provider → `openWorkItemDeleteDialog` only; identity payload; sibling host on WorkItemsPage; confirm closes editor if same id |
| Navigation | Exact `selectSessionFromSidebar` / knowledge leave+`openSpace(…, {selectDocId})` / local plugin-opener; no link CRUD |
| Action cap | Hard ≤8; core-4 + status + nav; drop cancel/setInProgress then links from end |
| PR conflicts | **PR3.5** owns types/catalog/registry; PR4/PR5 hosts only |
| Status matrix | No complete/setInProgress when cancelled; no cancel when done |
| Calendar | Outer gridcell testids; mid/end bars same menu; DayMorePopover P0 |
| Plugin | PR2 ships `plugin.view` + uninstall |
| chatEmpty | Skip P0; if revived use `insertComposerText` / `hasComposerInserter` |
| agent group | `GROUP_ORDER` + named `ContextGroupId`; PR1 Settings order tests |

## Design essence

- **Reuse only** — no framework redesign; flag `CONTEXT_MENUS`.
- **New kinds:** `workItem`, `workItemBlank`, `trashEntry`; wire `plugin` (view+uninstall); optional `chatEmpty`; `artifactChrome` deferred/won’t.
- **workItem payload:** identity-only; provider imports stores/dialogs (sessionHistory style).
- **trashEntry:** callback payload for UnifiedRow restore/hard-delete (settings-list style).

## PR plan (post-R2)

1. Hygiene: agent group + ContextGroupId + Settings kinds  
2. Plugin view + uninstall (parallel with PR1)  
3. Shared soft-delete dialog host  
3.5. Kinds skeleton (types/catalog/registry)  
4. Work item hosts + full provider  
5. Trash hosts (parallel with 4 after 3.5)  
6. Optional chatEmpty  
7. Phase 2 knowledgeDoc + outline  
8. E2E + README  

## Document sections

Overview, Background, Goals/Non-Goals, **Key Decisions (D1–D25)**, Proposed Design (matrix, overflow, nesting, soft-delete), API, Data Model, Alternatives, Security, Observability, Rollout/Risks, Open Questions, References, **PR Plan**.
