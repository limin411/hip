/**
 * Visual craft upgrade flags (see docs/design/visual-craft-upgrade-spec.md).
 *
 * Compile-time constants — same pattern as `feature.ts` / terminal flags.
 * **Feature Flag Registry** is the sole source of defaults: first_merge = false
 * for every flag (zero UI change until bake-in flips).
 */
/** Progressive composer disclosure (bake-in after PR-2 e2e helper). */
export const COMPOSER_OVERFLOW = true
/** Parallel sub-agents as lanes. */
export const ACTIVITY_LANES = true
/** Fold long fences + lang badge polish. */
export const CODEBLOCK_STRUCTURE_CRAFT = true
/** Lazy Shiki when fence enters viewport (completed messages only). */
export const CODEBLOCK_LAZY_HIGHLIGHT = true
