# Product Prompt Progressive Disclosure — Implementation Plan

> Spec: [`docs/product-prompt-progressive-disclosure-spec.md`](./product-prompt-progressive-disclosure-spec.md)  
> Date: 2026-07-19

---

## Full roadmap (complete)

| Phase | Theme | Items | Ship in this execution? |
|-------|--------|-------|-------------------------|
| **P0** | Reliability | Conditional HELP_GUIDANCE; pin `hip` in skillsBlock; content fingerprint + force rewrite; L0 CAPABILITY_MAP; ConfigManager/system-prompt/pin tests | **Yes** |
| **P1** | Coverage | Product version constant; L3 troubleshooting + agents-and-plugins; L2 cross-links; answer-in-user-language note | **Yes** |
| **P2** | Single source | `docs/product/` markdown SoT; generate/embed into `content.ts`; optional CI path checks vs README | **Yes** |
| **P2b** | Surfaces | UI Help/About panel from same SoT | **Yes** |
| **P3** | Operational progressive | Split fat BASE into optional skills (delegation, git); keep core + anti-phantom always | **Yes** |
| **P3b** | Measurement | Dogfood script: N product questions → use_skill hit rate | **Yes** (offline matrix; live LLM optional later) |
| **P4** | i18n / docs site | Bilingual packs or public docs URL (Hermes-style) | No |

---

## This execution (P0 + P1) — work units

### W1 — Content + fingerprint materialization

**Files:**

- `packages/sidecar/src/session/product/content.ts`
- `packages/sidecar/src/session/product/builtin-skills.ts`

**Changes:**

1. Bump `PRODUCT_SKILL_VERSION` → `2`
2. Add `HIP_PRODUCT_VERSION = '0.1.0'`
3. Expand L2 with version line + L3 index for new refs
4. Add `TROUBLESHOOTING_REFERENCE_MD`, `AGENTS_PLUGINS_REFERENCE_MD`
5. `contentFingerprint()` + `ensureHipProductSkillDir` rewrite on stamp **or** byte mismatch
6. Export `productHelpGuidance(opts: { skillAvailable: boolean })` or dual constants + builder
7. Export `PRODUCT_CAPABILITY_MAP`

**Tests:** `builtin-skills.test.ts` — dirty file rewrite; fingerprint change; getBuiltinSkills lists new refs.

### W2 — System prompt assembly

**Files:**

- `packages/sidecar/src/session/system-prompt.ts`
- `packages/sidecar/src/session/system-prompt.test.ts`
- `packages/sidecar/src/session/system-prompt-budget.test.ts`

**Changes:**

1. `skillsBlock` accepts `pinnedIds?: string[]`; eviction skips pinned until only pinned left
2. `buildSystemPrompt`:  
   `IDENTITY` + `PRODUCT_CAPABILITY_MAP` + (skill available ? help guidance : fallback) + body…
3. Pass `pinnedIds: [HIP_SKILL_ID]` into skillsBlock when skills present
4. Skill available = skills some `id === 'hip' || name === 'hip'`

**Tests:** pin under tight budget; guidance on/off; capability map present; no full L2 dump.

### W3 — ConfigManager verification

**Files:**

- `packages/sidecar/src/session/config-manager.test.ts` (extend)

**Changes:**

1. With `HIP_DATA_DIR` isolation, `loadPluginComponents` includes builtin hip
2. Enabled map disable removes hip
3. User skill dir override wins on same id (via `HIP_SKILLS_DIR` fixture)

### W4 — Docs

- Spec + this plan (already in repo)

---

## Execution order

```
W1 content/fingerprint → W2 prompt/pin → W3 ConfigManager tests → yarn vitest targeted suites
```

## Success criteria (execution)

- [x] All acceptance criteria in spec §7 (P0+P1)
- [x] `yarn vitest run` on touched test files green (80 tests)
- [x] No unrelated refactors
- [x] P2: `docs/product/` SoT + `yarn product:content` / `:check` + README path + tauri version guards

## Execution log

- 2026-07-19: Implemented P0+P1 in-tree (spec + this plan + code + tests).
- 2026-07-19: P2 single-source — `docs/product/*`, `scripts/generate-product-content.mjs`, generated `content.ts`, check test.
- 2026-07-19: P2b UI — Settings → Help (`ProductHelpSettings`), generator also writes `src/domain/product/productDocs.generated.ts`; command palette `Settings: Product help`.
- 2026-07-19: P3 ops progressive — compact always-on `BASE` + built-in `hip-coding` skill (delegation/edit/git depth); pin `hip` + `hip-coding` under skills budget.
- 2026-07-19: P3b + ops SoT — `docs/ops/`, `generate-ops-content.mjs`, `yarn prompt:dogfood` offline matrix (hitRate=1).

### P2 commands

```bash
yarn product:content         # regenerate packages/sidecar/.../content.ts
yarn product:content:check   # fail if stale (also README paths + tauri version)
```

Sidecar `prebuild` runs the generator automatically.

## Follow-ups (not blocked)

1. P2 SoT under `docs/product/`
2. BASE operational progressive skills
3. Dogfood hit-rate harness
