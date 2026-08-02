/**
 * Sidebar craft flags (see docs/design/visual-craft-upgrade-spec.md).
 *
 * Compile-time constant. first_merge_default = false: unfinished nav stays
 * visible; version demotion does not require this flag.
 * Product flip to hide unfinished nav must land with cold-launch → chats
 * (PR-7b) — not this constant alone.
 */
export const SIDEBAR_NAV_SLIM = false
