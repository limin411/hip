# hip UX Phase 5 — Transcript Defaults On

| Field | Value |
| --- | --- |
| **Date** | 2026-07-22 |
| **Status** | Implemented (2026-07-22) |
| **Depends on** | Phase 1–4; PR-5 / PR-7c dogfood |

## Changes

| Flag | Before | After |
| --- | --- | --- |
| `TRANSCRIPT_INTERLEAVED_BLOCKS` | false | **true** |
| `TRANSCRIPT_VIRTUALIZE` | false | **true** |

## Rationale

- Interleaved: process + supervisor text share one stepSeq stream (less “answer demoted under trail”).
- Virtualize: long sessions stay responsive with windowing + measureElement (already tested in `ChatPane.virtual.test.tsx`).

## Guardrails

- Unit tests mock flags where they need both on/off paths.
- ACP / no-supervisor-text turns keep legacy answer body (`hasRenderableSupervisorText` gate).
- Rollback: set both flags false in `feature.ts`.

## Done when

- Defaults true in `feature.ts`
- MessageBubble + ChatPane virtual/window/jump + TurnTimeline green
- tsc green
