/**
 * Shared tool-name helpers for UI breakdown and sidecar prune (KD-17).
 */

/**
 * Whether a tool name is a skill loader (`skill`, `use_skill`, or contains `skill`).
 * Used by context breakdown and soft-prune skill protection.
 */
export function isSkillToolName(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'use_skill' || n === 'skill' || n.includes('skill')
}
